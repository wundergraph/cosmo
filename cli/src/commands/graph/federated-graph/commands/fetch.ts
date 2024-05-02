import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { Command } from 'commander';
import { join } from 'pathe';
import yaml from 'js-yaml';
import pc from 'picocolors';
import { BaseCommandOptions } from '../../../../core/types/types.js';
import {
  Subgraph,
  fetchRouterConfig,
  getFederatedGraphSDL,
  getSubgraphSDL,
  getSubgraphsOfFedGraph,
  injectRequiredDirectives,
} from '../utils.js';

export default (opts: BaseCommandOptions) => {
  const cmd = new Command('fetch');
  cmd.description('Fetches the schemas of the federated graph, all of its subgraphs and the router config.');
  cmd.argument('<name>', 'The name of the federated graph to fetch.');
  cmd.option('-n, --namespace [string]', 'The namespace of the federated graph or monograph.');
  cmd.option('-o, --out [string]', 'Destination folder for storing all the required files.');
  cmd.option(
    '-a, --apollo-compatibility',
    'Enable apollo compatibility to generate the composition configs and script to generate schema using rover',
  );

  cmd.action(async (name, options) => {
    try {
      const fedGraphSDL = await getFederatedGraphSDL({ client: opts.client, name, namespace: options.namespace });

      const basePath = join(
        process.cwd(),
        options.out || '',
        `/${name}${options.namespace ? `-${options.namespace}` : ''}/`,
      );
      const superGraphPath = join(basePath, '/supergraph/');
      const subgraphPath = join(basePath, '/subgraphs/');
      const scriptsPath = join(basePath, '/scripts/');

      if (!existsSync(superGraphPath)) {
        mkdirSync(superGraphPath, { recursive: true });
      }
      if (!existsSync(subgraphPath)) {
        mkdirSync(subgraphPath, { recursive: true });
      }
      if (!existsSync(scriptsPath) && options.apolloCompatibility) {
        mkdirSync(scriptsPath, { recursive: true });
      }

      const routerConfig = await fetchRouterConfig({
        client: opts.client,
        name,
        namespace: options.namespace,
      });
      writeFileSync(join(superGraphPath, `cosmoConfig.json`), routerConfig);

      writeFileSync(join(superGraphPath, `cosmoSchema.graphql`), fedGraphSDL);

      const subgraphs = await getSubgraphsOfFedGraph({ client: opts.client, name, namespace: options.namespace });

      const cosmoSubgraphsConfig: {
        name: string;
        routing_url: string;
        schema: {
          file: string;
        };
        subscription?: {
          url: string;
          protocol: string;
        };
      }[] = [];
      const roverSubgraphsConfig: {
        [name: string]: {
          routing_url: string;
          schema: {
            file: string;
          };
        };
      } = {};
      const roverSubgraphsSubcriptionConfig: {
        [name: string]: {
          path: string;
          protocol: string;
        };
      } = {};
      for (const subgraph of subgraphs) {
        const subgraphSDL = await getSubgraphSDL({
          client: opts.client,
          fedGraphName: name,
          namespace: options.namespace,
          subgraphName: subgraph.name,
        });
        if (!subgraphSDL) {
          continue;
        }
        const filePath = join(subgraphPath, `${subgraph.name}.graphql`);
        let finalSDL = subgraphSDL;
        if (options.apolloCompatibility) {
          cosmoSubgraphsConfig.push({
            name: subgraph.name,
            routing_url: subgraph.routingURL,
            schema: {
              file: filePath,
            },
            subscription:
              subgraph.subscriptionURL === ''
                ? undefined
                : { url: subgraph.subscriptionURL, protocol: subgraph.subscriptionProtocol },
          });
          roverSubgraphsConfig[subgraph.name] = {
            routing_url: subgraph.routingURL,
            schema: {
              file: filePath,
            },
          };
          if (subgraph.subscriptionURL !== '') {
            roverSubgraphsSubcriptionConfig[subgraph.name] = {
              path: subgraph.subscriptionURL,
              protocol: 'graphql_ws',
            };
          }
          finalSDL = injectRequiredDirectives(subgraphSDL, subgraph.isV2Graph);
        }
        writeFileSync(filePath, finalSDL);
      }

      if (options.apolloCompatibility) {
        const cosmoCompositionConfig = yaml.dump({
          version: 1,
          subgraphs: cosmoSubgraphsConfig,
        });
        const roverCompositionConfig = yaml.dump({
          federation_version: '=2.6.1',
          subgraphs: roverSubgraphsConfig,
          subscription:
            Object.keys(roverSubgraphsSubcriptionConfig).length === 0
              ? undefined
              : {
                  enabled: true,
                  mode: {
                    passthrough: {
                      subgraphs: roverSubgraphsSubcriptionConfig,
                    },
                  },
                },
        });
        writeFileSync(join(basePath, `cosmo-composition.yaml`), cosmoCompositionConfig);
        writeFileSync(join(basePath, `rover-composition.yaml`), roverCompositionConfig);

        const apolloScript = `npm install -g @apollo/rover
rover supergraph compose --config '${join(basePath, `rover-composition.yaml`)}' --output '${join(
          superGraphPath,
          'apolloSchema.graphql',
        )}'
`;
        writeFileSync(join(scriptsPath, `apollo.sh`), apolloScript);
      }

      console.log(
        pc.green(
          `Successfully fetched the schemas of the federated graph, all its subgraphs and the router config of the federated graph ${pc.bold(
            name,
          )}.`,
        ),
      );
    } catch (e: any) {
      if (e.message) {
        console.error(pc.red(e.message));
      }
      process.exit(1);
    }
  });

  return cmd;
};
