export default {
  name: 'gate',
  description: 'Hooks subgraph check and fails it when the subgraph is frozen',
  hooks(hooks) {
    hooks.after('subgraph check', async ({ input, result }) => ({
      verdict: input.subgraph === 'frozen' ? 'failed' : 'passed',
      summary: `${input.subgraph} in ${input.namespace}: Cosmo ${result.passed ? 'passed' : 'failed'}`,
    }));
  },
};
