import { program } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { waitForKeyPress, rainbow } from '../../utils.js';
import { clearScreen, printLogo } from './util.js';

function printHello() {
  printLogo();
  console.log(
    `\nThank you for choosing ${rainbow('WunderGraph')} - The open-source solution to building, maintaining, and collaborating on GraphQL Federation at Scale.\n`,
  );
  console.log('This command will guide you through the inital setup to create your first federated graph.');
}

export default function (_: BaseCommandOptions) {
  return async function handleCommand() {
    clearScreen();
    printHello();
    await waitForKeyPress(
      {
        Enter: () => program.error('TODO: implement'),
      },
      'Press [ENTER] to continue…',
    );
  };
}
