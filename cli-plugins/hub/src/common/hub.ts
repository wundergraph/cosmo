import { z } from 'zod';
import { createHubClient } from '@wundergraph/wgc-plugin-sdk';
import type { HubClient, PluginContext } from '@wundergraph/wgc-plugin-sdk';

export const hubGitlabTokenVariable = 'HUB_ID_TOKEN';

export const connectHub = (context: PluginContext, audience: string): HubClient =>
  createHubClient({
    baseUrl: context.endpoints.hubUrl,
    clientVersion: context.cliVersion,
    bearer: () => context.credentials.resolveBearer({ audience, gitlabTokenVariable: hubGitlabTokenVariable }),
  });

/** A sandbox as Hub's MCP tools describe it. `url` is its Hub page; `routerUrl` its GraphQL endpoint once running. */
export const sandboxShape = z.object({
  name: z.string(),
  schema: z.string(),
  status: z.string(),
  url: z.string(),
  routerUrl: z.string().nullable(),
});

export type Sandbox = z.infer<typeof sandboxShape>;

export const createSandboxResult = z.object({ sandbox: sandboxShape });
export const getSandboxResult = z.object({ sandbox: sandboxShape });
export const listSandboxesResult = z.object({ sandboxes: z.array(sandboxShape) });

export const operationResultShape = z.object({
  collection: z.string(),
  operation: z.string(),
  passed: z.boolean(),
  durationMs: z.number(),
  error: z.string().nullable(),
});

export const runCollectionResult = z.object({
  sandbox: z.string(),
  results: z.array(operationResultShape),
});

export const schemaPushResult = z.object({
  sandbox: z.object({ name: z.string(), url: z.string() }),
  composition: z.object({ errors: z.array(z.string()), warnings: z.array(z.string()) }),
});
