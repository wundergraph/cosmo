import { createHubClient, ok } from '@wundergraph/wgc-plugin-sdk';
import type { HubClient, PluginContext, Result } from '@wundergraph/wgc-plugin-sdk';
import { hubResults, hubTools } from './contract.js';
import type { SandboxLocation } from './contract.js';
import type { SandboxSelection } from './link.js';

export const hubGitlabTokenVariable = 'HUB_ID_TOKEN';

export const connectHub = (context: PluginContext, audience: string): HubClient =>
  createHubClient({
    baseUrl: context.endpoints.hubUrl,
    clientVersion: context.cliVersion,
    bearer: () => context.credentials.resolveBearer({ audience, gitlabTokenVariable: hubGitlabTokenVariable }),
  });

/** The org and graph of a selected sandbox: from the link when there is one, else from Hub. */
export const locateSandbox = async (hub: HubClient, selection: SandboxSelection): Promise<Result<SandboxLocation>> => {
  if (selection.source === 'link') {
    return ok({ orgSlug: selection.orgSlug, graphSlug: selection.graphSlug, sandboxId: selection.sandboxId });
  }

  const described = await hub.callTool(
    hubTools.describeSandbox,
    { sandbox_id: selection.sandboxId },
    hubResults.describeSandbox,
  );
  if (!described.success) {
    return described;
  }

  const { sandbox } = described.data;
  return ok({ orgSlug: sandbox.orgSlug, graphSlug: sandbox.graphSlug, sandboxId: sandbox.sandboxId });
};
