import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, createTestGroup, createTestRBACEvaluator } from '../../src/core/test-util.js';
import { SetupTest } from '../test-util.js';

let dbname = '';

describe('Playground Scripts', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  describe('createPlaygroundScript', () => {
    test('Should create a playground script', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.createPlaygroundScript({
        title: 'My Script',
        type: 'pre-flight',
        content: "console.log('hello world')",
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);

      // Verify via list
      const listResponse = await client.getPlaygroundScripts({ type: 'pre-flight' });
      expect(listResponse.response?.code).toBe(EnumStatusCode.OK);
      const created = listResponse.scripts.find((s) => s.title === 'My Script');
      expect(created?.title).toBe('My Script');
      expect(created?.content).toBe("console.log('hello world')");
    });

    test.each(['organization-admin', 'organization-developer'])(
      '%s should be able to create a playground script',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({ dbname });
        onTestFinished(() => server.close());

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(createTestGroup({ role })),
        });

        const response = await client.createPlaygroundScript({
          title: 'Admin Script',
          type: 'pre-flight',
          content: "console.log('admin')",
        });

        expect(response.response?.code).toBe(EnumStatusCode.OK);
      },
    );

    test.each([
      'organization-viewer',
      'organization-apikey-manager',
      'namespace-admin',
      'namespace-viewer',
      'graph-admin',
      'graph-viewer',
      'subgraph-admin',
      'subgraph-publisher',
      'subgraph-viewer',
    ])('%s should NOT be able to create a playground script', async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const response = await client.createPlaygroundScript({
        title: 'Unauthorized Script',
        type: 'pre-flight',
        content: "console.log('nope')",
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    });
  });

  describe('getPlaygroundScripts', () => {
    test('Should return empty list when no scripts exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.getPlaygroundScripts({ type: 'pre-flight' });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.scripts).toEqual([]);
    });

    test('Should return scripts filtered by type', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      await client.createPlaygroundScript({
        title: 'Pre-flight Script',
        type: 'pre-flight',
        content: "console.log('pre')",
      });

      const preFlightResponse = await client.getPlaygroundScripts({ type: 'pre-flight' });
      expect(preFlightResponse.response?.code).toBe(EnumStatusCode.OK);
      expect(preFlightResponse.scripts).toHaveLength(1);
      expect(preFlightResponse.scripts[0].title).toBe('Pre-flight Script');
    });

    test('Should return multiple scripts', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      await client.createPlaygroundScript({
        title: 'Script 1',
        type: 'pre-flight',
        content: "console.log('1')",
      });
      await client.createPlaygroundScript({
        title: 'Script 2',
        type: 'pre-flight',
        content: "console.log('2')",
      });

      const response = await client.getPlaygroundScripts({ type: 'pre-flight' });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.scripts).toHaveLength(2);
    });

    test.each([
      'organization-admin',
      'organization-developer',
      'organization-viewer',
      'namespace-admin',
      'graph-admin',
      'subgraph-admin',
    ])('%s should be able to list playground scripts', async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const response = await client.getPlaygroundScripts({ type: 'pre-flight' });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
    });
  });

  describe('updatePlaygroundScript', () => {
    test('Should update an existing script', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      await client.createPlaygroundScript({
        title: 'Original Title',
        type: 'pre-flight',
        content: 'original',
      });

      const list = await client.getPlaygroundScripts({ type: 'pre-flight' });
      const scriptId = list.scripts[0].id;

      const response = await client.updatePlaygroundScript({
        id: scriptId,
        title: 'Updated Title',
        content: 'updated',
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);

      const listAfter = await client.getPlaygroundScripts({ type: 'pre-flight' });
      const updated = listAfter.scripts.find((s) => s.id === scriptId);
      expect(updated?.title).toBe('Updated Title');
      expect(updated?.content).toBe('updated');
    });

    test.each([
      'organization-viewer',
      'organization-apikey-manager',
      'namespace-admin',
      'graph-admin',
      'subgraph-admin',
    ])('%s should NOT be able to update a playground script', async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      await client.createPlaygroundScript({
        title: 'Script',
        type: 'pre-flight',
        content: 'content',
      });

      const list = await client.getPlaygroundScripts({ type: 'pre-flight' });
      const scriptId = list.scripts[0].id;

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const response = await client.updatePlaygroundScript({
        id: scriptId,
        title: 'New Title',
        content: 'new content',
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    });
  });

  describe('deletePlaygroundScript', () => {
    test('Should delete an existing script', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      await client.createPlaygroundScript({
        title: 'To Delete',
        type: 'pre-flight',
        content: 'content',
      });

      const list = await client.getPlaygroundScripts({ type: 'pre-flight' });
      const scriptId = list.scripts[0].id;

      const response = await client.deletePlaygroundScript({
        id: scriptId,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);

      const listAfter = await client.getPlaygroundScripts({ type: 'pre-flight' });
      expect(listAfter.scripts.find((s) => s.id === scriptId)).toBe(undefined);
    });

    test.each([
      'organization-viewer',
      'organization-apikey-manager',
      'namespace-admin',
      'graph-admin',
      'subgraph-admin',
    ])('%s should NOT be able to delete a playground script', async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      await client.createPlaygroundScript({
        title: 'Script',
        type: 'pre-flight',
        content: 'content',
      });

      const list = await client.getPlaygroundScripts({ type: 'pre-flight' });
      const scriptId = list.scripts[0].id;

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const response = await client.deletePlaygroundScript({
        id: scriptId,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    });
  });
});
