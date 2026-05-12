import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup } from '../../src/core/test-util.js';
import { SetupTest } from '../test-util.js';

let dbname = '';

describe('Onboarding', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  describe('getOnboarding', () => {
    test('returns enabled=false for non-creator developer', async (testContext) => {
      const {
        authenticator,
        client,
        server,
        users: { devJoeCompanyA },
      } = await SetupTest({ dbname, enableMultiUsers: true });
      testContext.onTestFinished(() => server.close());

      authenticator.changeUserWithSuppliedContext(devJoeCompanyA!);

      const resp = await client.getOnboarding({});

      expect(resp.response?.code).toBe(EnumStatusCode.OK);
      expect(resp.enabled).toBe(false);
      expect(resp.slack).toBe(false);
      expect(resp.email).toBe(false);
    });

    test('returns enabled=false for admin who is not the creator', async (testContext) => {
      const {
        authenticator,
        client,
        server,
        users: { adminBobCompanyA },
      } = await SetupTest({ dbname, enableMultiUsers: true });
      testContext.onTestFinished(() => server.close());

      authenticator.changeUserWithSuppliedContext(adminBobCompanyA!);

      const resp = await client.getOnboarding({});

      expect(resp.response?.code).toBe(EnumStatusCode.OK);
      expect(resp.enabled).toBe(false);
    });

    test('returns enabled=true with defaults when no onboarding record exists', async (testContext) => {
      const {
        authenticator,
        client,
        server,
        users: { adminAliceCompanyA },
      } = await SetupTest({ dbname, enableMultiUsers: true });
      testContext.onTestFinished(() => server.close());

      authenticator.changeUserWithSuppliedContext(adminAliceCompanyA);

      const resp = await client.getOnboarding({});

      expect(resp.response?.code).toBe(EnumStatusCode.OK);
      expect(resp.enabled).toBe(true);
      expect(resp.slack).toBe(false);
      expect(resp.email).toBe(false);
      expect(resp.finishedAt).toBeFalsy();
      expect(resp.federatedGraphsCount).toBe(0);
    });

    test('returns actual state after createOnboarding', async (testContext) => {
      const {
        authenticator,
        client,
        server,
        users: { adminAliceCompanyA },
      } = await SetupTest({ dbname, enableMultiUsers: true });
      testContext.onTestFinished(() => server.close());

      authenticator.changeUserWithSuppliedContext(adminAliceCompanyA);

      await client.createOnboarding({ slack: true, email: true });

      const resp = await client.getOnboarding({});

      expect(resp.response?.code).toBe(EnumStatusCode.OK);
      expect(resp.enabled).toBe(true);
      expect(resp.slack).toBe(true);
      expect(resp.email).toBe(true);
      expect(resp.finishedAt).toBeFalsy();
    });

    test('returns finishedAt after onboarding is finished', async (testContext) => {
      const {
        authenticator,
        client,
        server,
        users: { adminAliceCompanyA },
      } = await SetupTest({ dbname, enableMultiUsers: true });
      testContext.onTestFinished(() => server.close());

      authenticator.changeUserWithSuppliedContext(adminAliceCompanyA);

      await client.createOnboarding({ slack: true, email: false });
      await client.finishOnboarding({});

      const resp = await client.getOnboarding({});

      expect(resp.response?.code).toBe(EnumStatusCode.OK);
      expect(resp.enabled).toBe(true);
      expect(resp.finishedAt).toBeTruthy();
    });
  });

  describe('createOnboarding', () => {
    test('succeeds for the organization creator', async (testContext) => {
      const {
        authenticator,
        client,
        server,
        users: { adminAliceCompanyA },
      } = await SetupTest({ dbname, enableMultiUsers: true });
      testContext.onTestFinished(() => server.close());

      authenticator.changeUserWithSuppliedContext(adminAliceCompanyA);

      const resp = await client.createOnboarding({ slack: true, email: false });

      expect(resp.response?.code).toBe(EnumStatusCode.OK);
      expect(resp.slack).toBe(true);
      expect(resp.email).toBe(false);
      expect(resp.federatedGraphsCount).toBe(0);
      expect(resp.finishedAt).toBeFalsy();
    });

    test('returns ERR for non-creator admin', async (testContext) => {
      const {
        authenticator,
        client,
        server,
        users: { adminBobCompanyA },
      } = await SetupTest({ dbname, enableMultiUsers: true });
      testContext.onTestFinished(() => server.close());

      authenticator.changeUserWithSuppliedContext(adminBobCompanyA!);

      const resp = await client.createOnboarding({ slack: true, email: true });

      expect(resp.response?.code).toBe(EnumStatusCode.ERR);
      expect(resp.response?.details).toBe('Only the organization creator can create onboarding.');
    });

    test('returns ERR for developer', async (testContext) => {
      const {
        authenticator,
        client,
        server,
        users: { devJoeCompanyA },
      } = await SetupTest({ dbname, enableMultiUsers: true });
      testContext.onTestFinished(() => server.close());

      authenticator.changeUserWithSuppliedContext(devJoeCompanyA!);

      const resp = await client.createOnboarding({ slack: false, email: true });

      expect(resp.response?.code).toBe(EnumStatusCode.ERR);
      expect(resp.response?.details).toBe('Only the organization creator can create onboarding.');
    });

    test('updates existing record with upsert semantics', async (testContext) => {
      const {
        authenticator,
        client,
        server,
        users: { adminAliceCompanyA },
      } = await SetupTest({ dbname, enableMultiUsers: true });
      testContext.onTestFinished(() => server.close());

      authenticator.changeUserWithSuppliedContext(adminAliceCompanyA);

      await client.createOnboarding({ slack: true, email: false });

      const resp = await client.createOnboarding({ slack: false, email: true });

      expect(resp.response?.code).toBe(EnumStatusCode.OK);
      expect(resp.slack).toBe(false);
      expect(resp.email).toBe(true);
    });

    test('resets finishedAt when updating after finish', async (testContext) => {
      const {
        authenticator,
        client,
        server,
        users: { adminAliceCompanyA },
      } = await SetupTest({ dbname, enableMultiUsers: true });
      testContext.onTestFinished(() => server.close());

      authenticator.changeUserWithSuppliedContext(adminAliceCompanyA);

      await client.createOnboarding({ slack: true, email: true });
      await client.finishOnboarding({});

      // Update after finishing should reset finishedAt
      await client.createOnboarding({ slack: false, email: false });

      const resp = await client.getOnboarding({});

      expect(resp.response?.code).toBe(EnumStatusCode.OK);
      expect(resp.finishedAt).toBeFalsy();
      expect(resp.slack).toBe(false);
      expect(resp.email).toBe(false);
    });
  });

  describe('finishOnboarding', () => {
    test('succeeds after createOnboarding', async (testContext) => {
      const {
        authenticator,
        client,
        server,
        users: { adminAliceCompanyA },
      } = await SetupTest({ dbname, enableMultiUsers: true });
      testContext.onTestFinished(() => server.close());

      authenticator.changeUserWithSuppliedContext(adminAliceCompanyA);

      await client.createOnboarding({ slack: true, email: true });

      const resp = await client.finishOnboarding({});

      expect(resp.response?.code).toBe(EnumStatusCode.OK);
      expect(resp.finishedAt).toBeTruthy();
      expect(resp.federatedGraphsCount).toBe(0);
    });

    test('returns ERR_NOT_FOUND when no onboarding record exists', async (testContext) => {
      const {
        authenticator,
        client,
        server,
        users: { adminAliceCompanyA },
      } = await SetupTest({ dbname, enableMultiUsers: true });
      testContext.onTestFinished(() => server.close());

      authenticator.changeUserWithSuppliedContext(adminAliceCompanyA);

      const resp = await client.finishOnboarding({});

      expect(resp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(resp.response?.details).toBe('Onboarding not found');
    });

    test('returns ERR_NOT_FOUND for non-creator without record', async (testContext) => {
      const {
        authenticator,
        client,
        server,
        users: { devJoeCompanyA },
      } = await SetupTest({ dbname, enableMultiUsers: true });
      testContext.onTestFinished(() => server.close());

      authenticator.changeUserWithSuppliedContext(devJoeCompanyA!);

      const resp = await client.finishOnboarding({});

      expect(resp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    });
  });
});
