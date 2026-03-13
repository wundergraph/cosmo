import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';
import { type PartialMessage } from '@bufbuild/protobuf';
import { createPromiseClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { PublishFederatedSubgraphResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { dirname } from 'pathe';
import { Client } from '../src/core/client/client.js';
import PublishSchema from '../src/commands/subgraph/commands/publish.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, 'fixtures', 'schema.graphql');

function createMockTransport(response: PartialMessage<PublishFederatedSubgraphResponse>) {
  return createRouterTransport(({ service }) => {
    service(PlatformService, {
      publishFederatedSubgraph: () => response,
    });
  });
}

async function runPublish(
  response: PartialMessage<PublishFederatedSubgraphResponse>,
  opts: {
    failOnCompositionError?: boolean;
    failOnAdmissionWebhookError?: boolean;
    suppressWarnings?: boolean;
  } = {},
): Promise<void> {
  const args = ['publish', 'wg.orders', '--schema', schemaPath];
  if (opts.failOnCompositionError) {
    args.push('--fail-on-composition-error');
  }
  if (opts.failOnAdmissionWebhookError) {
    args.push('--fail-on-admission-webhook-error');
  }
  if (opts.suppressWarnings) {
    args.push('--suppress-warnings');
  }

  const client: Client = {
    platform: createPromiseClient(PlatformService, createMockTransport(response)),
  };
  const program = new Command();
  program.addCommand(PublishSchema({ client }));
  await program.parseAsync(args, { from: 'user' });
}

export const mockPlatformTransport = () =>
  createRouterTransport(({ service }) => {
    service(PlatformService, {
      publishFederatedSubgraph: (ctx) => {
        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      },
    });
  });

describe('Schema Command', () => {
  test('Publish Schema', () => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
      // @ts-ignore
      node: null,
    };

    const program = new Command();

    program.addCommand(
      PublishSchema({
        client,
      }),
    );
    const command = program.parse(['publish', 'wg.orders', '--schema', schemaPath], {
      from: 'user',
    });
  });
});

describe('truncation warning', () => {
  let logSpy: MockInstance<typeof console.log>;
  let stderrSpy: MockInstance<typeof process.stderr.write>;
  let exitSpy: MockInstance<typeof process.exit>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  test('shows truncation warning when composition errors exceed displayed count', async () => {
    await runPublish({
      response: { code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED },
      compositionErrors: [
        { federatedGraphName: 'graph1', namespace: 'default', message: 'Error 1' },
        { federatedGraphName: 'graph2', namespace: 'default', message: 'Error 2' },
      ],
      compositionWarnings: [],
      deploymentErrors: [],
      counts: {
        compositionErrors: 10,
        compositionWarnings: 0,
        deploymentErrors: 0,
      },
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Some results were truncated'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('composition errors (2 of 10 shown)'));
  });

  test('shows truncation warning when composition warnings exceed displayed count', async () => {
    await runPublish({
      response: { code: EnumStatusCode.OK },
      compositionErrors: [],
      compositionWarnings: [{ federatedGraphName: 'graph1', namespace: 'default', message: 'Warning 1' }],
      deploymentErrors: [],
      counts: {
        compositionErrors: 0,
        compositionWarnings: 5,
        deploymentErrors: 0,
      },
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Some results were truncated'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('composition warnings (1 of 5 shown)'));
  });

  test('shows truncation warning when deployment errors exceed displayed count', async () => {
    await runPublish({
      response: { code: EnumStatusCode.ERR_DEPLOYMENT_FAILED },
      compositionErrors: [],
      compositionWarnings: [],
      deploymentErrors: [{ federatedGraphName: 'graph1', namespace: 'default', message: 'Deploy Error 1' }],
      counts: {
        compositionErrors: 0,
        compositionWarnings: 0,
        deploymentErrors: 3,
      },
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Some results were truncated'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('deployment errors (1 of 3 shown)'));
  });

  test('does not show truncation warning when counts match displayed items', async () => {
    await runPublish({
      response: { code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED },
      compositionErrors: [
        { federatedGraphName: 'graph1', namespace: 'default', message: 'Error 1' },
        { federatedGraphName: 'graph2', namespace: 'default', message: 'Error 2' },
      ],
      compositionWarnings: [],
      deploymentErrors: [],
      counts: {
        compositionErrors: 2,
        compositionWarnings: 0,
        deploymentErrors: 0,
      },
    });

    const truncationCalls = logSpy.mock.calls.filter(([arg]) => typeof arg === 'string' && arg.includes('truncated'));
    expect(truncationCalls).toHaveLength(0);
  });

  test('does not show truncation warning when counts are not provided', async () => {
    await runPublish({
      response: { code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED },
      compositionErrors: [{ federatedGraphName: 'graph1', namespace: 'default', message: 'Error 1' }],
      compositionWarnings: [],
      deploymentErrors: [],
    });

    const truncationCalls = logSpy.mock.calls.filter(([arg]) => typeof arg === 'string' && arg.includes('truncated'));
    expect(truncationCalls).toHaveLength(0);
  });

  test('shows truncation warning before program.error when failOnCompositionError is set', async () => {
    await expect(
      runPublish(
        {
          response: { code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED },
          compositionErrors: [{ federatedGraphName: 'graph1', namespace: 'default', message: 'Error 1' }],
          compositionWarnings: [],
          deploymentErrors: [],
          counts: {
            compositionErrors: 5,
            compositionWarnings: 0,
            deploymentErrors: 0,
          },
        },
        { failOnCompositionError: true },
      ),
    ).rejects.toThrow('process.exit');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Some results were truncated'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('composition errors (1 of 5 shown)'));
  });

  test('shows truncation warning before program.error when failOnAdmissionWebhookError is set', async () => {
    await expect(
      runPublish(
        {
          response: { code: EnumStatusCode.ERR_DEPLOYMENT_FAILED },
          compositionErrors: [],
          compositionWarnings: [],
          deploymentErrors: [{ federatedGraphName: 'graph1', namespace: 'default', message: 'Deploy Error 1' }],
          counts: {
            compositionErrors: 0,
            compositionWarnings: 0,
            deploymentErrors: 8,
          },
        },
        { failOnAdmissionWebhookError: true },
      ),
    ).rejects.toThrow('process.exit');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Some results were truncated'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('deployment errors (1 of 8 shown)'));
  });

  test('shows multiple truncation items when multiple types are truncated', async () => {
    await runPublish({
      response: { code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED },
      compositionErrors: [{ federatedGraphName: 'graph1', namespace: 'default', message: 'Error 1' }],
      compositionWarnings: [{ federatedGraphName: 'graph1', namespace: 'default', message: 'Warning 1' }],
      deploymentErrors: [],
      counts: {
        compositionErrors: 100,
        compositionWarnings: 50,
        deploymentErrors: 0,
      },
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('composition errors (1 of 100 shown)'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('composition warnings (1 of 50 shown)'));
  });

  test('does not show warnings truncation when suppressWarnings is set', async () => {
    await runPublish(
      {
        response: { code: EnumStatusCode.OK },
        compositionErrors: [],
        compositionWarnings: [{ federatedGraphName: 'graph1', namespace: 'default', message: 'Warning 1' }],
        deploymentErrors: [],
        counts: {
          compositionErrors: 0,
          compositionWarnings: 10,
          deploymentErrors: 0,
        },
      },
      { suppressWarnings: true },
    );

    const warningTableCalls = logSpy.mock.calls.filter(
      ([arg]) => typeof arg === 'string' && arg.includes('warnings were produced'),
    );
    expect(warningTableCalls).toHaveLength(0);
  });
});
