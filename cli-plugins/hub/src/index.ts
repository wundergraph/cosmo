import { definePlugin } from '@wundergraph/wgc-plugin-sdk';
import { collectionsCommand } from './commands/collections.js';
import { initCommand } from './commands/init.js';
import { sandboxCommand } from './commands/sandbox.js';
import { schemaCommand } from './commands/schema-push.js';

export default definePlugin({
  name: 'hub',
  description: 'Push schemas to WunderGraph Hub sandboxes, manage sandboxes and run collections',
  register(command, context) {
    command
      .addCommand(initCommand(context))
      .addCommand(schemaCommand(context))
      .addCommand(sandboxCommand(context))
      .addCommand(collectionsCommand(context));
  },
});
