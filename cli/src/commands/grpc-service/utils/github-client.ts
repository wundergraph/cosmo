import { Octokit } from '@octokit/rest';

export const GITHUB_CONFIG = {
  owner: 'wundergraph',
  repo: 'cosmo-templates',
  ref: 'main',
  grpcServicePath: 'grpc-service',
} as const;

export function createGitHubClient(): Octokit {
  return new Octokit({
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  });
}

export async function fetchAvailableTemplates(): Promise<string[]> {
  const octokit = createGitHubClient();
  const { owner, repo, grpcServicePath } = GITHUB_CONFIG;

  try {
    const res = await octokit.repos.getContent({
      owner,
      repo,
      path: grpcServicePath,
    });

    if (Array.isArray(res.data)) {
      return res.data
        .filter((item): item is typeof item & { type: 'dir' } => item.type === 'dir')
        .map((item) => item.name);
    }
  } catch (error) {
    throw new Error(`Failed to fetch templates from GitHub: ${error instanceof Error ? error.message : String(error)}`);
  }

  return [];
}
