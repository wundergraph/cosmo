import { mkdirSync } from 'node:fs';
import { Command } from 'commander';
import { CreateClient } from '../core/client/client.js';
import { config, configDir } from '../core/config.js';
import { checkForUpdates } from '../utils.js';
import AuthCommands from './auth/index.js';
import FederatedGraphCommands from './federated-graph/index.js';
import NamespaceCommands from './namespace/index.js';
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
program.addCommand(
  NamespaceCommands({
    client,
  }),
);

program.hook('preAction', async () => {
  mkdirSync(configDir, { recursive: true });
  await checkForUpdates();
});

export default program;
