import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { LintSeverity } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createAPIKeyTestRBACEvaluator,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
} from '../../src/core/test-util.js';
import { DEFAULT_NAMESPACE, createNamespace, SetupTest } from '../test-util.js';

let dbname = '';

describe('Linting Configuration', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  describe('getNamespaceLintConfig', () => {
    test('Should return lint config for the default namespace (empty by default)', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.getNamespaceLintConfig({
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.configs).toEqual([]);
      expect(response.linterEnabled).toBe(false);
    });

    test('Should return lint config for a newly created namespace', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const namespace = await createNamespace(client, genID('ns'));

      const response = await client.getNamespaceLintConfig({
        namespace,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.configs).toEqual([]);
      expect(response.linterEnabled).toBe(false);
    });

    test('Should fail when namespace does not exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.getNamespaceLintConfig({
        namespace: 'nonexistent-namespace',
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(response.response?.details).toContain(`Namespace 'nonexistent-namespace' not found`);
      expect(response.configs).toEqual([]);
      expect(response.linterEnabled).toBe(false);
    });

    test('Should return configured lint rules', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const namespace = await createNamespace(client, genID('ns'));
      await client.enableLintingForTheNamespace({ namespace, enableLinting: true });

      // Configure lint rules
      await client.configureNamespaceLintConfig({
        namespace,
        configs: [
          { ruleName: 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE', severityLevel: LintSeverity.error },
          { ruleName: 'TYPE_NAMES_SHOULD_BE_PASCAL_CASE', severityLevel: LintSeverity.warn },
        ],
      });

      const response = await client.getNamespaceLintConfig({
        namespace,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.configs).toHaveLength(2);

      const fieldNamesRule = response.configs.find((c) => c.ruleName === 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE');
      expect(fieldNamesRule?.ruleName).toBe('FIELD_NAMES_SHOULD_BE_CAMEL_CASE');
      expect(fieldNamesRule?.severityLevel).toBe(LintSeverity.error);

      const typeNamesRule = response.configs.find((c) => c.ruleName === 'TYPE_NAMES_SHOULD_BE_PASCAL_CASE');
      expect(typeNamesRule?.ruleName).toBe('TYPE_NAMES_SHOULD_BE_PASCAL_CASE');
      expect(typeNamesRule?.severityLevel).toBe(LintSeverity.warn);
    });
  });

  describe('configureNamespaceLintConfig', () => {
    test('Should configure lint rules for a namespace', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const namespace = await createNamespace(client, genID('ns'));
      await client.enableLintingForTheNamespace({ namespace, enableLinting: true });

      const response = await client.configureNamespaceLintConfig({
        namespace,
        configs: [{ ruleName: 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE', severityLevel: LintSeverity.error }],
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);

      // Verify via get
      const getResponse = await client.getNamespaceLintConfig({ namespace });
      expect(getResponse.configs).toHaveLength(1);
      expect(getResponse.configs[0].ruleName).toBe('FIELD_NAMES_SHOULD_BE_CAMEL_CASE');
    });

    test('Should replace existing lint rules', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const namespace = await createNamespace(client, genID('ns'));
      await client.enableLintingForTheNamespace({ namespace, enableLinting: true });

      // First configuration
      await client.configureNamespaceLintConfig({
        namespace,
        configs: [
          { ruleName: 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE', severityLevel: LintSeverity.error },
          { ruleName: 'TYPE_NAMES_SHOULD_BE_PASCAL_CASE', severityLevel: LintSeverity.warn },
        ],
      });

      // Replace with new configuration
      const response = await client.configureNamespaceLintConfig({
        namespace,
        configs: [{ ruleName: 'ENUM_VALUES_SHOULD_BE_UPPER_CASE', severityLevel: LintSeverity.warn }],
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);

      const getResponse = await client.getNamespaceLintConfig({ namespace });
      expect(getResponse.configs).toHaveLength(1);
      expect(getResponse.configs[0].ruleName).toBe('ENUM_VALUES_SHOULD_BE_UPPER_CASE');
    });

    test('Should allow clearing lint rules by passing empty configs', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const namespace = await createNamespace(client, genID('ns'));
      await client.enableLintingForTheNamespace({ namespace, enableLinting: true });

      await client.configureNamespaceLintConfig({
        namespace,
        configs: [{ ruleName: 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE', severityLevel: LintSeverity.error }],
      });

      const response = await client.configureNamespaceLintConfig({
        namespace,
        configs: [],
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);

      const getResponse = await client.getNamespaceLintConfig({ namespace });
      expect(getResponse.configs).toEqual([]);
    });

    test('Should fail when namespace does not exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.configureNamespaceLintConfig({
        namespace: 'nonexistent-namespace',
        configs: [{ ruleName: 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE', severityLevel: LintSeverity.error }],
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(response.response?.details).toContain(`Namespace 'nonexistent-namespace' not found`);
    });

    test.each(['organization-admin', 'organization-developer', 'namespace-admin'])(
      '%s should be able to configure lint rules',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({ dbname });
        onTestFinished(() => server.close());

        const namespace = await createNamespace(client, genID('ns'));
        await client.enableLintingForTheNamespace({ namespace, enableLinting: true });

        const getNamespaceResponse = await client.getNamespace({ name: namespace });
        expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(
            createTestGroup({
              role,
              namespaces: [getNamespaceResponse.namespace!.id],
            }),
          ),
        });

        const response = await client.configureNamespaceLintConfig({
          namespace,
          configs: [{ ruleName: 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE', severityLevel: LintSeverity.error }],
        });

        expect(response.response?.code).toBe(EnumStatusCode.OK);
      },
    );

    test.each(['organization-viewer', 'namespace-viewer', 'graph-viewer', 'subgraph-viewer'])(
      '%s should NOT be able to configure lint rules',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({ dbname });
        onTestFinished(() => server.close());

        const namespace = await createNamespace(client, genID('ns'));
        await client.enableLintingForTheNamespace({ namespace, enableLinting: true });

        const getNamespaceResponse = await client.getNamespace({ name: namespace });
        expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(
            createTestGroup({
              role,
              namespaces: [getNamespaceResponse.namespace!.id],
            }),
          ),
        });

        const response = await client.configureNamespaceLintConfig({
          namespace,
          configs: [{ ruleName: 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE', severityLevel: LintSeverity.error }],
        });

        expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
      },
    );

    test('Should be able to configure lint rules when using legacy API key', async (testContext) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const namespace = await createNamespace(client, genID('ns'));
      await client.enableLintingForTheNamespace({ namespace, enableLinting: true });

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createAPIKeyTestRBACEvaluator(),
      });

      const response = await client.configureNamespaceLintConfig({
        namespace,
        configs: [{ ruleName: 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE', severityLevel: LintSeverity.error }],
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
    });
  });

  describe('enableLintingForTheNamespace', () => {
    test('Should enable linting for a namespace', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const namespace = await createNamespace(client, genID('ns'));

      const response = await client.enableLintingForTheNamespace({
        namespace,
        enableLinting: true,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);

      // Verify via get
      const getResponse = await client.getNamespaceLintConfig({ namespace });
      expect(getResponse.linterEnabled).toBe(true);
    });

    test('Should disable linting for a namespace', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const namespace = await createNamespace(client, genID('ns'));

      // Enable first
      await client.enableLintingForTheNamespace({
        namespace,
        enableLinting: true,
      });

      // Then disable
      const response = await client.enableLintingForTheNamespace({
        namespace,
        enableLinting: false,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);

      const getResponse = await client.getNamespaceLintConfig({ namespace });
      expect(getResponse.linterEnabled).toBe(false);
    });

    test('Should fail when namespace does not exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.enableLintingForTheNamespace({
        namespace: 'nonexistent-namespace',
        enableLinting: true,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(response.response?.details).toContain(`Namespace 'nonexistent-namespace' not found`);
    });

    test.each(['organization-admin', 'organization-developer', 'namespace-admin'])(
      '%s should be able to enable linting',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({ dbname });
        onTestFinished(() => server.close());

        const namespace = await createNamespace(client, genID('ns'));

        const getNamespaceResponse = await client.getNamespace({ name: namespace });
        expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(
            createTestGroup({
              role,
              namespaces: [getNamespaceResponse.namespace!.id],
            }),
          ),
        });

        const response = await client.enableLintingForTheNamespace({
          namespace,
          enableLinting: true,
        });

        expect(response.response?.code).toBe(EnumStatusCode.OK);
      },
    );

    test.each(['organization-viewer', 'namespace-viewer', 'graph-viewer', 'subgraph-viewer'])(
      '%s should NOT be able to enable linting',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({ dbname });
        onTestFinished(() => server.close());

        const namespace = await createNamespace(client, genID('ns'));

        const getNamespaceResponse = await client.getNamespace({ name: namespace });
        expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(
            createTestGroup({
              role,
              namespaces: [getNamespaceResponse.namespace!.id],
            }),
          ),
        });

        const response = await client.enableLintingForTheNamespace({
          namespace,
          enableLinting: true,
        });

        expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
      },
    );
  });
});
