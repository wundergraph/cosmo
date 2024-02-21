#!/usr/bin/env node

import * as dotenv from 'dotenv';
import pc from 'picocolors';
import boxen from 'boxen';
import program from './commands/index.js';

dotenv.config();

try {
  await program.parseAsync(process.argv);
} catch (e) {
  console.error(e);
  const message = `\
Please try the below steps to solve the issue

[1] Upgrade to the latest version:
    ${pc.cyan('npm i -g wgc@latest')}
[2] If it persists, please open an issue:
    ${pc.cyan('https://github.com/wundergraph/cosmo/issues/new/choose')}`;

  console.log(
    boxen(message, {
      padding: 1,
      margin: 0,
      borderColor: 'red',
      borderStyle: 'round',
    }),
  );
  process.exit(1);
}
