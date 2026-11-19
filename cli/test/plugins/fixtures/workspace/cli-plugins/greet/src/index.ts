import { definePlugin } from '@wundergraph/wgc-plugin-sdk';

export default definePlugin({
  name: 'greet',
  description: 'Greets people',
  register(command, context) {
    command
      .command('hello')
      .argument('<who>')
      .option('--json')
      .action((who: string, options: { json?: boolean }) => {
        context
          .output({ json: options.json })
          .result({ greeting: `Hello ${who} from source` }, (data) => data.greeting);
      });
  },
});
