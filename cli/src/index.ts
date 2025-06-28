#!/usr/bin/env node

import * as dotenv from 'dotenv';
import pc from 'picocolors';
import boxen from 'boxen';
import program from './commands/index.js';
import { initTelemetry, shutdownTelemetry, captureCommandFailure } from './core/telemetry.js';

dotenv.config({
  quiet: true,
});

initTelemetry();

try {
  await program.parseAsync(process.argv);
  await shutdownTelemetry();
} catch (e) {
  try {
    const commandPath = process.argv.slice(2).join(' ');
    await captureCommandFailure(commandPath, e as Error | string);
  } catch (telemetryError) {
    if (process.env.DEBUG) {
      console.error('Failed to capture command failure telemetry:', telemetryError);
    }
  }

  console.log('');

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

  process.exitCode = 1;

  await shutdownTelemetry();
}
