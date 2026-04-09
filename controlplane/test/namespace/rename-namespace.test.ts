import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createAPIKeyTestRBACEvaluator,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
} from '../../src/core/test-util.js';
import { createNamespace, SetupTest } from '../test-util.js';

let dbname = '';

describe('Rename namespace', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should rename an existing namespace', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const oldName = await createNamespace(client, genID('old_ns'));
    const newName = genID('new_ns').toLowerCase();

    const renameResponse = await client.renameNamespace({
      name: oldName,
      newName,
    });

    expect(renameResponse.response?.code).toBe(EnumStatusCode.OK);

    // Verify old name is gone and new name exists
    const getNamespacesResponse = await client.getNamespaces({});
    expect(getNamespacesResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getNamespacesResponse.namespaces?.some((ns) => ns.name === oldName)).toBe(false);
    expect(getNamespacesResponse.namespaces?.some((ns) => ns.name === newName)).toBe(true);
  });

  test('Should fail to rename a namespace that does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const nonExistentName = genID('nonexistent').toLowerCase();
    const newName = genID('new_ns').toLowerCase();

    const renameResponse = await client.renameNamespace({
      name: nonExistentName,
      newName,
    });

    expect(renameResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(renameResponse.response?.details).toBe('The namespace was not found');
  });

  test('Should fail to rename a namespace to a name that already exists', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const oldName = await createNamespace(client, genID('old_ns'));
    const existingName = await createNamespace(client, genID('existing_ns'));

    const renameResponse = await client.renameNamespace({
      name: oldName,
      newName: existingName,
    });

    expect(renameResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(renameResponse.response?.details).toBe('The new namespace name is already taken');

    // Both namespaces should still exist after the failed rename
    const getNamespacesResponse = await client.getNamespaces({});
    expect(getNamespacesResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getNamespacesResponse.namespaces?.some((ns) => ns.name === oldName)).toBe(true);
    expect(getNamespacesResponse.namespaces?.some((ns) => ns.name === existingName)).toBe(true);
  });

  test('Should fail to rename the default namespace', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const newName = genID('new_ns').toLowerCase();

    const renameResponse = await client.renameNamespace({
      name: 'default',
      newName,
    });

    expect(renameResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(renameResponse.response?.details).toBe('You cannot rename the default namespace');
  });

  test('Should fail when new name is invalid (contains special characters)', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const oldName = await createNamespace(client, genID('old_ns'));

    const renameResponse = await client.renameNamespace({
      name: oldName,
      newName: 'invalid name with spaces!',
    });

    expect(renameResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(renameResponse.response?.details).toBe(
      'The provided new name is invalid. The name can contain letters and numbers separated by underscore or hyphens',
    );
  });

  test('Should fail when new name is empty', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const oldName = await createNamespace(client, genID('old_ns'));

    const renameResponse = await client.renameNamespace({
      name: oldName,
      newName: '',
    });

    expect(renameResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(renameResponse.response?.details).toBe(
      'The provided new name is invalid. The name can contain letters and numbers separated by underscore or hyphens',
    );
  });

  test.each(['organization-admin', 'organization-developer', 'namespace-admin'])(
    '%s should be able to rename a namespace',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const oldName = await createNamespace(client, genID('old_ns'));
      const newName = genID('new_ns').toLowerCase();

      const getNamespaceResponse = await client.getNamespace({ name: oldName });
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

      const renameResponse = await client.renameNamespace({
        name: oldName,
        newName,
      });

      expect(renameResponse.response?.code).toBe(EnumStatusCode.OK);
    },
  );

  test.each([
    'organization-viewer',
    'namespace-viewer',
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
    'graph-admin',
    'graph-viewer',
  ])('%s should NOT be able to rename a namespace', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const oldName = await createNamespace(client, genID('old_ns'));
    const newName = genID('new_ns').toLowerCase();

    const getNamespaceResponse = await client.getNamespace({ name: oldName });
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

    const renameResponse = await client.renameNamespace({
      name: oldName,
      newName,
    });

    expect(renameResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
  });

  test('Should be able to rename a namespace when using legacy API key', async (testContext) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const oldName = await createNamespace(client, genID('old_ns'));
    const newName = genID('new_ns').toLowerCase();

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createAPIKeyTestRBACEvaluator(),
    });

    const renameResponse = await client.renameNamespace({
      name: oldName,
      newName,
    });

    expect(renameResponse.response?.code).toBe(EnumStatusCode.OK);
  });
});
