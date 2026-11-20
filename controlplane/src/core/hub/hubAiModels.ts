import { z } from 'zod';

const HubAiModels = z.object({
  models: z.array(
    z.object({
      provider: z.string(),
      tier: z.string(),
      gatewayModelId: z.string(),
      name: z.string(),
    }),
  ),
  deploymentModel: z.string(),
});

export type HubAiModels = z.infer<typeof HubAiModels>;

// The models Hub offers for its AI settings, as Hub's backend lists them.
export async function fetchHubAiModels(hubApiUrl: string): Promise<HubAiModels> {
  const response = await fetch(new URL('/ai/models', hubApiUrl), { signal: AbortSignal.timeout(5000) });
  if (!response.ok) {
    throw new Error(`Hub answered ${response.status} for its AI models`);
  }
  return HubAiModels.parse(await response.json());
}
