import { Command } from 'commander';
import { CreateClient } from '../core/client/client.js';
import { config } from '../core/config.js';
import AuthCommands from './auth/index.js';
import FederatedGraphCommands from './federated-graph/index.js';
import OperationCommands from './operations/index.js';
import RouterCommands from './router/index.js';
import SchemaCommands from './subgraph/index.js';

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
  OperationCommands({
    client,
  }),
);
program.addCommand(
  RouterCommands({
    client,
  }),
);

export default program;
