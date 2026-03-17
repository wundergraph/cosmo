import type { PartialMessage } from '@bufbuild/protobuf';
import { RecomposeGraphResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { createPromiseClient, createRouterTransport, Transport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { Command } from 'commander';
import RecomposeCommand from '../../src/commands/graph/common/recompose.js';
import { Client } from '../../src/core/client/client.js';

export function createMockTransport(response: PartialMessage<RecomposeGraphResponse>): Transport {
  return createRouterTransport(({ service }): void => {
    service(PlatformService, {
      recomposeGraph: () => response,
    });
  });
}

export function createClient(response: PartialMessage<RecomposeGraphResponse>): Client {
  return {
    platform: createPromiseClient(PlatformService, createMockTransport(response)),
  };
}

export async function runRecompose(
  response: PartialMessage<RecomposeGraphResponse>,
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
  program.addCommand(RecomposeCommand({ client: createClient(response), isMonograph: opts.isMonograph ?? false }));
  await program.parseAsync(args, { from: 'user' });
}
