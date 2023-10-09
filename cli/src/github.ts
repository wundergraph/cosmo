import { readFileSync } from 'node:fs';

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

  const commit = getLatestPRCommit();

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
