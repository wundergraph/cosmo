import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { createAPIKeyTestRBACEvaluator, createTestGroup, createTestRBACEvaluator } from '../src/core/test-util.js';

describe('RBAC Evaluator', () => {
  const orgAdmin = createTestGroup({ role: 'organization-admin' });
  const orgDeveloper = createTestGroup({ role: 'organization-developer' });
  const orgApiKeyManager = createTestGroup({ role: 'organization-apikey-manager' });
  const orgViewer = createTestGroup({ role: 'organization-viewer' });

  const namespaceAdmin = createTestGroup({ role: 'namespace-admin' });
  const namespaceViewer = createTestGroup({ role: 'namespace-viewer' });

  const graphAdmin = createTestGroup({ role: 'graph-admin' });
  const graphViewer = createTestGroup({ role: 'graph-viewer' });

  const subgraphAdmin = createTestGroup({ role: 'subgraph-admin' });
  const subgraphPublisher = createTestGroup({ role: 'subgraph-publisher' });
  const subgraphChecker = createTestGroup({ role: 'subgraph-checker' });
  const subgraphViewer = createTestGroup({ role: 'subgraph-viewer' });

  test('Should not have access to anything when no groups are provided', () => {
    const rbac = createTestRBACEvaluator();

    expect(rbac.groups).toHaveLength(0);
    expect(rbac.isApiKey).toBe(false);
    expect(rbac.isOrganizationAdmin).toBe(false);
    expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
    expect(rbac.isOrganizationApiKeyManager).toBe(false);
    expect(rbac.isOrganizationViewer).toBe(false);
    expect(rbac.canCreateNamespace).toBe(false);
    expect(rbac.canCreateContract(fakeNamespace())).toBe(false);
    expect(rbac.canCreateFeatureFlag(fakeNamespace())).toBe(false);
    expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag())).toBe(false);
    expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag())).toBe(false);
    expect(rbac.canCreateFederatedGraph(fakeNamespace())).toBe(false);
    expect(rbac.canDeleteFederatedGraph(fakeTarget())).toBe(false);
    expect(rbac.hasFederatedGraphWriteAccess(fakeTarget())).toBe(false);
    expect(rbac.hasFederatedGraphReadAccess(fakeTarget())).toBe(false);
    expect(rbac.canCreateSubGraph(fakeNamespace())).toBe(false);
    expect(rbac.canUpdateSubGraph(fakeTarget())).toBe(false);
    expect(rbac.canDeleteSubGraph(fakeTarget())).toBe(false);
    expect(rbac.hasSubGraphWriteAccess(fakeTarget())).toBe(false);
    expect(rbac.hasSubGraphCheckAccess(fakeTarget())).toBe(false);
    expect(rbac.hasSubGraphReadAccess(fakeTarget())).toBe(false);
  });
  
  test('Should merge multiple groups', () => {
    const rbac = createTestRBACEvaluator(orgAdmin, createTestGroup({ role: 'graph-admin' }));

    expect(rbac.groups).toHaveLength(2);
    expect(rbac.isApiKey).toBe(false);
    expect(rbac.roles).toHaveLength(2);
    expect(rbac.roles.includes('organization-admin'));
    expect(rbac.roles.includes('graph-admin'));
  });

  test('Should merge groups and resources', () => {
    const id1 = randomUUID();
    const rbac = createTestRBACEvaluator(
      createTestGroup({ role: 'graph-admin', resources: [id1] }),
      createTestGroup({ role: 'graph-viewer', resources: [id1, randomUUID()] }),
      createTestGroup({ role: 'graph-viewer', resources: [id1, randomUUID()] }),
      createTestGroup({ role: 'subgraph-publisher', resources: [randomUUID()] }),
    );

    expect(rbac.groups).toHaveLength(4);
    expect(rbac.isApiKey).toBe(false);
    expect(rbac.roles).toHaveLength(3);
    expect(rbac.roles.includes('graph-admin'));
    expect(rbac.roles.includes('graph-viewer'));
    expect(rbac.roles.includes('subgraph-publisher'));
    expect(rbac.resources).toHaveLength(4);
    expect(rbac.resources.includes(id1));
  });

  test('Should be admin when using legacy API key', () => {
    const rbac = createAPIKeyTestRBACEvaluator();

    expect(rbac.isApiKey).toBe(true);
    expect(rbac.isOrganizationAdmin).toBe(true);
  });

  // Tests for every role

  describe('organization-admin', () => {
    test('Should have access to everything', () => {
      const rbac = createTestRBACEvaluator(orgAdmin);

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(true);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(true);
      expect(rbac.isOrganizationApiKeyManager).toBe(true);
      expect(rbac.isOrganizationViewer).toBe(true);
      expect(rbac.canCreateNamespace).toBe(true);
      expect(rbac.hasNamespaceWriteAccess(fakeNamespace())).toBe(true);
      expect(rbac.hasNamespaceReadAccess(fakeNamespace())).toBe(true);
      expect(rbac.canCreateContract(fakeNamespace())).toBe(true);
      expect(rbac.canCreateFeatureFlag(fakeNamespace())).toBe(true);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag())).toBe(true);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag())).toBe(true);
      expect(rbac.canCreateFederatedGraph(fakeNamespace())).toBe(true);
      expect(rbac.canDeleteFederatedGraph(fakeTarget())).toBe(true);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget())).toBe(true);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget())).toBe(true);
      expect(rbac.canCreateSubGraph(fakeNamespace())).toBe(true);
      expect(rbac.canUpdateSubGraph(fakeTarget())).toBe(true);
      expect(rbac.canDeleteSubGraph(fakeTarget())).toBe(true);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget())).toBe(true);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget())).toBe(true);
      expect(rbac.hasSubGraphReadAccess(fakeTarget())).toBe(true);
    });
  });

  describe('organization-developer', () => {
    test('Should have access to every organization resource', () => {
      const rbac = createTestRBACEvaluator(orgDeveloper);

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(true);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(true);
      expect(rbac.canCreateNamespace).toBe(true);
      expect(rbac.hasNamespaceWriteAccess(fakeNamespace())).toBe(true);
      expect(rbac.hasNamespaceReadAccess(fakeNamespace())).toBe(true);
      expect(rbac.canCreateContract(fakeNamespace())).toBe(true);
      expect(rbac.canCreateFeatureFlag(fakeNamespace())).toBe(true);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag())).toBe(true);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag())).toBe(true);
      expect(rbac.canCreateFederatedGraph(fakeNamespace())).toBe(true);
      expect(rbac.canDeleteFederatedGraph(fakeTarget())).toBe(true);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget())).toBe(true);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget())).toBe(true);
      expect(rbac.canCreateSubGraph(fakeNamespace())).toBe(true);
      expect(rbac.canUpdateSubGraph(fakeTarget())).toBe(true);
      expect(rbac.canDeleteSubGraph(fakeTarget())).toBe(true);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget())).toBe(true);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget())).toBe(true);
      expect(rbac.hasSubGraphReadAccess(fakeTarget())).toBe(true);
    });
  });

  describe('organization-apikey-manager', () => {
    test('Should only have access to API keys management', () => {
      const rbac = createTestRBACEvaluator(orgApiKeyManager);

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(true);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(fakeNamespace())).toBe(false);
      expect(rbac.hasNamespaceReadAccess(fakeNamespace())).toBe(false);
      expect(rbac.canCreateContract(fakeNamespace())).toBe(false);
      expect(rbac.canCreateFeatureFlag(fakeNamespace())).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag())).toBe(false);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag())).toBe(false);
      expect(rbac.canCreateFederatedGraph(fakeNamespace())).toBe(false);
      expect(rbac.canDeleteFederatedGraph(fakeTarget())).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget())).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget())).toBe(false);
      expect(rbac.canCreateSubGraph(fakeNamespace())).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget())).toBe(false);
      expect(rbac.canDeleteSubGraph(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphReadAccess(fakeTarget())).toBe(false);
    });
  });

  describe('organization-viewer', () => {
    test('Should have readonly access to organization', () => {
      const rbac = createTestRBACEvaluator(orgViewer);

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(true);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(fakeNamespace())).toBe(false);
      expect(rbac.hasNamespaceReadAccess(fakeNamespace())).toBe(true);
      expect(rbac.canCreateContract(fakeNamespace())).toBe(false);
      expect(rbac.canCreateFeatureFlag(fakeNamespace())).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag())).toBe(false);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag())).toBe(true);
      expect(rbac.canCreateFederatedGraph(fakeNamespace())).toBe(false);
      expect(rbac.canDeleteFederatedGraph(fakeTarget())).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget())).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget())).toBe(true);
      expect(rbac.canCreateSubGraph(fakeNamespace())).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget())).toBe(false);
      expect(rbac.canDeleteSubGraph(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphReadAccess(fakeTarget())).toBe(true);
    });
  });

  describe('namespace-admin', () => {
    test('Should have write access to every namespace', () => {
      const rbac = createTestRBACEvaluator(namespaceAdmin);

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(true);
      expect(rbac.hasNamespaceWriteAccess(fakeNamespace())).toBe(true);
      expect(rbac.hasNamespaceReadAccess(fakeNamespace())).toBe(true);
      expect(rbac.canCreateContract(fakeNamespace())).toBe(false);
      expect(rbac.canCreateFeatureFlag(fakeNamespace())).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag())).toBe(false);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag())).toBe(false);
      expect(rbac.canCreateFederatedGraph(fakeNamespace())).toBe(false);
      expect(rbac.canDeleteFederatedGraph(fakeTarget())).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget())).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget())).toBe(false);
      expect(rbac.canCreateSubGraph(fakeNamespace())).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget())).toBe(false);
      expect(rbac.canDeleteSubGraph(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphReadAccess(fakeTarget())).toBe(false);
    });

    test('Should have write access to granted namespaces', () => {
      const ns1 = fakeNamespace();
      const ns2 = fakeNamespace();
      const rbac = createTestRBACEvaluator(createTestGroup({ role: 'namespace-admin', namespaces: [ns1.id] }));

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(ns1)).toBe(true);
      expect(rbac.hasNamespaceWriteAccess(ns2)).toBe(false);
      expect(rbac.hasNamespaceReadAccess(ns1)).toBe(true);
      expect(rbac.hasNamespaceReadAccess(ns2)).toBe(false);
      expect(rbac.canCreateContract(ns1)).toBe(false);
      expect(rbac.canCreateFeatureFlag(ns1)).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag(ns1.id))).toBe(false);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag(ns1.id))).toBe(false);
      expect(rbac.canCreateFederatedGraph(ns1)).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.canCreateSubGraph(ns1)).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.canDeleteSubGraph(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasSubGraphReadAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
    });
  });

  describe('namespace-viewer', () => {
    test('Should have readonly access to every namespace', () => {
      const rbac = createTestRBACEvaluator(namespaceViewer);

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(fakeNamespace())).toBe(false);
      expect(rbac.hasNamespaceReadAccess(fakeNamespace())).toBe(true);
      expect(rbac.canCreateContract(fakeNamespace())).toBe(false);
      expect(rbac.canCreateFeatureFlag(fakeNamespace())).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag())).toBe(false);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag())).toBe(false);
      expect(rbac.canCreateFederatedGraph(fakeNamespace())).toBe(false);
      expect(rbac.canDeleteFederatedGraph(fakeTarget())).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget())).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget())).toBe(false);
      expect(rbac.canCreateSubGraph(fakeNamespace())).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget())).toBe(false);
      expect(rbac.canDeleteSubGraph(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphReadAccess(fakeTarget())).toBe(false);
    });

    test('Should have readonly access to granted namespaces', () => {
      const ns1 = fakeNamespace();
      const ns2 = fakeNamespace();
      const rbac = createTestRBACEvaluator(createTestGroup({ role: 'namespace-viewer', namespaces: [ns1.id] }));

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(ns1)).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(ns2)).toBe(false);
      expect(rbac.hasNamespaceReadAccess(ns1)).toBe(true);
      expect(rbac.hasNamespaceReadAccess(ns2)).toBe(false);
      expect(rbac.canCreateContract(ns1)).toBe(false);
      expect(rbac.canCreateFeatureFlag(ns1)).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag(ns1.id))).toBe(false);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag(ns1.id))).toBe(false);
      expect(rbac.canCreateFederatedGraph(ns1)).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.canCreateSubGraph(ns1)).toBe(false);
      expect(rbac.canDeleteSubGraph(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasSubGraphReadAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
    });
  });

  describe('graph-admin', () => {
    test('Should have write access to every graph', () => {
      const rbac = createTestRBACEvaluator(graphAdmin);

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(fakeNamespace())).toBe(false);
      expect(rbac.hasNamespaceReadAccess(fakeNamespace())).toBe(false);
      expect(rbac.canCreateContract(fakeNamespace())).toBe(true);
      expect(rbac.canCreateFeatureFlag(fakeNamespace())).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag())).toBe(false);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag())).toBe(false);
      expect(rbac.canCreateFederatedGraph(fakeNamespace())).toBe(true);
      expect(rbac.canDeleteFederatedGraph(fakeTarget())).toBe(true);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget())).toBe(true);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget())).toBe(true);
      expect(rbac.canCreateSubGraph(fakeNamespace())).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget())).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget())).toBe(false);
      expect(rbac.canDeleteSubGraph(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphReadAccess(fakeTarget())).toBe(false);
    });

    test('Should have write access to every graph granted namespace', () => {
      const ns1 = fakeNamespace();
      const ns2 = fakeNamespace();
      const rbac = createTestRBACEvaluator(createTestGroup({ role: 'graph-admin', namespaces: [ns1.id] }));

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(ns1)).toBe(false);
      expect(rbac.hasNamespaceReadAccess(ns1)).toBe(false);
      expect(rbac.canCreateContract(ns1)).toBe(true);
      expect(rbac.canCreateContract(ns2)).toBe(false);
      expect(rbac.canCreateFeatureFlag(ns1)).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag(ns1.id))).toBe(false);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag(ns1.id))).toBe(false);
      expect(rbac.canCreateFederatedGraph(ns1)).toBe(true);
      expect(rbac.canCreateFederatedGraph(ns2)).toBe(false);
      expect(rbac.canDeleteFederatedGraph(fakeTarget({ namespace: ns1.id }))).toBe(true);
      expect(rbac.canDeleteFederatedGraph(fakeTarget({ namespace: ns2.id }))).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget({ namespace: ns1.id }))).toBe(true);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget({ namespace: ns2.id }))).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget({ namespace: ns1.id }))).toBe(true);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget({ namespace: ns2.id }))).toBe(false);
      expect(rbac.canCreateSubGraph(ns1)).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.canDeleteSubGraph(fakeTarget({ namespace: ns2.id }))).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasSubGraphReadAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
    });

    test('Should have write access to granted graphs', () => {
      const ns = randomUUID();
      const graph1 = fakeTarget({ namespace: ns });
      const graph2 = fakeTarget();
      const rbac = createTestRBACEvaluator(createTestGroup({ role: 'graph-admin', resources: [graph1.targetId] }));

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(fakeNamespace(ns))).toBe(false);
      expect(rbac.hasNamespaceReadAccess(fakeNamespace(ns))).toBe(false);
      expect(rbac.canCreateContract(fakeNamespace(ns))).toBe(false);
      expect(rbac.canCreateFeatureFlag(fakeNamespace(ns))).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag(ns))).toBe(false);
      expect(rbac.canCreateFederatedGraph(fakeNamespace(ns))).toBe(false);
      expect(rbac.canDeleteFederatedGraph(graph1)).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(graph1)).toBe(true);
      expect(rbac.hasFederatedGraphWriteAccess(graph2)).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(graph1)).toBe(true);
      expect(rbac.hasFederatedGraphReadAccess(graph2)).toBe(false);
      expect(rbac.canCreateSubGraph(fakeNamespace(ns))).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.canDeleteSubGraph(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.hasSubGraphReadAccess(fakeTarget({ namespace: ns }))).toBe(false);
    });
  });

  describe('graph-viewer', () => {
    test('Should have readonly access to every graph', () => {
      const rbac = createTestRBACEvaluator(graphViewer);

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(fakeNamespace())).toBe(false);
      expect(rbac.hasNamespaceReadAccess(fakeNamespace())).toBe(false);
      expect(rbac.canCreateContract(fakeNamespace())).toBe(false);
      expect(rbac.canCreateFeatureFlag(fakeNamespace())).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag())).toBe(false);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag())).toBe(false);
      expect(rbac.canCreateFederatedGraph(fakeNamespace())).toBe(false);
      expect(rbac.canDeleteFederatedGraph(fakeTarget())).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget())).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget())).toBe(true);
      expect(rbac.canCreateSubGraph(fakeNamespace())).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget())).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget())).toBe(false);
      expect(rbac.canDeleteSubGraph(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphReadAccess(fakeTarget())).toBe(false);
    });

    test('Should have readonly access to every graph in granted namespace', () => {
      const ns1 = fakeNamespace();
      const ns2 = fakeNamespace();
      const rbac = createTestRBACEvaluator(createTestGroup({ role: 'graph-viewer', namespaces: [ns1.id] }));

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(ns1)).toBe(false);
      expect(rbac.hasNamespaceReadAccess(ns1)).toBe(false);
      expect(rbac.canCreateContract(ns1)).toBe(false);
      expect(rbac.canCreateFeatureFlag(ns1)).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag(ns1.id))).toBe(false);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag(ns1.id))).toBe(false);
      expect(rbac.canCreateFederatedGraph(ns1)).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget({ namespace: ns1.id }))).toBe(true);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget({ namespace: ns2.id }))).toBe(false);
      expect(rbac.canCreateSubGraph(ns1)).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.canDeleteSubGraph(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasSubGraphReadAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
    });

    test('Should have readonly access to granted graphs', () => {
      const ns = randomUUID();
      const graph1 = fakeTarget({ namespace: ns });
      const graph2 = fakeTarget();
      const rbac = createTestRBACEvaluator(createTestGroup({ role: 'graph-viewer', resources: [graph1.targetId] }));

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(fakeNamespace(ns))).toBe(false);
      expect(rbac.hasNamespaceReadAccess(fakeNamespace(ns))).toBe(false);
      expect(rbac.canCreateContract(fakeNamespace(ns))).toBe(false);
      expect(rbac.canCreateFeatureFlag(fakeNamespace(ns))).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag(ns))).toBe(false);
      expect(rbac.canCreateFederatedGraph(fakeNamespace(ns))).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(graph1)).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(graph1)).toBe(true);
      expect(rbac.hasFederatedGraphReadAccess(graph2)).toBe(false);
      expect(rbac.canCreateSubGraph(fakeNamespace(ns))).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.canDeleteSubGraph(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.hasSubGraphReadAccess(fakeTarget({ namespace: ns }))).toBe(false);
    });
  });

  describe('subgraph-admin', () => {
    test('Should have write access to every graph', () => {
      const rbac = createTestRBACEvaluator(subgraphAdmin);

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(fakeNamespace())).toBe(false);
      expect(rbac.hasNamespaceReadAccess(fakeNamespace())).toBe(false);
      expect(rbac.canCreateContract(fakeNamespace())).toBe(false);
      expect(rbac.canCreateFeatureFlag(fakeNamespace())).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag())).toBe(false);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag())).toBe(false);
      expect(rbac.canCreateFederatedGraph(fakeNamespace())).toBe(false);
      expect(rbac.canDeleteFederatedGraph(fakeTarget())).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget())).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget())).toBe(false);
      expect(rbac.canCreateSubGraph(fakeNamespace())).toBe(true);
      expect(rbac.canUpdateSubGraph(fakeTarget())).toBe(true);
      expect(rbac.canDeleteSubGraph(fakeTarget())).toBe(true);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget())).toBe(true);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget())).toBe(true);
      expect(rbac.hasSubGraphReadAccess(fakeTarget())).toBe(true);
    });

    test('Should have write access to every graph in granted namespace', () => {
      const ns1 = fakeNamespace();
      const ns2 = fakeNamespace();
      const rbac = createTestRBACEvaluator(createTestGroup({ role: 'subgraph-admin', namespaces: [ns1.id] }));

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(ns1)).toBe(false);
      expect(rbac.hasNamespaceReadAccess(ns1)).toBe(false);
      expect(rbac.canCreateContract(ns1)).toBe(false);
      expect(rbac.canCreateFeatureFlag(ns1)).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag(ns1.id))).toBe(false);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag(ns1.id))).toBe(false);
      expect(rbac.canCreateFederatedGraph(ns1)).toBe(false);
      expect(rbac.canDeleteFederatedGraph(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.canCreateSubGraph(ns1)).toBe(true);
      expect(rbac.canCreateSubGraph(ns2)).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget({ namespace: ns1.id }))).toBe(true);
      expect(rbac.canUpdateSubGraph(fakeTarget({ namespace: ns2.id }))).toBe(false);
      expect(rbac.canDeleteSubGraph(fakeTarget({ namespace: ns1.id }))).toBe(true);
      expect(rbac.canDeleteSubGraph(fakeTarget({ namespace: ns2.id }))).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget({ namespace: ns1.id }))).toBe(true);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget({ namespace: ns2.id }))).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget({ namespace: ns1.id }))).toBe(true);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget({ namespace: ns2.id }))).toBe(false);
      expect(rbac.hasSubGraphReadAccess(fakeTarget({ namespace: ns1.id }))).toBe(true);
      expect(rbac.hasSubGraphReadAccess(fakeTarget({ namespace: ns2.id }))).toBe(false);
    });

    test('Should have write access to granted graphs', () => {
      const ns = randomUUID();
      const graph1 = fakeTarget({ namespace: ns });
      const graph2 = fakeTarget();
      const rbac = createTestRBACEvaluator(createTestGroup({ role: 'subgraph-admin', resources: [graph1.targetId] }));

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(fakeNamespace(ns))).toBe(false);
      expect(rbac.hasNamespaceReadAccess(fakeNamespace(ns))).toBe(false);
      expect(rbac.canCreateContract(fakeNamespace(ns))).toBe(false);
      expect(rbac.canCreateFeatureFlag(fakeNamespace(ns))).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag(ns))).toBe(false);
      expect(rbac.canCreateFederatedGraph(fakeNamespace(ns))).toBe(false);
      expect(rbac.canDeleteFederatedGraph(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.canCreateSubGraph(fakeNamespace(ns))).toBe(false);
      expect(rbac.canUpdateSubGraph(graph1)).toBe(true);
      expect(rbac.canUpdateSubGraph(graph2)).toBe(false);
      expect(rbac.canDeleteSubGraph(graph1)).toBe(false);
      expect(rbac.canDeleteSubGraph(graph2)).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(graph1)).toBe(true);
      expect(rbac.hasSubGraphWriteAccess(graph2)).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(graph1)).toBe(true);
      expect(rbac.hasSubGraphCheckAccess(graph2)).toBe(false);
      expect(rbac.hasSubGraphReadAccess(graph1)).toBe(true);
      expect(rbac.hasSubGraphReadAccess(graph2)).toBe(false);
    });
  });

  describe('subgraph-publisher', () => {
    test('Should have publish access to every graph', () => {
      const rbac = createTestRBACEvaluator(subgraphPublisher);

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(fakeNamespace())).toBe(false);
      expect(rbac.hasNamespaceReadAccess(fakeNamespace())).toBe(false);
      expect(rbac.canCreateContract(fakeNamespace())).toBe(false);
      expect(rbac.canCreateFeatureFlag(fakeNamespace())).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag())).toBe(false);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag())).toBe(false);
      expect(rbac.canCreateFederatedGraph(fakeNamespace())).toBe(false);
      expect(rbac.canDeleteFederatedGraph(fakeTarget())).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget())).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget())).toBe(false);
      expect(rbac.canCreateSubGraph(fakeNamespace())).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget())).toBe(false);
      expect(rbac.canDeleteSubGraph(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget())).toBe(true);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget())).toBe(true);
      expect(rbac.hasSubGraphReadAccess(fakeTarget())).toBe(true);
    });

    test('Should have publish access to every graph in granted namespace', () => {
      const ns1 = fakeNamespace();
      const ns2 = fakeNamespace();
      const rbac = createTestRBACEvaluator(createTestGroup({ role: 'subgraph-publisher', namespaces: [ns1.id] }));

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(ns1)).toBe(false);
      expect(rbac.hasNamespaceReadAccess(ns1)).toBe(false);
      expect(rbac.canCreateContract(ns1)).toBe(false);
      expect(rbac.canCreateFeatureFlag(ns1)).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag(ns1.id))).toBe(false);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag(ns1.id))).toBe(false);
      expect(rbac.canCreateFederatedGraph(ns1)).toBe(false);
      expect(rbac.canDeleteFederatedGraph(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.canCreateSubGraph(ns1)).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.canDeleteSubGraph(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget({ namespace: ns1.id }))).toBe(true);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget({ namespace: ns2.id }))).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget({ namespace: ns1.id }))).toBe(true);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget({ namespace: ns2.id }))).toBe(false);
      expect(rbac.hasSubGraphReadAccess(fakeTarget({ namespace: ns1.id }))).toBe(true);
      expect(rbac.hasSubGraphReadAccess(fakeTarget({ namespace: ns2.id }))).toBe(false);
    });

    test('Should have publish access to granted graphs', () => {
      const ns = randomUUID();
      const graph1 = fakeTarget({ namespace: ns });
      const graph2 = fakeTarget();
      const rbac = createTestRBACEvaluator(createTestGroup({ role: 'subgraph-publisher', resources: [graph1.targetId] }));

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(fakeNamespace(ns))).toBe(false);
      expect(rbac.hasNamespaceReadAccess(fakeNamespace(ns))).toBe(false);
      expect(rbac.canCreateContract(fakeNamespace(ns))).toBe(false);
      expect(rbac.canCreateFeatureFlag(fakeNamespace(ns))).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag(ns))).toBe(false);
      expect(rbac.canCreateFederatedGraph(fakeNamespace(ns))).toBe(false);
      expect(rbac.canDeleteFederatedGraph(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.canCreateSubGraph(fakeNamespace(ns))).toBe(false);
      expect(rbac.canUpdateSubGraph(graph1)).toBe(false);
      expect(rbac.canDeleteSubGraph(graph1)).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(graph1)).toBe(true);
      expect(rbac.hasSubGraphWriteAccess(graph2)).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(graph1)).toBe(true);
      expect(rbac.hasSubGraphCheckAccess(graph2)).toBe(false);
      expect(rbac.hasSubGraphReadAccess(graph1)).toBe(true);
      expect(rbac.hasSubGraphReadAccess(graph2)).toBe(false);
    });
  });

  describe('subgraph-checker', () => {
    test('Should have check access to every graph', () => {
      const rbac = createTestRBACEvaluator(subgraphChecker);

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(fakeNamespace())).toBe(false);
      expect(rbac.hasNamespaceReadAccess(fakeNamespace())).toBe(false);
      expect(rbac.canCreateContract(fakeNamespace())).toBe(false);
      expect(rbac.canCreateFeatureFlag(fakeNamespace())).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag())).toBe(false);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag())).toBe(false);
      expect(rbac.canCreateFederatedGraph(fakeNamespace())).toBe(false);
      expect(rbac.canDeleteFederatedGraph(fakeTarget())).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget())).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget())).toBe(false);
      expect(rbac.canCreateSubGraph(fakeNamespace())).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget())).toBe(false);
      expect(rbac.canDeleteSubGraph(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget())).toBe(true);
      expect(rbac.hasSubGraphReadAccess(fakeTarget())).toBe(true);
    });

    test('Should have check access to every graph in granted namespace', () => {
      const ns1 = fakeNamespace();
      const ns2 = fakeNamespace();
      const rbac = createTestRBACEvaluator(createTestGroup({ role: 'subgraph-checker', namespaces: [ns1.id] }));

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(ns1)).toBe(false);
      expect(rbac.hasNamespaceReadAccess(ns1)).toBe(false);
      expect(rbac.canCreateContract(ns1)).toBe(false);
      expect(rbac.canCreateFeatureFlag(ns1)).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag(ns1.id))).toBe(false);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag(ns1.id))).toBe(false);
      expect(rbac.canCreateFederatedGraph(ns1)).toBe(false);
      expect(rbac.canDeleteFederatedGraph(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.canCreateSubGraph(ns1)).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.canDeleteSubGraph(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget({ namespace: ns1.id }))).toBe(true);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget({ namespace: ns2.id }))).toBe(false);
      expect(rbac.hasSubGraphReadAccess(fakeTarget({ namespace: ns1.id }))).toBe(true);
      expect(rbac.hasSubGraphReadAccess(fakeTarget({ namespace: ns2.id }))).toBe(false);
    });

    test('Should have check access to granted graphs', () => {
      const ns = randomUUID();
      const graph1 = fakeTarget({ namespace: ns });
      const graph2 = fakeTarget();
      const rbac = createTestRBACEvaluator(createTestGroup({ role: 'subgraph-checker', resources: [graph1.targetId] }));

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(fakeNamespace(ns))).toBe(false);
      expect(rbac.hasNamespaceReadAccess(fakeNamespace(ns))).toBe(false);
      expect(rbac.canCreateContract(fakeNamespace(ns))).toBe(false);
      expect(rbac.canCreateFeatureFlag(fakeNamespace(ns))).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag(ns))).toBe(false);
      expect(rbac.canCreateFederatedGraph(fakeNamespace(ns))).toBe(false);
      expect(rbac.canDeleteFederatedGraph(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.canCreateSubGraph(fakeNamespace(ns))).toBe(false);
      expect(rbac.canUpdateSubGraph(graph1)).toBe(false);
      expect(rbac.canDeleteSubGraph(graph1)).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(graph1)).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(graph1)).toBe(true);
      expect(rbac.hasSubGraphCheckAccess(graph2)).toBe(false);
      expect(rbac.hasSubGraphReadAccess(graph1)).toBe(true);
      expect(rbac.hasSubGraphReadAccess(graph2)).toBe(false);
    });
  });

  describe('subgraph-viewer', () => {
    test('Should have readonly access to every graph', () => {
      const rbac = createTestRBACEvaluator(subgraphViewer);

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(fakeNamespace())).toBe(false);
      expect(rbac.hasNamespaceReadAccess(fakeNamespace())).toBe(false);
      expect(rbac.canCreateContract(fakeNamespace())).toBe(false);
      expect(rbac.canCreateFeatureFlag(fakeNamespace())).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag())).toBe(false);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag())).toBe(false);
      expect(rbac.canCreateFederatedGraph(fakeNamespace())).toBe(false);
      expect(rbac.canDeleteFederatedGraph(fakeTarget())).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget())).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget())).toBe(false);
      expect(rbac.canCreateSubGraph(fakeNamespace())).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget())).toBe(false);
      expect(rbac.canDeleteSubGraph(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget())).toBe(false);
      expect(rbac.hasSubGraphReadAccess(fakeTarget())).toBe(true);
    });

    test('Should have readonly access to every graph in granted namespace', () => {
      const ns1 = fakeNamespace();
      const ns2 = fakeNamespace();
      const rbac = createTestRBACEvaluator(createTestGroup({ role: 'subgraph-viewer', namespaces: [ns1.id] }));

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(ns1)).toBe(false);
      expect(rbac.hasNamespaceReadAccess(ns1)).toBe(false);
      expect(rbac.canCreateContract(ns1)).toBe(false);
      expect(rbac.canCreateFeatureFlag(ns1)).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag(ns1.id))).toBe(false);
      expect(rbac.hasFeatureFlagReadAccess(fakeFeatureFlag(ns1.id))).toBe(false);
      expect(rbac.canCreateFederatedGraph(ns1)).toBe(false);
      expect(rbac.canDeleteFederatedGraph(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.canCreateSubGraph(ns1)).toBe(false);
      expect(rbac.canUpdateSubGraph(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.canDeleteSubGraph(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(fakeTarget({ namespace: ns1.id }))).toBe(false);
      expect(rbac.hasSubGraphReadAccess(fakeTarget({ namespace: ns1.id }))).toBe(true);
      expect(rbac.hasSubGraphReadAccess(fakeTarget({ namespace: ns2.id }))).toBe(false);
    });

    test('Should have readonly access to granted graphs', () => {
      const ns = randomUUID();
      const graph1 = fakeTarget({ namespace: ns });
      const graph2 = fakeTarget();
      const rbac = createTestRBACEvaluator(createTestGroup({ role: 'subgraph-viewer', resources: [graph1.targetId] }));

      expect(rbac.groups).toHaveLength(1);
      expect(rbac.isOrganizationAdmin).toBe(false);
      expect(rbac.isOrganizationAdminOrDeveloper).toBe(false);
      expect(rbac.isOrganizationApiKeyManager).toBe(false);
      expect(rbac.isOrganizationViewer).toBe(false);
      expect(rbac.canCreateNamespace).toBe(false);
      expect(rbac.hasNamespaceWriteAccess(fakeNamespace(ns))).toBe(false);
      expect(rbac.hasNamespaceReadAccess(fakeNamespace(ns))).toBe(false);
      expect(rbac.canCreateContract(fakeNamespace(ns))).toBe(false);
      expect(rbac.canCreateFeatureFlag(fakeNamespace(ns))).toBe(false);
      expect(rbac.hasFeatureFlagWriteAccess(fakeFeatureFlag(ns))).toBe(false);
      expect(rbac.canCreateFederatedGraph(fakeNamespace(ns))).toBe(false);
      expect(rbac.canDeleteFederatedGraph(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.hasFederatedGraphWriteAccess(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.hasFederatedGraphReadAccess(fakeTarget({ namespace: ns }))).toBe(false);
      expect(rbac.canCreateSubGraph(fakeNamespace(ns))).toBe(false);
      expect(rbac.canUpdateSubGraph(graph1)).toBe(false);
      expect(rbac.canDeleteSubGraph(graph1)).toBe(false);
      expect(rbac.hasSubGraphWriteAccess(graph1)).toBe(false);
      expect(rbac.hasSubGraphCheckAccess(graph1)).toBe(false);
      expect(rbac.hasSubGraphReadAccess(graph1)).toBe(true);
      expect(rbac.hasSubGraphReadAccess(graph2)).toBe(false);
    });
  });
});

function fakeNamespace(id?: string) {
  return { id: id ?? randomUUID() };
}

function fakeFeatureFlag(namespace?: string) {
  return { namespaceId: namespace ?? randomUUID() };
}

function fakeTarget(input?: { id?: string, namespace?: string, userId?: string }) {
  return {
    targetId: input?.id ?? randomUUID(),
    namespaceId: input?.namespace ?? randomUUID(),
    creatorUserId: input?.userId,
  };
}