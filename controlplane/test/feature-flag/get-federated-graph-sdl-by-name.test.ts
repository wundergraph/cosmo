import fs from 'node:fs';
import { join } from 'node:path';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Client } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import {
  createAndPublishSubgraph,
  createFeatureFlag,
  createFederatedGraph,
  createNamespace,
  createThenPublishFeatureSubgraph,
  DEFAULT_ROUTER_URL,
  DEFAULT_SUBGRAPH_URL_ONE,
  SetupTest,
} from '../test-util.js';

let dbname = '';

/**
 * A feature subgraph for `users` that composes cleanly against the base graph. `nickname` exists only here, so its
 * presence in a returned SDL proves the flag's composition was served rather than the base one.
 */
const FEATURE_SUBGRAPH_VALID = `
  type User @key(fields: "id") {
    id: ID!
    name: String!
    email: String!
    isPremium: Boolean! @tag(name: "exclude")
    nickname: String!
  }

  type Query {
    user(id: ID!): User
    users: [User!]!
  }
`;

/**
 * Same, but omitting `email`, so a later `User.email` conflict introduced into a base subgraph breaks the BASE
 * composition while leaving this flag's composition intact.
 */
const FEATURE_SUBGRAPH_VALID_WITHOUT_EMAIL = `
  type User @key(fields: "id") {
    id: ID!
    name: String!
    isPremium: Boolean! @tag(name: "exclude")
    nickname: String!
  }

  type Query {
    user(id: ID!): User
    users: [User!]!
  }
`;

/**
 * Declares `Product.details` as `Int!` where the `products-standalone` subgraph declares it `String!`, so composing any
 * flag built on this feature subgraph fails while the base graph is untouched.
 */
const FEATURE_SUBGRAPH_BROKEN = `
  type User @key(fields: "id") {
    id: ID!
    name: String!
    email: String!
    isPremium: Boolean! @tag(name: "exclude")
  }

  type Product @key(fields: "upc sku") {
    upc: Int!
    sku: String!
    details: Int!
  }

  type Query {
    user(id: ID!): User
    users: [User!]!
  }
`;

/**
 * Sets up a federated graph with two base subgraphs (`users`, `products-standalone`) and one feature subgraph
 * (`users-ff`) built on `users`. Returns the identifiers the tests need.
 */
async function setUpGraphWithFeatureSubgraph(
  client: Client<typeof PlatformService>,
  featureSubgraphSchema: string = FEATURE_SUBGRAPH_VALID,
) {
  const namespace = genID('namespace').toLowerCase();
  const labels = [genUniqueLabel()];
  const federatedGraphName = genID('fedGraph');

  await createNamespace(client, namespace);

  await createAndPublishSubgraph(
    client,
    'users',
    namespace,
    fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users.graphql')).toString(),
    labels,
    DEFAULT_SUBGRAPH_URL_ONE,
  );

  await createAndPublishSubgraph(
    client,
    'products-standalone',
    namespace,
    fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/products-standalone.graphql')).toString(),
    labels,
    'http://localhost:4002',
  );

  await createThenPublishFeatureSubgraph(
    client,
    'users-ff',
    'users',
    namespace,
    featureSubgraphSchema,
    labels,
    'http://localhost:4101',
  );

  const federatedGraphLabels = labels.map(({ key, value }) => `${key}=${value}`);
  await createFederatedGraph(client, federatedGraphName, namespace, federatedGraphLabels, DEFAULT_ROUTER_URL);

  return { namespace, labels, federatedGraphName };
}

/** Publishes a schema to `products-standalone` that duplicates the non-shareable `User.email` owned by `users`. */
function breakBaseComposition(client: Client<typeof PlatformService>, namespace: string) {
  return client.publishFederatedSubgraph({
    name: 'products-standalone',
    namespace,
    schema: `
      type Product @key(fields: "upc sku") {
        upc: Int!
        sku: String!
        details: String!
        isPremium: Boolean! @tag(name: "exclude")
      }

      type User @key(fields: "id") {
        id: ID! @shareable
        email: String!
      }

      type Query {
        products: [Product!]!
      }
    `,
  });
}

/** Publishes a schema to the `users-ff` feature subgraph that conflicts with `products-standalone`. */
function breakFeatureFlagComposition(client: Client<typeof PlatformService>, namespace: string) {
  return client.publishFederatedSubgraph({
    name: 'users-ff',
    namespace,
    schema: FEATURE_SUBGRAPH_BROKEN,
  });
}

/**
 * Covers how `getFederatedGraphSDLByName` resolves the SDL of a *feature flag* rather than of the base graph.
 *
 * The handler resolves the base anchor with `getLatestValidSchemaVersion` and then asks
 * `FeatureFlagRepository.getFeatureFlagSchemaVersionByBaseSchemaVersion` for the flag's composition against it. That
 * singular lookup filters for a valid composition **only under split config** — a deliberate decision to limit blast
 * radius on the legacy path — which is why several cases below expect different outcomes per mode.
 */
describe('GetFederatedGraphSDLByName with a feature flag', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test.each([true, false])(
    'that a flag whose composition succeeded serves the flag SDL (split config: %s)',
    async (splitConfigEnabled) => {
      const { client, server } = await SetupTest({
        dbname,
        enabledFeatures: splitConfigEnabled ? ['split-config-loading'] : [],
      });
      onTestFinished(() => server.close());

      const { namespace, labels, federatedGraphName } = await setUpGraphWithFeatureSubgraph(client);

      const flagName = genID('flag');
      await createFeatureFlag(client, flagName, labels, ['users-ff'], namespace, true);

      const flagSdl = await client.getFederatedGraphSDLByName({
        name: federatedGraphName,
        namespace,
        featureFlagName: flagName,
      });

      expect(flagSdl.response?.code).toBe(EnumStatusCode.OK);
      // `nickname` exists only in the feature subgraph, so this proves the flag's composition was served
      expect(flagSdl.sdl).toContain('nickname');
      expect(flagSdl.clientSchema).toBeTruthy();

      // The base graph's own SDL must be unaffected by the flag
      const baseSdl = await client.getFederatedGraphSDLByName({ name: federatedGraphName, namespace });
      expect(baseSdl.response?.code).toBe(EnumStatusCode.OK);
      expect(baseSdl.sdl).not.toContain('nickname');
    },
  );

  test.each([true, false])(
    'that the SDL of a flag whose latest composition failed falls back to the last valid one under split config (split config: %s)',
    async (splitConfigEnabled) => {
      const { client, server } = await SetupTest({
        dbname,
        enabledFeatures: splitConfigEnabled ? ['split-config-loading'] : [],
      });
      onTestFinished(() => server.close());

      const { namespace, labels, federatedGraphName } = await setUpGraphWithFeatureSubgraph(client);

      const flagName = genID('flag');
      await createFeatureFlag(client, flagName, labels, ['users-ff'], namespace, true);

      const beforeResp = await client.getFederatedGraphSDLByName({
        name: federatedGraphName,
        namespace,
        featureFlagName: flagName,
      });
      expect(beforeResp.response?.code).toBe(EnumStatusCode.OK);
      expect(beforeResp.sdl).toBeTruthy();

      const publishResp = await breakFeatureFlagComposition(client, namespace);
      expect(publishResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);

      const afterResp = await client.getFederatedGraphSDLByName({
        name: federatedGraphName,
        namespace,
        featureFlagName: flagName,
      });

      if (splitConfigEnabled) {
        // The failed composition has a null SDL; we must fall back to the last valid composition
        expect(afterResp.response?.code).toBe(EnumStatusCode.OK);
        expect(afterResp.sdl).toBe(beforeResp.sdl);
      } else {
        /**
         * Legacy is deliberately left unfixed: the failed flag composition is anchored to the base schema version
         * created by this very publish (legacy recomposes the base graph on every flag event, moving the anchor), and
         * that lookup has no validity filter, so its null SDL surfaces as ERR_NOT_FOUND. Asserted so the gap stays
         * visible rather than looking like an oversight.
         */
        expect(afterResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      }
    },
  );

  test.each([true, false])(
    'that a flag which never composed successfully has no SDL (split config: %s)',
    async (splitConfigEnabled) => {
      const { client, server } = await SetupTest({
        dbname,
        enabledFeatures: splitConfigEnabled ? ['split-config-loading'] : [],
      });
      onTestFinished(() => server.close());

      // The feature subgraph already conflicts with `products-standalone`, so the flag's first composition fails
      const { namespace, labels, federatedGraphName } = await setUpGraphWithFeatureSubgraph(
        client,
        FEATURE_SUBGRAPH_BROKEN,
      );

      const flagName = genID('flag');
      const createResp = await client.createFeatureFlag({
        name: flagName,
        featureSubgraphNames: ['users-ff'],
        labels,
        namespace,
        isEnabled: true,
      });
      expect(createResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);

      // There is no valid composition to serve, in either mode
      const flagSdl = await client.getFederatedGraphSDLByName({
        name: federatedGraphName,
        namespace,
        featureFlagName: flagName,
      });
      expect(flagSdl.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(flagSdl.sdl).toBeFalsy();
    },
  );

  test.each([true, false])(
    'that a flag still serves its SDL when the base composition failed (split config: %s)',
    async (splitConfigEnabled) => {
      const { client, server } = await SetupTest({
        dbname,
        enabledFeatures: splitConfigEnabled ? ['split-config-loading'] : [],
      });
      onTestFinished(() => server.close());

      // The feature subgraph omits `email`, so the `User.email` conflict below breaks only the base composition
      const { namespace, labels, federatedGraphName } = await setUpGraphWithFeatureSubgraph(
        client,
        FEATURE_SUBGRAPH_VALID_WITHOUT_EMAIL,
      );

      const flagName = genID('flag');
      await createFeatureFlag(client, flagName, labels, ['users-ff'], namespace, true);

      const beforeResp = await client.getFederatedGraphSDLByName({
        name: federatedGraphName,
        namespace,
        featureFlagName: flagName,
      });
      expect(beforeResp.response?.code).toBe(EnumStatusCode.OK);

      const publishResp = await breakBaseComposition(client, namespace);
      expect(publishResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);

      /**
       * The handler anchors on the latest *valid* base schema version, not on the graph's `composedSchemaVersionId`
       * which has advanced to the failed one, so the flag's composition is still reachable and served in both modes.
       */
      const afterResp = await client.getFederatedGraphSDLByName({
        name: federatedGraphName,
        namespace,
        featureFlagName: flagName,
      });
      expect(afterResp.response?.code).toBe(EnumStatusCode.OK);
      expect(afterResp.sdl).toContain('nickname');

      /**
       * Which composition gets served differs by mode, because the publish above targeted `products-standalone` — a
       * subgraph the flag's own composition also includes:
       * - split config composes flags independently of the base, so the flag recomposed successfully against the
       *   updated subgraph and its SDL moved on.
       * - legacy composes base and flags in one pass and writes no flag composition when the base fails, so the flag
       *   keeps serving the composition it had before.
       */
      if (splitConfigEnabled) {
        expect(afterResp.sdl).not.toBe(beforeResp.sdl);
      } else {
        expect(afterResp.sdl).toBe(beforeResp.sdl);
      }
    },
  );

  test.each([true, false])(
    'that an unknown feature flag name is reported as not found (split config: %s)',
    async (splitConfigEnabled) => {
      const { client, server } = await SetupTest({
        dbname,
        enabledFeatures: splitConfigEnabled ? ['split-config-loading'] : [],
      });
      onTestFinished(() => server.close());

      const { namespace, federatedGraphName } = await setUpGraphWithFeatureSubgraph(client);

      const flagSdl = await client.getFederatedGraphSDLByName({
        name: federatedGraphName,
        namespace,
        featureFlagName: 'does-not-exist',
      });

      expect(flagSdl.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(flagSdl.response?.details).toBe('Feature flag does-not-exist not found');
    },
  );

  test.each([true, false])(
    'that a disabled flag does not serve its SDL (split config: %s)',
    async (splitConfigEnabled) => {
      const { client, server } = await SetupTest({
        dbname,
        enabledFeatures: splitConfigEnabled ? ['split-config-loading'] : [],
      });
      onTestFinished(() => server.close());

      const { namespace, labels, federatedGraphName } = await setUpGraphWithFeatureSubgraph(client);

      const flagName = genID('flag');
      await createFeatureFlag(client, flagName, labels, ['users-ff'], namespace, true);

      const disableResp = await client.enableFeatureFlag({ name: flagName, namespace, enabled: false });
      expect(disableResp.response?.code).toBe(EnumStatusCode.OK);

      const flagSdl = await client.getFederatedGraphSDLByName({
        name: federatedGraphName,
        namespace,
        featureFlagName: flagName,
      });

      expect(flagSdl.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(flagSdl.response?.details).toBe(`Feature flag ${flagName} is disabled`);
      expect(flagSdl.sdl).toBeFalsy();
    },
  );
});
