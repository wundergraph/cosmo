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
const isSet = (value) => value !== undefined && value !== '' && value !== 'false';
export const detectCaller = (env, interactive) => {
    if (isSet(env.CI) || ciVariables.some((name) => isSet(env[name]))) {
        return 'ci';
    }
    if (agentVariables.some((name) => isSet(env[name]))) {
        return 'agent';
    }
    return interactive ? 'human' : 'script';
};
export const prefersJson = (caller) => caller !== 'human';
//# sourceMappingURL=caller.js.map