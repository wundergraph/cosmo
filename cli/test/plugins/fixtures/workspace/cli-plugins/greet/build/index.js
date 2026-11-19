export default {
  name: 'greet',
  description: 'Greets people',
  register(command, context) {
    command
      .command('hello')
      .argument('<who>')
      .option('--json')
      .action((who, options) => {
        context.output({ json: options.json }).result({ greeting: `Hello ${who} from build` }, (data) => data.greeting);
      });
  },
};
