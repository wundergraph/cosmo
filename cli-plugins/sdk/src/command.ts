import type { Command } from 'commander';
import type { PluginContext } from './plugin.js';

/** Leads with real examples after the flags, and ends with the docs page when there is one. */
export const withExamples = (command: Command, examples: string[], docsUrl?: string): Command => {
  const lines = ['', 'Examples', ...examples.map((example) => `  ${example}`)];
  if (docsUrl) {
    lines.push('', `Docs: ${docsUrl}`);
  }
  return command.addHelpText('after', lines.join('\n'));
};

/**
 * A command that only groups subcommands, e.g. `wgc hub sandbox`. Run bare, it prints its help and
 * exits 0; run with an unknown subcommand, it fails as a usage error instead of guessing.
 */
export const asGroup = (command: Command, context: PluginContext, parentPath: string): Command =>
  command
    .option('--json', 'Machine-readable output')
    .allowExcessArguments()
    .action((options: { json?: boolean }, self: Command) => {
      const output = context.output({ json: options.json });
      const [unknown] = self.args;
      if (unknown !== undefined) {
        output.fail({
          kind: 'usage',
          message: `Unknown command: ${parentPath} ${self.name()} ${unknown}.`,
          remediation: `Run \`${parentPath} ${self.name()} --help\` to list its commands.`,
        });
        return;
      }
      output.result({ help: self.helpInformation() }, (data) => data.help.trimEnd());
    });
