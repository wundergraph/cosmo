import { readFileSync } from 'node:fs';

// https://docs.github.com/en/actions/learn-github-actions/environment-variables#default-environment-variables

export function parseBranch(branch: any) {
  return branch ? /^(?:refs\/heads\/)?(?<branch>.+)$/i.exec(branch)?.[1] : undefined;
}

const getPrEvent = () => {
  try {
    const event = process.env.GITHUB_EVENT_PATH
      ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
      : undefined;

    if (event && event.pull_request) {
      return {
        branch: event.pull_request.base ? parseBranch(event.pull_request.base.ref) : undefined,
        pr: event.pull_request.number,
      };
    }
  } catch {
    // Noop
  }

  return { pr: undefined, branch: undefined };
};

const getPrNumber = () => {
  const event = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
    : undefined;

  return event && event.pull_request ? event.pull_request.number : undefined;
};

export function useGitHub() {
  const isPr =
    process.env.GITHUB_EVENT_NAME === 'pull_request' || process.env.GITHUB_EVENT_NAME === 'pull_request_target';
  const branch = parseBranch(
    process.env.GITHUB_EVENT_NAME === 'pull_request_target'
      ? `refs/pull/${getPrNumber()}/merge`
      : process.env.GITHUB_REF,
  );

  return {
    commit: process.env.GITHUB_SHA,
    build: process.env.GITHUB_RUN_ID,
    isPr,
    branch,
    prBranch: isPr ? branch : undefined,
    repository: process.env.GITHUB_REPOSITORY,
    accountId: process.env.GITHUB_REPOSITORY_OWNER_ID,
    repositoryId: process.env.GITHUB_REPOSITORY_ID,
    root: process.env.GITHUB_WORKSPACE,
    ...(isPr ? getPrEvent() : undefined),
  };
}
