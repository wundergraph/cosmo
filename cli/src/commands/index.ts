import { Command } from 'commander';
import pc from 'picocolors';
import { CreateClient } from '../core/client/client.js';
import { config } from '../core/config.js';
import AuthCommands from './auth/index.js';
import FederatedGraphCommands from './federated-graph/index.js';
import RouterCommands from './router/index.js';
import SchemaCommands from './subgraph/index.js';

if (!config.apiKey) {
  console.log(
    pc.yellow(
      `No API key found. Please create an API key and set as environment variable ${pc.bold('COSMO_API_KEY')}.` +
        '\n' +
        'Without an API key, you will not be able to interact with the control plane.',
    ) + '\n',
  );
}

const client = CreateClient({
  baseUrl: config.baseURL,
  apiKey: config.apiKey,
});

const program = new Command();
program.name('wgc').version(config.version)
  .description(`This is the command-line interface to manage the WunderGraph Cosmo Platform.
WunderGraph Cosmo is the Full Lifecycle GraphQL API Management Solution to manage Federated Graphs at scale.
Composition checks, routing, analytics, and distributed tracing all in one platform.
`);

program.addCommand(
  FederatedGraphCommands({
    client,
  }),
);
program.addCommand(
  SchemaCommands({
    client,
  }),
);
program.addCommand(
  AuthCommands({
    client,
  }),
);
program.addCommand(
  RouterCommands({
    client,
  }),
);

export default program;
