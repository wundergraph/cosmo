import { readFileSync } from 'node:fs';
import { PartialMessage } from '@bufbuild/protobuf';
import { GitInfo } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import envCi from 'env-ci';
import { Client } from './core/client/client.js';
import { getBaseHeaders } from './core/config.js';

// https://docs.github.com/en/actions/learn-github-actions/environment-variables#default-environment-variables

function getLatestPRCommit(): string | undefined {
  try {
    const event = process.env.GITHUB_EVENT_PATH
      ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
      : undefined;

    if (event && event.pull_request) {
      return event.pull_request.head.sha;
    }
  } catch {
    return undefined;
  }
}

export function useGitHub() {
  const isPr =
    process.env.GITHUB_EVENT_NAME === 'pull_request' || process.env.GITHUB_EVENT_NAME === 'pull_request_target';

  let commit = getLatestPRCommit();
  if (!commit) {
    const env = envCi();
    commit = env.commit;
  }

  return {
    isPr,
    commit,
    build: process.env.GITHUB_RUN_ID,
    branch: process.env.GITHUB_HEAD_REF,
    repository: process.env.GITHUB_REPOSITORY,
    accountId: process.env.GITHUB_REPOSITORY_OWNER_ID,
    repositoryId: process.env.GITHUB_REPOSITORY_ID,
    root: process.env.GITHUB_WORKSPACE,
  };
}

export const verifyGitHubIntegration = async (client: Client) => {
  let gitInfo: PartialMessage<GitInfo> | undefined;
  const { isPr, commit: commitSha, repository, accountId } = useGitHub();
  if (isPr && commitSha && repository && accountId) {
    const [ownerSlug, repositorySlug] = repository?.split('/');
    gitInfo = {
      commitSha,
      accountId,
      ownerSlug,
      repositorySlug,
    };
  }

  let ignoreErrorsDueToGitHubIntegration = false;
  if (gitInfo) {
    const integrationCheckResponse = await client.platform.isGitHubAppInstalled(
      {
        gitInfo,
      },
      {
        headers: getBaseHeaders(),
      },
    );
    ignoreErrorsDueToGitHubIntegration = integrationCheckResponse.isInstalled;
    if (ignoreErrorsDueToGitHubIntegration) {
      console.log(
        'GitHub integration detected. The command will succeed and any errors detected will be reflected on commit status instead.',
      );
    }
  }

  return { gitInfo, ignoreErrorsDueToGitHubIntegration };
};
