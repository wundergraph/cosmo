import { definePlugin } from '@wundergraph/wgc-plugin-sdk';
import type { WgcPlugin } from '@wundergraph/wgc-plugin-sdk';
import { collectionCommand } from './commands/collection.js';
import { initCommand } from './commands/init.js';
import { linkCommands } from './commands/link.js';
import { openCommand } from './commands/open.js';
import { operationCommand } from './commands/operation.js';
import { proposeCommand } from './commands/propose.js';
import { sandboxCommand } from './commands/sandbox.js';
import { schemaCommand } from './commands/schema-push.js';
import { statusCommand } from './commands/status.js';
import { processRuntime } from './common/runtime.js';
import type { HubRuntime } from './common/runtime.js';

export const createHubPlugin = (runtime: HubRuntime = processRuntime()): WgcPlugin =>
  definePlugin({
    name: 'hub',
    description: 'Launch, link and follow Hub sandboxes, run collections and propose schema changes',
    register(command, context) {
      const dependencies = { context, runtime };
      for (const linkCommand of linkCommands(dependencies)) {
        command.addCommand(linkCommand);
      }
      command
        .addCommand(statusCommand(dependencies))
        .addCommand(openCommand(dependencies))
        .addCommand(initCommand(context))
        .addCommand(sandboxCommand(dependencies))
        .addCommand(collectionCommand(dependencies))
        .addCommand(proposeCommand(dependencies))
        .addCommand(operationCommand(dependencies))
        .addCommand(schemaCommand(dependencies));
    },
  });

export default createHubPlugin();
