import { constants } from 'node:os';
import { execa } from 'execa';
import { binaryVariable } from './engine.js';
import type { ForgeEngine } from './engine.js';

/** Everything after `forge` on the command line, untouched, so the Forge CLI parses it itself. */
const forwardedArgs = (argv: string[], commandName: string): string[] => {
  const commandIndex = argv.indexOf(commandName, 2);
  return argv.slice(commandIndex + 1);
};

const signalExitCode = (signal: NodeJS.Signals): number => 128 + constants.signals[signal];

/** Hands `wgc forge …` to a Forge binary with the same arguments, stdio and exit code. */
export const createBinaryEngine = ({ binary, argv }: { binary: string; argv: () => string[] }): ForgeEngine => ({
  register(command, context) {
    command
      .helpOption(false)
      .allowUnknownOption()
      .allowExcessArguments()
      .argument('[args...]')
      .action(async () => {
        const args = forwardedArgs(argv(), command.name());
        const outcome = await execa(binary, args, { stdio: 'inherit', reject: false });

        if (outcome.exitCode !== undefined) {
          process.exitCode = outcome.exitCode;
          return;
        }

        if (outcome.signal !== undefined) {
          process.exitCode = signalExitCode(outcome.signal);
          return;
        }

        context.output({ json: args.includes('--json') }).fail({
          message: `Could not run the Forge CLI at ${binary}: ${outcome.shortMessage}`,
          input: binary,
          remediation: `Point ${binaryVariable} at a working forge binary, or set ${binaryVariable}=builtin to use the commands built into wgc.`,
        });
      });
  },
});
