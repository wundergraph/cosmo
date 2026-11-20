import { createHubClient } from '@wundergraph/wgc-plugin-sdk';
import type { HubClient, PluginContext } from '@wundergraph/wgc-plugin-sdk';

export const hubGitlabTokenVariable = 'HUB_ID_TOKEN';

export const connectHub = (context: PluginContext, audience: string): HubClient =>
  createHubClient({
    baseUrl: context.endpoints.hubUrl,
    clientVersion: context.cliVersion,
    bearer: () => context.credentials.resolveBearer({ audience, gitlabTokenVariable: hubGitlabTokenVariable }),
  });
