import { type MessageInitShape } from '@bufbuild/protobuf';
import { createClient as createConnectClient, createRouterTransport, Transport } from '@connectrpc/connect';
import {
  PlatformService,
  type RecomposeGraphResponseSchema,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Command } from 'commander';
import RecomposeCommand from '../../src/commands/graph/common/recompose.js';
import { Client } from '../../src/core/client/client.js';

type RecomposeResponse = MessageInitShape<typeof RecomposeGraphResponseSchema>;

export function createMockTransport(response: RecomposeResponse): Transport {
  return createRouterTransport(({ service }): void => {
    service(PlatformService, {
      recomposeGraph: () => response,
    });
  });
}

export function createTestClient(response: RecomposeResponse): Client {
  return {
    platform: createConnectClient(PlatformService, createMockTransport(response)),
  };
}

export async function runRecompose(
  response: RecomposeResponse,
  opts: {
    isMonograph?: boolean;
    namespace?: string;
    failOnCompositionError?: boolean;
    failOnAdmissionWebhookError?: boolean;
    suppressWarnings?: boolean;
  } = {},
): Promise<void> {
  const args = ['recompose', 'mygraph'];
  if (opts.namespace) {
    args.push('--namespace', opts.namespace);
  }
  if (opts.failOnCompositionError) {
    args.push('--fail-on-composition-error');
  }
  if (opts.failOnAdmissionWebhookError) {
    args.push('--fail-on-admission-webhook-error');
  }
  if (opts.suppressWarnings) {
    args.push('--suppress-warnings');
  }

  const program = new Command();
  program.addCommand(RecomposeCommand({ client: createTestClient(response), isMonograph: opts.isMonograph ?? false }));
  await program.parseAsync(args, { from: 'user' });
}
