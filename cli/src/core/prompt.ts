import { program } from 'commander';
import pc from 'picocolors';

/** Exits with the message instead of prompting when stdin is not a terminal, as in CI or an agent shell. */
export const refuseWithoutTerminal = (message: string): void => {
  if (process.stdin.isTTY) {
    return;
  }

  program.error(pc.red(message));
};
