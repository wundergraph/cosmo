import { mkdirSync } from 'node:fs';
import { Command } from 'commander';
import { CreateClient } from '../core/client/client.js';
import { config, configDir } from '../core/config.js';
import { checkForUpdates } from '../utils.js';
import AuthCommands from './auth/index.js';
import MonographCommands from './graph/monograph/index.js';
import FederatedGraphCommands from './graph/federated-graph/index.js';
import NamespaceCommands from './namespace/index.js';
import OperationCommands from './operations/index.js';
import RouterCommands from './router/index.js';
import SchemaCommands from './subgraph/index.js';
import ContractCommands from './contract/index.js';
import FeatureGraphCommands from './feature-subgraph/index.js';
import FeatureFlagCommands from './feature-flag/index.js';

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

if (proxyUrl) {
  // Lazy load undici only when needed
  const { setGlobalDispatcher, ProxyAgent } = await import('undici');

  // Set the global dispatcher for undici to route through the proxy
  const dispatcher = new ProxyAgent({
    uri: new URL(proxyUrl).toString(),
  });
  setGlobalDispatcher(dispatcher);
}

const client = CreateClient({
  baseUrl: config.baseURL,
  apiKey: config.apiKey,
  proxyUrl,
});

const program = new Command();
program.name('wgc').version(config.version)
  .description(`This is the command-line interface to manage the WunderGraph Cosmo Platform.
WunderGraph Cosmo is the Full Lifecycle GraphQL API Management Solution to manage Federated Graphs at scale.
Composition checks, routing, analytics, and distributed tracing all in one platform.
`);

program.addCommand(
  MonographCommands({
    client,
  }),
);
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
program.addCommand(
  ContractCommands({
    client,
  }),
);

program.addCommand(
  FeatureGraphCommands({
    client,
  }),
);

program.addCommand(
  FeatureFlagCommands({
    client,
  }),
);

program.hook('preAction', async () => {
  mkdirSync(configDir, { recursive: true });
  await checkForUpdates();
});

export default program;
