import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  RecomposeFeatureFlagResponseSchema,
  PlatformService,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { createClient as createConnectClient, createRouterTransport, Transport } from '@connectrpc/connect';
import { Command } from 'commander';
import RecomposeCommand from '../../src/commands/feature-flag/commands/recompose.js';
import { Client } from '../../src/core/client/client.js';

export function createMockTransport(response: MessageInitShape<typeof RecomposeFeatureFlagResponseSchema>): Transport {
  return createRouterTransport(({ service }): void => {
    service(PlatformService, {
      recomposeFeatureFlag: () => response,
    });
  });
}

export function createClient(response: MessageInitShape<typeof RecomposeFeatureFlagResponseSchema>): Client {
  return {
    platform: createConnectClient(PlatformService, createMockTransport(response)),
  };
}

export async function runRecompose(
  response: MessageInitShape<typeof RecomposeFeatureFlagResponseSchema>,
  opts: {
    namespace?: string;
    failOnCompositionError?: boolean;
    failOnAdmissionWebhookError?: boolean;
    suppressWarnings?: boolean;
  } = {},
): Promise<void> {
  const args = ['recompose', 'feature-flag'];
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
  program.addCommand(RecomposeCommand({ client: createClient(response) }));
  await program.parseAsync(args, { from: 'user' });
}
