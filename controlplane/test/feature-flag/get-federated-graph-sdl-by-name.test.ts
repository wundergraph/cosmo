import fs from 'node:fs';
import { join } from 'node:path';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
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
 * Covers how `getFederatedGraphSDLByName` resolves the SDL of a *feature flag* rather than of the base graph. The base
 * schema version it anchors on comes from `getLatestValidSchemaVersion`; these tests pin how the flag's own composition
 * is then selected against it.
 */
describe('GetFederatedGraphSDLByName with a feature flag', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test.each([true, false])(
    'that the SDL of a flag whose latest composition failed falls back to the last valid one under split config (split config: %s)',
    async (splitConfigEnabled) => {
      const { client, server } = await SetupTest({
        dbname,
        enabledFeatures: splitConfigEnabled ? ['split-config-loading'] : [],
      });
      onTestFinished(() => server.close());

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
        `
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
        `,
        labels,
        'http://localhost:4101',
      );

      const federatedGraphLabels = labels.map(({ key, value }) => `${key}=${value}`);
      await createFederatedGraph(client, federatedGraphName, namespace, federatedGraphLabels, DEFAULT_ROUTER_URL);

      const flagName = genID('flag');
      await createFeatureFlag(client, flagName, labels, ['users-ff'], namespace, true);

      // The first composition succeeded, so the SDL resolves
      const beforeResp = await client.getFederatedGraphSDLByName({
        name: federatedGraphName,
        namespace,
        featureFlagName: flagName,
      });
      expect(beforeResp.response?.code).toBe(EnumStatusCode.OK);
      expect(beforeResp.sdl).toBeTruthy();

      // Break the flag's next composition: `Product.details` is `String!` in products-standalone, `Int!` here
      const publishResp = await client.publishFederatedSubgraph({
        name: 'users-ff',
        namespace,
        schema: `
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
        `,
      });
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
});
