import { joinLabel } from '@wundergraph/cosmo-shared';
import { addMinutes, subDays } from 'date-fns';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi, Mock } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import {
  createAndPublishSubgraph,
  createFeatureFlag,
  createFederatedGraph,
  createThenPublishFeatureSubgraph,
  DEFAULT_ROUTER_URL,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
  toggleFeatureFlag,
} from '../test-util.js';

let dbname = '';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

// Minimal, self-contained SDLs so the tests don't depend on external fixture files.
const BASE_USERS_SDL = `
  type Query {
    user(id: ID!): User
    users: [User!]!
  }

  type User @key(fields: "id") {
    id: ID!
    name: String!
    email: String!
  }
`;

// Feature subgraph that augments the base with an extra field + query.
const FS_USERS_SDL = `
  type Query {
    user(id: ID!): User
    users: [User!]!
    featuredUser: User
  }

  type User @key(fields: "id") {
    id: ID!
    name: String!
    email: String!
    nickname: String
  }
`;

// Valid non-breaking change for the FS (adds a field).
const FS_USERS_SDL_VALID_UPDATE = `
  type Query {
    user(id: ID!): User
    users: [User!]!
    featuredUser: User
  }

  type User @key(fields: "id") {
    id: ID!
    name: String!
    email: String!
    nickname: String
    phoneNumber: String
  }
`;

// Base SDL variant that removes the email field — a breaking change used to exercise base-scoped traffic.
const BASE_USERS_SDL_REMOVE_EMAIL = `
  type Query {
    user(id: ID!): User
    users: [User!]!
  }

  type User @key(fields: "id") {
    id: ID!
    name: String!
  }
`;

// Breaking change on the FS: removes the `nickname` field (a field removal is breaking) while
// still composing cleanly against the base — used to exercise the FS-scoped traffic inspection.
const FS_USERS_SDL_REMOVE_FIELD = `
  type Query {
    user(id: ID!): User
    users: [User!]!
    featuredUser: User
  }

  type User @key(fields: "id") {
    id: ID!
    name: String!
    email: String!
  }
`;

const CE_BASE_SDL = `
  type Query {
    widget: Widget
  }

  type Widget @key(fields: "id") {
    id: ID!
    name: String!
  }
`;

const CE_PARTNER_SDL = `
  type Query {
    widgets: [Widget!]!
  }

  type Widget @key(fields: "id") {
    id: ID!
    size: Int
  }
`;

const CE_CONFLICT_SDL = `
  type Query {
    widget: Widget
  }

  type Widget @key(fields: "id") {
    id: ID!
    name: String!
    size: [Int!]!
  }
`;

const CE_FS_WITH_SCORE_SDL = `
  type Query {
    widget: Widget
  }

  type Widget @key(fields: "id") {
    id: ID!
    name: String!
    score: Int
  }
`;

const CE_PARTNER_CONFLICT_SCORE_SDL = `
  type Query {
    widgets: [Widget!]!
  }

  type Widget @key(fields: "id") {
    id: ID!
    size: Int
    score: [Int!]!
  }
`;

// --- Composed-breaking-change topology ------------------------------------------------------------
// A composed (federated-level) breaking change that is NOT also a subgraph-level change arises from a
// nullability merge: a co-resident subgraph owns `User.name: String!` (required); when another
// composition member contributes a nullable `name: String`, federation merges them and the COMPOSED
// `User.name` becomes nullable (String! → String). Adding the nullable field is a non-breaking
// SUBGRAPH change, so it survives the subgraph-vs-composed dedup and shows up only as a composed
// breaking change, attributed to whichever composition introduced it.
const CB_NAME_OWNER_SDL = `
  type Query {
    users: [User!]!
  }

  type User @key(fields: "id") {
    id: ID!
    name: String!
  }
`;

// The feature subgraph's base — owns `email`. Composes cleanly with the name owner.
const CB_BASE_SDL = `
  type Query {
    user: User
  }

  type User @key(fields: "id") {
    id: ID!
    email: String!
  }
`;

// A change (usable as the base or the FS) that ADDS a nullable `name`, flipping the composed
// `User.name` from String! to String.
const CB_ADD_NULLABLE_NAME_SDL = `
  type Query {
    user: User
  }

  type User @key(fields: "id") {
    id: ID!
    email: String!
    name: String
  }
`;

// A non-overridden co-resident subgraph (owns `tag`), present in EVERY composition. Used in the
// multi-fed-graph / multi-flag composed-change test: its proposed nullable `name` flips the composed
// `User.name` in the base AND every flag composition.
const CB_OTHER_SDL = `
  type Query {
    tagged: User
  }

  type User @key(fields: "id") {
    id: ID!
    tag: String
  }
`;

const CB_OTHER_ADD_NAME_SDL = `
  type Query {
    tagged: User
  }

  type User @key(fields: "id") {
    id: ID!
    tag: String
    name: String
  }
`;

type CompositionEntry = { message: string; federatedGraphName: string; namespace: string; featureFlag: string };
type ComposedChangeEntry = {
  message: string;
  changeType: string;
  path?: string;
  federatedGraphName: string;
  featureFlag: string;
};

// The check response uses `error.message` while the stored/read path uses `error.toString()` (which
// prepends "Error: "/"Warning: "). Strip that display prefix so we compare message content + attribution.
const stripMessagePrefix = (message: string) => message.replace(/^(Error|Warning):\s*/, '');

const normalizeComposition = (entries: CompositionEntry[]) =>
  entries.map((e) => `${e.federatedGraphName}|${e.namespace}|${e.featureFlag}|${stripMessagePrefix(e.message)}`).sort();

const normalizeComposedChanges = (entries: ComposedChangeEntry[]) =>
  entries.map((c) => `${c.federatedGraphName}|${c.featureFlag}|${c.changeType}|${c.path ?? ''}|${c.message}`).sort();

// Confirms the data surfaced by the read RPC (getCheckSummary) matches what the check response
// returned — i.e. composition errors/warnings and composed breaking changes (with their feature-flag
// attribution) were stored and read back consistently.
const expectSummaryToMatchCheck = (
  check: {
    compositionErrors: CompositionEntry[];
    compositionWarnings: CompositionEntry[];
    composedSchemaBreakingChanges: ComposedChangeEntry[];
  },
  summary: {
    compositionErrors: CompositionEntry[];
    compositionWarnings: CompositionEntry[];
    composedSchemaBreakingChanges: ComposedChangeEntry[];
  },
) => {
  expect(normalizeComposition(summary.compositionErrors)).toEqual(normalizeComposition(check.compositionErrors));
  expect(normalizeComposition(summary.compositionWarnings)).toEqual(normalizeComposition(check.compositionWarnings));
  expect(normalizeComposedChanges(summary.composedSchemaBreakingChanges)).toEqual(
    normalizeComposedChanges(check.composedSchemaBreakingChanges),
  );
};

describe('Feature flag aware subgraph checks', () => {
  let chClient: ClickHouseClient;

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('FS check with flag composition success', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const label = genUniqueLabel();
    const baseSubgraphName = genID('base');
    const featureSubgraphName = genID('fs');
    const fedGraphName = genID('fedgraph');
    const featureFlagName = genID('flag').toLowerCase();

    await createAndPublishSubgraph(
      client,
      baseSubgraphName,
      'default',
      BASE_USERS_SDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createThenPublishFeatureSubgraph(
      client,
      featureSubgraphName,
      baseSubgraphName,
      'default',
      FS_USERS_SDL,
      [label],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], DEFAULT_ROUTER_URL);

    await createFeatureFlag(client, featureFlagName, [label], [featureSubgraphName], 'default', true);

    // Sanity: resolve flag id for later assertions.
    const flagResp = await client.getFeatureFlagByName({
      name: featureFlagName,
      namespace: 'default',
    });
    expect(flagResp.response?.code).toBe(EnumStatusCode.OK);
    const flagId = flagResp.featureFlag?.id;
    expect(flagId).toBeDefined();
    expect(flagResp.featureSubgraphs.length).toBe(1);
    expect(flagResp.featureSubgraphs[0].name).toContain(featureSubgraphName);

    const checkResp = await client.checkSubgraphSchema({
      subgraphName: featureSubgraphName,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from(FS_USERS_SDL_VALID_UPDATE)),
    });

    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors).toHaveLength(0);
    // FS is in an enabled flag, so no "nothing to check" informational message is set.
    expect(checkResp.featureSubgraphCheckMessage ?? '').toBe('');

    // --- Confirm via the read RPC: the check ran against the fed graph as a feature-subgraph check ---
    const summary = await client.getCheckSummary({
      checkId: checkResp.checkId,
      graphName: fedGraphName,
      namespace: 'default',
    });
    expect(summary.response?.code).toBe(EnumStatusCode.OK);
    expect(summary.check?.hasFeatureSubgraphCheck).toBe(true);
    // The feature subgraph is linked to this fed graph's check (scsfg linkage, surfaced as checkedSubgraphs).
    expect(summary.check?.checkedSubgraphs.some((s) => s.subgraphName === featureSubgraphName)).toBe(true);
    expectSummaryToMatchCheck(checkResp, summary);
  });

  test('FS check with flag composition error — errors tagged with flag name', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const label = genUniqueLabel();
    const baseSubgraphName = genID('base');
    const partnerSubgraphName = genID('partner');
    const featureSubgraphName = genID('fs');
    const fedGraphName = genID('fedgraph');
    const featureFlagName = genID('flag').toLowerCase();

    // Base subgraph (overridden by the FS) + a partner subgraph that owns `Widget.size: Int`.
    await createAndPublishSubgraph(client, baseSubgraphName, 'default', CE_BASE_SDL, [label], DEFAULT_SUBGRAPH_URL_ONE);
    await createAndPublishSubgraph(
      client,
      partnerSubgraphName,
      'default',
      CE_PARTNER_SDL,
      [label],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    // The feature subgraph initially mirrors the base (composes cleanly with the partner).
    await createThenPublishFeatureSubgraph(
      client,
      featureSubgraphName,
      baseSubgraphName,
      'default',
      CE_BASE_SDL,
      [label],
      'http://localhost:4003/graphql',
    );

    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], DEFAULT_ROUTER_URL);
    await createFeatureFlag(client, featureFlagName, [label], [featureSubgraphName], 'default', true);

    const flagResp = await client.getFeatureFlagByName({
      name: featureFlagName,
      namespace: 'default',
    });
    expect(flagResp.response?.code).toBe(EnumStatusCode.OK);
    const flagId = flagResp.featureFlag?.id;
    expect(flagId).toBeDefined();
    expect(flagResp.featureSubgraphs.length).toBe(1);
    expect(flagResp.featureSubgraphs[0].name).toContain(featureSubgraphName);

    const checkResp = await client.checkSubgraphSchema({
      subgraphName: featureSubgraphName,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from(CE_CONFLICT_SDL)),
    });

    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors.length).toBe(1);
    expect(checkResp.compositionErrors[0].featureFlag).toBe(featureFlagName);

    // --- Confirm the stored attribution is surfaced through the read RPC ---
    const summary = await client.getCheckSummary({
      checkId: checkResp.checkId,
      graphName: fedGraphName,
      namespace: 'default',
    });
    expect(summary.response?.code).toBe(EnumStatusCode.OK);
    expect(summary.compositionErrors.length).toBe(1);
    expect(summary.compositionErrors[0].featureFlag).toBe(featureFlagName);
    expectSummaryToMatchCheck(checkResp, summary);
  });

  test('FS not in any enabled flag — informational response, no fed graph rows persisted', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const label = genUniqueLabel();
    const baseSubgraphName = genID('base');
    const featureSubgraphName = genID('fs');
    const fedGraphName = genID('fedgraph');

    await createAndPublishSubgraph(
      client,
      baseSubgraphName,
      'default',
      BASE_USERS_SDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createThenPublishFeatureSubgraph(
      client,
      featureSubgraphName,
      baseSubgraphName,
      'default',
      FS_USERS_SDL,
      [label],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], DEFAULT_ROUTER_URL);

    // NOTE: FS is deliberately not added to any feature flag.

    const checkResp = await client.checkSubgraphSchema({
      subgraphName: featureSubgraphName,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from(FS_USERS_SDL_VALID_UPDATE)),
    });

    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors).toHaveLength(0);

    // The "not assigned to any enabled feature flag" message is surfaced as an informational
    // top-level field, not as a composition warning (there is no composition).
    expect(checkResp.featureSubgraphCheckMessage).toBe(
      'Feature subgraph is not assigned to any enabled feature flag; no composition check performed.',
    );

    // No composition ran against any federated graph, so the check must not be associated with the
    // fed graph — i.e. it must not appear in the federated-graph-scoped checks list.
    const now = new Date();
    const checksResp = await client.getChecksByFederatedGraphName({
      name: fedGraphName,
      namespace: 'default',
      limit: 50,
      offset: 0,
      startDate: subDays(now, 7).toISOString(),
      endDate: addMinutes(now, 1).toISOString(),
    });
    expect(checksResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checksResp.checks.some((c) => c.id === checkResp.checkId)).toBe(false);
  });

  test('FS in a disabled flag is skipped — same informational response as an unassigned FS', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const label = genUniqueLabel();
    const baseSubgraphName = genID('base');
    const featureSubgraphName = genID('fs');
    const fedGraphName = genID('fedgraph');
    const featureFlagName = genID('flag').toLowerCase();

    await createAndPublishSubgraph(
      client,
      baseSubgraphName,
      'default',
      BASE_USERS_SDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createThenPublishFeatureSubgraph(
      client,
      featureSubgraphName,
      baseSubgraphName,
      'default',
      FS_USERS_SDL,
      [label],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], DEFAULT_ROUTER_URL);

    await createFeatureFlag(client, featureFlagName, [label], [featureSubgraphName], 'default', true);

    const flagResp = await client.getFeatureFlagByName({
      name: featureFlagName,
      namespace: 'default',
    });
    expect(flagResp.response?.code).toBe(EnumStatusCode.OK);
    const flagId = flagResp.featureFlag?.id;
    expect(flagId).toBeDefined();
    expect(flagResp.featureSubgraphs.length).toBe(1);
    expect(flagResp.featureSubgraphs[0].name).toContain(featureSubgraphName);

    // Disable the flag — the FS should now be treated as though it is in no enabled flag.
    await toggleFeatureFlag(client, featureFlagName, false);

    const checkResp = await client.checkSubgraphSchema({
      subgraphName: featureSubgraphName,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from(FS_USERS_SDL_VALID_UPDATE)),
    });

    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors).toHaveLength(0);

    expect(checkResp.featureSubgraphCheckMessage).toBe(
      'Feature subgraph is not assigned to any enabled feature flag; no composition check performed.',
    );

    // A disabled flag means no composition ran, so the check is not associated with the fed graph
    // and must not appear in the federated-graph-scoped checks list.
    const now = new Date();
    const checksResp = await client.getChecksByFederatedGraphName({
      name: fedGraphName,
      namespace: 'default',
      limit: 50,
      offset: 0,
      startDate: subDays(now, 7).toISOString(),
      endDate: addMinutes(now, 1).toISOString(),
    });
    expect(checksResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checksResp.checks.some((c) => c.id === checkResp.checkId)).toBe(false);
  });

  test('check on a shared base subgraph surfaces a composition error in the flag supergraph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const label = genUniqueLabel();
    const baseSubgraphName = genID('base');
    const partnerSubgraphName = genID('partner');
    const featureSubgraphName = genID('fs');
    const fedGraphName = genID('fedgraph');
    const featureFlagName = genID('flag').toLowerCase();

    // Base owns `name`; partner owns `size`. The FS overrides the base and adds a feature-only `score`.
    await createAndPublishSubgraph(client, baseSubgraphName, 'default', CE_BASE_SDL, [label], DEFAULT_SUBGRAPH_URL_ONE);
    await createAndPublishSubgraph(
      client,
      partnerSubgraphName,
      'default',
      CE_PARTNER_SDL,
      [label],
      DEFAULT_SUBGRAPH_URL_TWO,
    );
    await createThenPublishFeatureSubgraph(
      client,
      featureSubgraphName,
      baseSubgraphName,
      'default',
      CE_FS_WITH_SCORE_SDL,
      [label],
      'http://localhost:4003/graphql',
    );

    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], DEFAULT_ROUTER_URL);
    // Flag composition (FS + partner) is clean at creation: name, score(Int), size.
    await createFeatureFlag(client, featureFlagName, [label], [featureSubgraphName], 'default', true);

    const flagResp = await client.getFeatureFlagByName({
      name: featureFlagName,
      namespace: 'default',
    });
    expect(flagResp.response?.code).toBe(EnumStatusCode.OK);
    const flagId = flagResp.featureFlag?.id;
    expect(flagId).toBeDefined();
    expect(flagResp.featureSubgraphs.length).toBe(1);
    expect(flagResp.featureSubgraphs[0].name).toContain(featureSubgraphName);

    const checkResp = await client.checkSubgraphSchema({
      subgraphName: partnerSubgraphName,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from(CE_PARTNER_CONFLICT_SCORE_SDL)),
    });

    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors.length).toBe(1);
    expect(checkResp.compositionErrors[0].featureFlag).toBe(featureFlagName);

    const summary = await client.getCheckSummary({
      checkId: checkResp.checkId,
      graphName: fedGraphName,
      namespace: 'default',
    });
    expect(summary.response?.code).toBe(EnumStatusCode.OK);
    expect(summary.compositionErrors.length).toBe(1);
    expect(summary.compositionErrors[0].featureFlag).toBe(featureFlagName);
    expectSummaryToMatchCheck(checkResp, summary);
  });

  test('getCheckSummary returns structured compositionErrors with feature flag attribution', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const label = genUniqueLabel();
    const baseSubgraphName = genID('base');
    const partnerSubgraphName = genID('partner');
    const featureSubgraphName = genID('fs');
    const fedGraphName = genID('fedgraph');
    const featureFlagName = genID('flag').toLowerCase();
    const namespaceName = 'default';

    await createAndPublishSubgraph(
      client,
      baseSubgraphName,
      namespaceName,
      CE_BASE_SDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );
    await createAndPublishSubgraph(
      client,
      partnerSubgraphName,
      namespaceName,
      CE_PARTNER_SDL,
      [label],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createThenPublishFeatureSubgraph(
      client,
      featureSubgraphName,
      baseSubgraphName,
      namespaceName,
      CE_BASE_SDL,
      [label],
      'http://localhost:4003/graphql',
    );

    await createFederatedGraph(client, fedGraphName, namespaceName, [joinLabel(label)], DEFAULT_ROUTER_URL);

    await createFeatureFlag(client, featureFlagName, [label], [featureSubgraphName], namespaceName, true);

    // Run a check that produces a flag-level composition error (the FS redefines `size` as a list,
    // conflicting with the partner's scalar `size` in the flag composition).
    const checkResp = await client.checkSubgraphSchema({
      subgraphName: featureSubgraphName,
      namespace: namespaceName,
      schema: Uint8Array.from(Buffer.from(CE_CONFLICT_SDL)),
    });

    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors.length).toBe(1);

    const checkId = checkResp.checkId;
    expect(checkId).toBeTruthy();

    // Now call getCheckSummary and assert structured attribution.
    const summary = await client.getCheckSummary({
      checkId,
      graphName: fedGraphName,
      namespace: namespaceName,
    });

    expect(summary.response?.code).toBe(EnumStatusCode.OK);
    expect(summary.compositionErrors.length).toBe(1);

    const flaggedError = summary.compositionErrors.find((e) => e.featureFlag !== '');
    expect(flaggedError).toBeDefined();
    expect(flaggedError!.featureFlag).toBe(featureFlagName);
    expect(flaggedError!.federatedGraphName).toBe(fedGraphName);
    expect(flaggedError!.namespace).toBe(namespaceName);
    expect(flaggedError!.message).toBeTruthy();
    expectSummaryToMatchCheck(checkResp, summary);
  });

  test('getChecksByFederatedGraphName surfaces hasFeatureSubgraphCheck correctly', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const label = genUniqueLabel();
    const baseSubgraphName = genID('base');
    const featureSubgraphName = genID('fs');
    const fedGraphName = genID('fedgraph');
    const featureFlagName = genID('flag').toLowerCase();

    await createAndPublishSubgraph(
      client,
      baseSubgraphName,
      'default',
      BASE_USERS_SDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createThenPublishFeatureSubgraph(
      client,
      featureSubgraphName,
      baseSubgraphName,
      'default',
      FS_USERS_SDL,
      [label],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], DEFAULT_ROUTER_URL);

    await createFeatureFlag(client, featureFlagName, [label], [featureSubgraphName], 'default', true);

    // Run a check on the feature subgraph — should produce hasFeatureSubgraphCheck = true
    const fsCheckResp = await client.checkSubgraphSchema({
      subgraphName: featureSubgraphName,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from(FS_USERS_SDL_VALID_UPDATE)),
    });
    expect(fsCheckResp.response?.code).toBe(EnumStatusCode.OK);
    const fsCheckId = fsCheckResp.checkId;

    // Run a check on the base subgraph — should produce hasFeatureSubgraphCheck = false
    const baseCheckResp = await client.checkSubgraphSchema({
      subgraphName: baseSubgraphName,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from(BASE_USERS_SDL)),
    });
    expect(baseCheckResp.response?.code).toBe(EnumStatusCode.OK);
    const baseCheckId = baseCheckResp.checkId;

    const now = new Date();
    const start = subDays(now, 7).toISOString();
    const end = addMinutes(now, 1).toISOString();

    const checksResp = await client.getChecksByFederatedGraphName({
      name: fedGraphName,
      namespace: 'default',
      limit: 50,
      offset: 0,
      startDate: start,
      endDate: end,
    });

    expect(checksResp.response?.code).toBe(EnumStatusCode.OK);
    // Exactly the two checks created in this test (one FS check, one base check) for this fed graph.
    expect(checksResp.checks.length).toBe(2);

    const fsRow = checksResp.checks.find((c) => c.id === fsCheckId);
    expect(fsRow).toBeDefined();
    expect(fsRow!.hasFeatureSubgraphCheck).toBe(true);

    const baseRow = checksResp.checks.find((c) => c.id === baseCheckId);
    expect(baseRow).toBeDefined();
    expect(baseRow!.hasFeatureSubgraphCheck).toBe(false);
  });

  test('base subgraph check records a base-attributed composed breaking change', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const label = genUniqueLabel();
    const baseSubgraphName = genID('base');
    const nameOwnerName = genID('nameowner');
    const featureSubgraphName = genID('fs');
    const fedGraphName = genID('fedgraph');
    const featureFlagName = genID('flag').toLowerCase();

    // Name owner contributes the required `User.name`; the base owns `email`.
    await createAndPublishSubgraph(client, baseSubgraphName, 'default', CB_BASE_SDL, [label], DEFAULT_SUBGRAPH_URL_ONE);
    await createAndPublishSubgraph(
      client,
      nameOwnerName,
      'default',
      CB_NAME_OWNER_SDL,
      [label],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    // FS mirrors the base (`email` only) → flag composition (FS + name owner) keeps `name: String!`.
    await createThenPublishFeatureSubgraph(
      client,
      featureSubgraphName,
      baseSubgraphName,
      'default',
      CB_BASE_SDL,
      [label],
      'http://localhost:4003/graphql',
    );

    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], DEFAULT_ROUTER_URL);
    await createFeatureFlag(client, featureFlagName, [label], [featureSubgraphName], 'default', true);

    // Propose a base change that ADDS a nullable `name`. In the BASE composition this merges with the
    // name owner's `String!` to flip the composed `User.name` to nullable — a composed breaking change.
    // The flag composition replaces the base with the FS (which has no `name`), so it stays clean →
    // the composed change is attributed only to the base supergraph.
    const checkResp = await client.checkSubgraphSchema({
      subgraphName: baseSubgraphName,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from(CB_ADD_NULLABLE_NAME_SDL)),
    });

    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors).toHaveLength(0);
    expect(checkResp.composedSchemaBreakingChanges.length).toBe(1);
    expect(checkResp.composedSchemaBreakingChanges[0].featureFlag).toBe('');
    expect(checkResp.composedSchemaBreakingChanges[0].path).toBe('User.name');

    const summary = await client.getCheckSummary({
      checkId: checkResp.checkId,
      graphName: fedGraphName,
      namespace: 'default',
    });
    expect(summary.response?.code).toBe(EnumStatusCode.OK);
    expect(summary.composedSchemaBreakingChanges.length).toBe(1);
    expect(summary.composedSchemaBreakingChanges[0].featureFlag).toBe('');
    expect(summary.composedSchemaBreakingChanges[0].path).toBe('User.name');
    expectSummaryToMatchCheck(checkResp, summary);
  });

  test('feature subgraph check records a flag-attributed composed breaking change', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const label = genUniqueLabel();
    const baseSubgraphName = genID('base');
    const nameOwnerName = genID('nameowner');
    const featureSubgraphName = genID('fs');
    const fedGraphName = genID('fedgraph');
    const featureFlagName = genID('flag').toLowerCase();

    await createAndPublishSubgraph(client, baseSubgraphName, 'default', CB_BASE_SDL, [label], DEFAULT_SUBGRAPH_URL_ONE);
    await createAndPublishSubgraph(
      client,
      nameOwnerName,
      'default',
      CB_NAME_OWNER_SDL,
      [label],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    // FS mirrors the base (`email` only) → flag composition (FS + name owner) keeps `name: String!`.
    await createThenPublishFeatureSubgraph(
      client,
      featureSubgraphName,
      baseSubgraphName,
      'default',
      CB_BASE_SDL,
      [label],
      'http://localhost:4003/graphql',
    );

    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], DEFAULT_ROUTER_URL);
    await createFeatureFlag(client, featureFlagName, [label], [featureSubgraphName], 'default', true);

    // Check the FS adding a nullable `name`. An FS check recomposes only the flag supergraph, where
    // the FS's nullable `name` merges with the name owner's `String!` → composed `User.name` flips to
    // nullable. Adding the field is a non-breaking subgraph change, so this surfaces purely as a
    // flag-attributed composed breaking change.
    const checkResp = await client.checkSubgraphSchema({
      subgraphName: featureSubgraphName,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from(CB_ADD_NULLABLE_NAME_SDL)),
    });

    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors).toHaveLength(0);
    expect(checkResp.composedSchemaBreakingChanges.length).toBe(1);
    expect(checkResp.composedSchemaBreakingChanges[0].featureFlag).toBe(featureFlagName);
    expect(checkResp.composedSchemaBreakingChanges[0].path).toBe('User.name');

    const summary = await client.getCheckSummary({
      checkId: checkResp.checkId,
      graphName: fedGraphName,
      namespace: 'default',
    });
    expect(summary.response?.code).toBe(EnumStatusCode.OK);
    expect(summary.composedSchemaBreakingChanges.length).toBe(1);
    expect(summary.composedSchemaBreakingChanges[0].featureFlag).toBe(featureFlagName);
    expect(summary.composedSchemaBreakingChanges[0].path).toBe('User.name');
    expectSummaryToMatchCheck(checkResp, summary);
  });

  test('composed breaking changes across multiple federated graphs and multiple feature flags are attributed per (graph, flag)', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const label = genUniqueLabel();
    const baseSubgraphName = genID('base');
    const nameOwnerName = genID('nameowner');
    const otherSubgraphName = genID('other');
    const fs1Name = genID('fs1');
    const fs2Name = genID('fs2');
    const fedGraph1Name = genID('fg1');
    const fedGraph2Name = genID('fg2');
    const flagXName = genID('flagx').toLowerCase();
    const flagYName = genID('flagy').toLowerCase();

    // Name owner contributes required `User.name`; base owns `email`; `other` owns `tag`. None of name
    // owner / other are overridden by a flag, so they appear in every composition.
    await createAndPublishSubgraph(client, baseSubgraphName, 'default', CB_BASE_SDL, [label], DEFAULT_SUBGRAPH_URL_ONE);
    await createAndPublishSubgraph(
      client,
      nameOwnerName,
      'default',
      CB_NAME_OWNER_SDL,
      [label],
      DEFAULT_SUBGRAPH_URL_TWO,
    );
    await createAndPublishSubgraph(
      client,
      otherSubgraphName,
      'default',
      CB_OTHER_SDL,
      [label],
      'http://localhost:4005/graphql',
    );

    // Two feature subgraphs override the base (each mirrors it — `email` only), each owned by a flag.
    await createThenPublishFeatureSubgraph(
      client,
      fs1Name,
      baseSubgraphName,
      'default',
      CB_BASE_SDL,
      [label],
      'http://localhost:4003/graphql',
    );
    await createThenPublishFeatureSubgraph(
      client,
      fs2Name,
      baseSubgraphName,
      'default',
      CB_BASE_SDL,
      [label],
      'http://localhost:4004/graphql',
    );

    // Two federated graphs that both select the same labelled subgraphs.
    await createFederatedGraph(client, fedGraph1Name, 'default', [joinLabel(label)], DEFAULT_ROUTER_URL);
    await createFederatedGraph(client, fedGraph2Name, 'default', [joinLabel(label)], 'http://localhost:3005');

    await createFeatureFlag(client, flagXName, [label], [fs1Name], 'default', true);
    await createFeatureFlag(client, flagYName, [label], [fs2Name], 'default', true);

    // Check `other` (present in every composition) adding a nullable `name`. It merges with the name
    // owner's `String!` to flip the composed `User.name` to nullable in the base AND both flag
    // compositions, for BOTH fed graphs → one composed breaking change per (fed graph, flag/base).
    const checkResp = await client.checkSubgraphSchema({
      subgraphName: otherSubgraphName,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from(CB_OTHER_ADD_NAME_SDL)),
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors).toHaveLength(0);

    // 2 fed graphs × (base + flag X + flag Y) = 6 composed breaking changes, all on User.name.
    expect(checkResp.composedSchemaBreakingChanges.length).toBe(6);
    expect(checkResp.composedSchemaBreakingChanges.every((c) => c.path === 'User.name')).toBe(true);
    expect(new Set(checkResp.composedSchemaBreakingChanges.map((c) => c.federatedGraphName))).toEqual(
      new Set([fedGraph1Name, fedGraph2Name]),
    );
    for (const fg of [fedGraph1Name, fedGraph2Name]) {
      const flagsForFg = new Set(
        checkResp.composedSchemaBreakingChanges.filter((c) => c.federatedGraphName === fg).map((c) => c.featureFlag),
      );
      expect(flagsForFg).toEqual(new Set(['', flagXName, flagYName]));
    }

    for (const fg of [fedGraph1Name, fedGraph2Name]) {
      const summary = await client.getCheckSummary({ checkId: checkResp.checkId, graphName: fg, namespace: 'default' });
      expect(summary.response?.code).toBe(EnumStatusCode.OK);
      expect(summary.composedSchemaBreakingChanges.every((c) => c.federatedGraphName === fg)).toBe(true);
      expect(new Set(summary.composedSchemaBreakingChanges.map((c) => c.featureFlag))).toEqual(
        new Set(['', flagXName, flagYName]),
      );
    }
  });
});
