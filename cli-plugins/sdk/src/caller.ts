/**
 * Who runs the command. Only a human at a terminal gets prompts and readable output by default;
 * agents, CI and other non-interactive callers get prompt-free JSON.
 */
export type CallerKind = 'human' | 'agent' | 'ci' | 'script';

const ciVariables = ['GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI', 'JENKINS_URL', 'TF_BUILD'];

const agentVariables = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CODEX_SANDBOX',
  'CODEX_MANAGED_BY_NPM',
  'CURSOR_AGENT',
  'GEMINI_CLI',
  'OPENCODE',
  'AGENT',
];

const isSet = (value: string | undefined): boolean => value !== undefined && value !== '' && value !== 'false';

export const detectCaller = (env: NodeJS.ProcessEnv, interactive: boolean): CallerKind => {
  if (isSet(env.CI) || ciVariables.some((name) => isSet(env[name]))) {
    return 'ci';
  }

  if (agentVariables.some((name) => isSet(env[name]))) {
    return 'agent';
  }

  return interactive ? 'human' : 'script';
};

export const prefersJson = (caller: CallerKind): boolean => caller !== 'human';
