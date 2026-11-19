export default {
  name: 'echo',
  description: 'Echoes words back',
  register(command, context) {
    command
      .command('say')
      .argument('<word>')
      .option('--json')
      .action((word, options) => {
        context.output({ json: options.json }).result({ echoed: word }, (data) => `echo: ${data.echoed}`);
      });
  },
};
