import { joinLabel } from '@wundergraph/cosmo-shared';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
  genUniqueLabel,
} from '../src/core/test-util.js';
import {
  createFederatedGraph,
  createOrganizationGroup,
  createThenPublishSubgraph,
  DEFAULT_NAMESPACE,
  DEFAULT_ROUTER_URL,
  DEFAULT_SUBGRAPH_URL_ONE,
  SetupTest,
} from './test-util.js';

let dbname = '';

const webhookUrl = 'http://governance-webhook.test';

const subgraphSDL = `
  type Query {
    users: [User!]!
  }

  type User {
    id: ID!
  }
`;

describe('Hub governance', () => {
  let capturedWebhooks: Record<string, unknown>[] = [];

  const mockServer = setupServer(
    http.post(webhookUrl, async ({ request }) => {
      capturedWebhooks.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ success: true });
    }),
  );

  beforeAll(async () => {
    mockServer.listen({ onUnhandledRequest: 'bypass' });
    dbname = await beforeAllSetup();
  });

  afterEach(() => {
    capturedWebhooks = [];
  });

  afterAll(async () => {
    mockServer.close();
    await afterAllSetup(dbname);
  });

  test('GetHubGovernance returns members, default Hub permissions and subgraph owners from group rules', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );
    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);

    const subgraph = await client.getSubgraphByName({ name: subgraphName, namespace: DEFAULT_NAMESPACE });
    const fedGraph = await client.getFederatedGraphByName({ name: fedGraphName, namespace: DEFAULT_NAMESPACE });

    const ownerGroup = await createOrganizationGroup(client, genID('team'), {
      role: 'subgraph-admin',
      resources: [subgraph.graph!.targetId],
    });

    const governance = await client.getHubGovernance({});

    expect(governance.response?.code).toBe(EnumStatusCode.OK);
    expect(governance.organization?.slug).toBe(users.adminAliceCompanyA.organizationSlug);

    expect(governance.members).toHaveLength(1);
    expect(governance.members[0].email).toBe(users.adminAliceCompanyA.email);
    expect(governance.members[0].groupIds).toHaveLength(1);

    const groupsByName = new Map(governance.groups.map((group) => [group.name, group]));
    expect(
      groupsByName
        .get('admin')
        ?.hubPermissions.map((grant) => grant.permission)
        .sort(),
    ).toEqual([
      'approve',
      'approve_egress',
      'create_sandbox',
      'edit_sandbox',
      'manage_egress_credentials',
      'manage_integrations',
      'open_portals',
      'propose',
      'run_agents',
      'share_sandbox',
      'view_audit_log',
    ]);
    expect(
      groupsByName
        .get('developer')
        ?.hubPermissions.map((grant) => grant.permission)
        .sort(),
    ).toEqual(['approve', 'create_sandbox', 'edit_sandbox', 'open_portals', 'propose', 'run_agents', 'share_sandbox']);
    expect(groupsByName.get('viewer')?.hubPermissions).toEqual([]);
    expect(groupsByName.get(ownerGroup.name)?.rules[0].role).toBe('subgraph-admin');

    expect(governance.owners.map((owner) => ({ ...owner, $typeName: undefined }))).toEqual([
      {
        federatedGraphId: fedGraph.graph!.id,
        resourceKind: 'subgraph',
        resource: subgraphName,
        groupId: ownerGroup.groupId,
      },
    ]);
  });

  test('only organization admins update Hub permissions', async (testContext) => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });
    testContext.onTestFinished(() => server.close());

    const group = await createOrganizationGroup(client, genID('team'));

    const updateResponse = await client.updateOrganizationGroupHubPermissions({
      groupId: group.groupId,
      hubPermissions: [
        { permission: 'create_sandbox', namespaces: [], resources: [] },
        { permission: 'approve', namespaces: [], resources: [] },
      ],
    });
    expect(updateResponse.response?.code).toBe(EnumStatusCode.OK);

    const groupsResponse = await client.getOrganizationGroups({});
    const updatedGroup = groupsResponse.groups.find((g) => g.groupId === group.groupId);
    expect(updatedGroup?.hubPermissions.map((grant) => grant.permission)).toEqual(['create_sandbox', 'approve']);

    const unknownPermissionResponse = await client.updateOrganizationGroupHubPermissions({
      groupId: group.groupId,
      hubPermissions: [{ permission: 'delete_everything', namespaces: [], resources: [] }],
    });
    expect(unknownPermissionResponse.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role: 'organization-developer' })),
    });

    const developerResponse = await client.updateOrganizationGroupHubPermissions({
      groupId: group.groupId,
      hubPermissions: [],
    });
    expect(developerResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
  });

  test('view_hidden_schema grants keep normalized tags and other grants drop them', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });
    testContext.onTestFinished(() => server.close());

    const group = await createOrganizationGroup(client, genID('team'));

    const updateResponse = await client.updateOrganizationGroupHubPermissions({
      groupId: group.groupId,
      hubPermissions: [
        { permission: 'view_hidden_schema', namespaces: [], resources: [], tags: [' PII', 'internal', 'pii'] },
        { permission: 'run_agents', namespaces: [], resources: [], tags: ['pii'] },
      ],
    });
    expect(updateResponse.response?.code).toBe(EnumStatusCode.OK);

    const governance = await client.getHubGovernance({});
    const grants = governance.groups.find((g) => g.groupId === group.groupId)?.hubPermissions;

    expect(grants?.map((grant) => ({ permission: grant.permission, tags: grant.tags }))).toEqual([
      { permission: 'run_agents', tags: [] },
      { permission: 'view_hidden_schema', tags: ['internal', 'pii'] },
    ]);
  });

  test('SetGraphResourceOwners replaces the owners of one resource', async (testContext) => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );
    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);

    const fedGraph = await client.getFederatedGraphByName({ name: fedGraphName, namespace: DEFAULT_NAMESPACE });
    const team = await createOrganizationGroup(client, genID('team'));
    const governance = await client.getHubGovernance({});
    const member = governance.members[0];

    const firstResponse = await client.setGraphResourceOwners({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      resourceKind: 'type',
      resource: 'User',
      groupIds: [team.groupId],
      orgMemberIds: [member.orgMemberId],
    });
    expect(firstResponse.response?.code).toBe(EnumStatusCode.OK);

    const secondResponse = await client.setGraphResourceOwners({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      resourceKind: 'type',
      resource: 'User',
      groupIds: [team.groupId],
      orgMemberIds: [],
    });
    expect(secondResponse.response?.code).toBe(EnumStatusCode.OK);

    const ownersResponse = await client.getGraphResourceOwners({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(ownersResponse.owners.map((owner) => ({ ...owner, $typeName: undefined }))).toEqual([
      {
        federatedGraphId: fedGraph.graph!.id,
        resourceKind: 'type',
        resource: 'User',
        groupId: team.groupId,
      },
    ]);

    const badKindResponse = await client.setGraphResourceOwners({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      resourceKind: 'directive',
      resource: 'User',
      groupIds: [],
      orgMemberIds: [],
    });
    expect(badKindResponse.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role: 'organization-viewer' })),
    });

    const viewerResponse = await client.setGraphResourceOwners({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      resourceKind: 'type',
      resource: 'User',
      groupIds: [],
      orgMemberIds: [],
    });
    expect(viewerResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
  });

  test('a group change sends ORGANIZATION_GOVERNANCE_UPDATED', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });
    testContext.onTestFinished(() => server.close());

    const webhookResponse = await client.createOrganizationWebhookConfig({
      endpoint: webhookUrl,
      events: [OrganizationEventName[OrganizationEventName.ORGANIZATION_GOVERNANCE_UPDATED]],
      eventsMeta: [],
    });
    expect(webhookResponse.response?.code).toBe(EnumStatusCode.OK);

    await client.createOrganizationGroup({ name: genID('team'), description: '' });

    await vi.waitFor(() => {
      expect(capturedWebhooks).toHaveLength(1);
    });

    expect(capturedWebhooks[0]).toEqual({
      version: 1,
      event: 'ORGANIZATION_GOVERNANCE_UPDATED',
      payload: {
        organization: {
          id: users.adminAliceCompanyA.organizationId,
          slug: users.adminAliceCompanyA.organizationSlug,
        },
        actor_id: users.adminAliceCompanyA.userId,
        reason: 'group',
      },
    });
  });
});
