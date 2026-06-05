import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createPromiseClient, createRouterTransport, type ServiceImpl } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { FederatedGraph, Subgraph } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Client } from '../../src/core/client/client.js';
import DemoCommand from '../../src/commands/demo/index.js';
import { waitForKeyPress } from '../../src/utils.js';
import * as demoUtil from '../../src/commands/demo/util.js';

vi.mock('../../src/commands/auth/utils.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/commands/auth/utils.js')>();
  return { ...mod, checkAuth: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../src/commands/demo/util.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/commands/demo/util.js')>();
  return {
    ...mod,
    prepareSupportingData: vi.fn(),
    checkDockerReadiness: vi.fn(),
    publishAllPlugins: vi.fn(),
    runRouterContainer: vi.fn(),
    getDemoLogPath: vi.fn(),
    captureOnboardingEvent: vi.fn(),
  };
});

vi.mock('../../src/utils.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/utils.js')>();
  return { ...mod, waitForKeyPress: vi.fn() };
});

type PlatformOverrides = Partial<ServiceImpl<typeof PlatformService>>;

function createMockTransport(overrides: PlatformOverrides = {}) {
  return createRouterTransport(({ service }) => {
    service(PlatformService, {
      whoAmI: () => ({
        response: { code: EnumStatusCode.OK },
        userEmail: 'test@example.com',
        organizationName: 'TestOrg',
      }),
      getOnboarding: () => ({
        response: { code: EnumStatusCode.OK },
        enabled: true,
      }),
      getFederatedGraphByName: () => ({
        response: { code: EnumStatusCode.ERR_NOT_FOUND, details: 'not found' },
      }),
      createFederatedGraph: () => ({
        response: { code: EnumStatusCode.OK },
      }),
      deleteFederatedGraph: () => ({
        response: { code: EnumStatusCode.OK },
      }),
      deleteFederatedSubgraph: () => ({
        response: { code: EnumStatusCode.OK },
      }),
      createFederatedGraphToken: () => ({
        response: { code: EnumStatusCode.OK },
        token: 'test-token',
      }),
      deleteRouterToken: () => ({
        response: { code: EnumStatusCode.OK },
      }),
      ...overrides,
    });
  });
}

function runDemo(overrides: PlatformOverrides = {}) {
  const client: Client = {
    platform: createPromiseClient(PlatformService, createMockTransport(overrides)),
  };
  const program = new Command();
  program.addCommand(DemoCommand({ client }));
  return program.parseAsync(['demo'], { from: 'user' });
}

// Queues responses for upcoming waitForKeyPress calls. Call these in the order the command will prompt.
const keys = {
  enter: () => vi.mocked(waitForKeyPress).mockResolvedValueOnce(undefined),
  press: (key: string) =>
    vi.mocked(waitForKeyPress).mockImplementationOnce(async (keyMap) => {
      const entry = keyMap[key];
      if (typeof entry !== 'function') {
        throw new TypeError(`waitForKeyPress was not given a function handler for '${key}'`);
      }
      await entry();
    }),
};

describe('Demo command', () => {
  let exitSpy: MockInstance<typeof process.exit>;

  beforeEach(() => {
    // Silence the demo command's logo, welcome banner, and spinner output so CI logs stay readable.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    vi.mocked(demoUtil.prepareSupportingData).mockResolvedValue('/tmp/cosmo-demo');
    vi.mocked(demoUtil.checkDockerReadiness).mockResolvedValue(undefined);
    vi.mocked(demoUtil.publishAllPlugins).mockResolvedValue({ error: null });
    vi.mocked(demoUtil.runRouterContainer).mockResolvedValue({ error: null });
    vi.mocked(demoUtil.getDemoLogPath).mockReturnValue('/tmp/demo.log');
  });

  describe('happy path', () => {
    it('fresh setup: creates graph, publishes plugins, starts router', async () => {
      keys.enter();

      await runDemo();

      expect(demoUtil.prepareSupportingData).toHaveBeenCalledOnce();
      expect(demoUtil.checkDockerReadiness).toHaveBeenCalledOnce();
      expect(demoUtil.publishAllPlugins).toHaveBeenCalledOnce();
      expect(demoUtil.runRouterContainer).toHaveBeenCalledOnce();
      expect(demoUtil.runRouterContainer).toHaveBeenCalledWith(expect.objectContaining({ routerToken: 'test-token' }));
    });

    it('existing graph: continues with existing graph', async () => {
      const overrides: PlatformOverrides = {
        getFederatedGraphByName: () => ({
          response: { code: EnumStatusCode.OK },
          graph: new FederatedGraph({
            name: 'demo',
            namespace: 'default',
            routingURL: 'http://localhost:3002/graphql',
          }),
          subgraphs: [],
        }),
      };

      keys.enter();
      keys.enter();

      await runDemo(overrides);

      expect(demoUtil.publishAllPlugins).toHaveBeenCalledOnce();
      expect(demoUtil.runRouterContainer).toHaveBeenCalledOnce();
    });

    it('existing graph: deletes graph and exits', async () => {
      const overrides: PlatformOverrides = {
        getFederatedGraphByName: () => ({
          response: { code: EnumStatusCode.OK },
          graph: new FederatedGraph({
            name: 'demo',
            namespace: 'default',
            routingURL: 'http://localhost:3002/graphql',
          }),
          subgraphs: [new Subgraph({ name: 'products', namespace: 'default' })],
        }),
      };

      keys.enter();
      keys.press('d');

      await expect(runDemo(overrides)).rejects.toThrow('process.exit');

      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(demoUtil.publishAllPlugins).not.toHaveBeenCalled();
      expect(demoUtil.runRouterContainer).not.toHaveBeenCalled();
    });
  });

  describe('non-recoverable errors', () => {
    it('exits when whoAmI RPC fails', async () => {
      const overrides: PlatformOverrides = {
        whoAmI: () => ({
          response: { code: EnumStatusCode.ERR, details: 'Unauthorized' },
        }),
      };

      await expect(runDemo(overrides)).rejects.toThrow('process.exit');

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(demoUtil.publishAllPlugins).not.toHaveBeenCalled();
    });

    it('exits when user is not an organization owner', async () => {
      const overrides: PlatformOverrides = {
        getOnboarding: () => ({
          response: { code: EnumStatusCode.OK },
          enabled: false,
        }),
      };

      keys.enter();

      await expect(runDemo(overrides)).rejects.toThrow('process.exit');

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(demoUtil.publishAllPlugins).not.toHaveBeenCalled();
    });

    it('exits when docker is unavailable', async () => {
      vi.mocked(demoUtil.checkDockerReadiness).mockImplementationOnce(() => {
        process.exit(1);
      });

      await expect(runDemo()).rejects.toThrow('process.exit');

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(demoUtil.publishAllPlugins).not.toHaveBeenCalled();
    });

    it('exits when github fetch fails', async () => {
      vi.mocked(demoUtil.prepareSupportingData).mockImplementationOnce(() => {
        process.exit(1);
      });

      await expect(runDemo()).rejects.toThrow('process.exit');

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(demoUtil.checkDockerReadiness).not.toHaveBeenCalled();
    });
  });

  describe('retrying failures', () => {
    it('user retries after plugin publishing fails', async () => {
      vi.mocked(demoUtil.publishAllPlugins)
        .mockResolvedValueOnce({ error: new Error('build failed') })
        .mockResolvedValueOnce({ error: null });

      keys.enter();
      keys.press('r');

      await runDemo();

      expect(demoUtil.publishAllPlugins).toHaveBeenCalledTimes(2);
      expect(demoUtil.runRouterContainer).toHaveBeenCalledOnce();
    });

    it('user retries after router fails to start', async () => {
      vi.mocked(demoUtil.runRouterContainer)
        .mockResolvedValueOnce({ error: new Error('container exited') })
        .mockResolvedValueOnce({ error: null });

      keys.enter();
      keys.press('r');

      await runDemo();

      expect(demoUtil.runRouterContainer).toHaveBeenCalledTimes(2);
    });

    it('user retries after graph lookup fails', async () => {
      const getGraphFn = vi
        .fn()
        .mockReturnValueOnce({ response: { code: EnumStatusCode.ERR, details: 'service unavailable' } })
        .mockReturnValue({ response: { code: EnumStatusCode.ERR_NOT_FOUND, details: 'not found' } });

      keys.enter();
      keys.press('r');

      await runDemo({ getFederatedGraphByName: getGraphFn });

      expect(getGraphFn).toHaveBeenCalledTimes(2);
      expect(demoUtil.runRouterContainer).toHaveBeenCalledOnce();
    });
  });

  describe('event tracking', () => {
    it('fires completed events on happy path', async () => {
      keys.enter();

      await runDemo();

      expect(demoUtil.captureOnboardingEvent).toHaveBeenCalledWith({
        name: 'onboarding_step_completed',
        properties: { step_name: 'init', entry_source: 'wgc' },
      });
      expect(demoUtil.captureOnboardingEvent).toHaveBeenCalledWith({
        name: 'onboarding_step_completed',
        properties: { step_name: 'check_onboarding', entry_source: 'wgc' },
      });
      expect(demoUtil.captureOnboardingEvent).toHaveBeenCalledWith({
        name: 'onboarding_step_completed',
        properties: { step_name: 'create_federated_graph', entry_source: 'wgc' },
      });
    });

    it('fires delete_federated_graph completed when user deletes existing graph', async () => {
      const overrides: PlatformOverrides = {
        getFederatedGraphByName: () => ({
          response: { code: EnumStatusCode.OK },
          graph: new FederatedGraph({
            name: 'demo',
            namespace: 'default',
            routingURL: 'http://localhost:3002/graphql',
          }),
          subgraphs: [new Subgraph({ name: 'products', namespace: 'default' })],
        }),
      };

      keys.enter();
      keys.press('d');

      await expect(runDemo(overrides)).rejects.toThrow('process.exit');

      expect(demoUtil.captureOnboardingEvent).toHaveBeenCalledWith({
        name: 'onboarding_step_completed',
        properties: { step_name: 'delete_federated_graph', entry_source: 'wgc' },
      });
    });

    it('fires init failed when whoAmI RPC fails', async () => {
      const overrides: PlatformOverrides = {
        whoAmI: () => ({
          response: { code: EnumStatusCode.ERR, details: 'Unauthorized' },
        }),
      };

      await expect(runDemo(overrides)).rejects.toThrow('process.exit');

      expect(demoUtil.captureOnboardingEvent).toHaveBeenCalledWith({
        name: 'onboarding_step_failed',
        properties: {
          step_name: 'init',
          entry_source: 'wgc',
          error_category: 'resource',
          error_message: expect.any(String),
        },
      });
    });

    it('fires check_onboarding failed when user is not org owner', async () => {
      const overrides: PlatformOverrides = {
        getOnboarding: () => ({
          response: { code: EnumStatusCode.OK },
          enabled: false,
        }),
      };

      keys.enter();

      await expect(runDemo(overrides)).rejects.toThrow('process.exit');

      expect(demoUtil.captureOnboardingEvent).toHaveBeenCalledWith({
        name: 'onboarding_step_failed',
        properties: {
          step_name: 'check_onboarding',
          entry_source: 'wgc',
          error_category: 'resource',
          error_message: expect.any(String),
        },
      });
    });

    it('fires check_onboarding failed when getOnboarding RPC errors', async () => {
      const getOnboardingFn = vi
        .fn()
        .mockReturnValueOnce({ response: { code: EnumStatusCode.ERR, details: 'rpc error' } })
        .mockReturnValue({ response: { code: EnumStatusCode.OK }, enabled: true });

      keys.enter();
      keys.press('Enter');

      await runDemo({ getOnboarding: getOnboardingFn });

      expect(demoUtil.captureOnboardingEvent).toHaveBeenCalledWith({
        name: 'onboarding_step_failed',
        properties: {
          step_name: 'check_onboarding',
          entry_source: 'wgc',
          error_category: 'resource',
          error_message: expect.any(String),
        },
      });
    });

    it('fires delete_federated_graph failed when graph deletion fails', async () => {
      const overrides: PlatformOverrides = {
        getFederatedGraphByName: () => ({
          response: { code: EnumStatusCode.OK },
          graph: new FederatedGraph({
            name: 'demo',
            namespace: 'default',
            routingURL: 'http://localhost:3002/graphql',
          }),
          subgraphs: [new Subgraph({ name: 'products', namespace: 'default' })],
        }),
        deleteFederatedGraph: () => ({
          response: { code: EnumStatusCode.ERR, details: 'deletion failed' },
        }),
      };

      keys.enter();
      keys.press('d');
      keys.press('Enter');

      await expect(runDemo(overrides)).rejects.toThrow('process.exit');

      expect(demoUtil.captureOnboardingEvent).toHaveBeenCalledWith({
        name: 'onboarding_step_failed',
        properties: {
          step_name: 'delete_federated_graph',
          entry_source: 'wgc',
          error_category: 'resource',
          error_message: expect.any(String),
        },
      });
    });

    it('fires run_router_send_metrics failed when deleteRouterToken RPC fails', async () => {
      const deleteRouterTokenFn = vi
        .fn()
        .mockReturnValueOnce({ response: { code: EnumStatusCode.ERR, details: 'token error' } })
        .mockReturnValue({ response: { code: EnumStatusCode.OK } });

      keys.enter();
      keys.press('r');

      await runDemo({ deleteRouterToken: deleteRouterTokenFn });

      expect(demoUtil.captureOnboardingEvent).toHaveBeenCalledWith({
        name: 'onboarding_step_failed',
        properties: {
          step_name: 'run_router_send_metrics',
          entry_source: 'wgc',
          error_category: 'router',
          error_message: expect.any(String),
        },
      });
    });

    it('fires run_router_send_metrics failed when createFederatedGraphToken RPC fails', async () => {
      const createFederatedGraphTokenFn = vi
        .fn()
        .mockReturnValueOnce({ response: { code: EnumStatusCode.ERR, details: 'create token error' } })
        .mockReturnValue({ response: { code: EnumStatusCode.OK }, token: 'test-token' });

      keys.enter();
      keys.press('r');

      await runDemo({ createFederatedGraphToken: createFederatedGraphTokenFn });

      expect(demoUtil.captureOnboardingEvent).toHaveBeenCalledWith({
        name: 'onboarding_step_failed',
        properties: {
          step_name: 'run_router_send_metrics',
          entry_source: 'wgc',
          error_category: 'router',
          error_message: expect.any(String),
        },
      });
    });

    it('fires run_router_send_metrics failed when router exits with error', async () => {
      vi.mocked(demoUtil.runRouterContainer)
        .mockResolvedValueOnce({ error: new Error('container exited') })
        .mockResolvedValueOnce({ error: null });

      keys.enter();
      keys.press('r');

      await runDemo();

      expect(demoUtil.captureOnboardingEvent).toHaveBeenCalledWith({
        name: 'onboarding_step_failed',
        properties: {
          step_name: 'run_router_send_metrics',
          entry_source: 'wgc',
          error_category: 'router',
          error_message: expect.any(String),
        },
      });
    });
  });
});
