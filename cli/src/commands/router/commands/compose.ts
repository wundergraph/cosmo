import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  buildRouterConfig,
  type ComposedSubgraph,
  type ComposedSubgraphGRPC,
  type ComposedSubgraphPlugin,
  normalizeURL,
  type RouterSubgraph,
  SubgraphKind,
  type SubscriptionProtocol,
  type WebsocketSubprotocol,
} from '@wundergraph/cosmo-shared';
import semver from 'semver';
import { Command, program } from 'commander';
import { parse, printSchema } from 'graphql';
import * as yaml from 'js-yaml';
import { basename, dirname, resolve } from 'pathe';
import pc from 'picocolors';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import {
  FeatureFlagRouterExecutionConfig,
  FeatureFlagRouterExecutionConfigs,
  GRPCMapping,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import Table from 'cli-table3';
import { FederationResultSuccess, ROUTER_COMPATIBILITY_VERSION_ONE } from '@wundergraph/composition';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { composeSubgraphs, introspectSubgraph } from '../../../utils.js';

type ConfigSubgraph = StandardSubgraphConfig | SubgraphPluginConfig | GRPCSubgraphConfig;

type StandardSubgraphConfig = {
  name: string;
  routing_url: string;
  schema?: {
    file: string;
  };
  subscription?: {
    url?: string;
    protocol?: 'ws' | 'sse' | 'sse_post';
    websocketSubprotocol?: 'auto' | 'graphql-ws' | 'graphql-transport-ws';
  };
  introspection?: {
    url: string;
    headers?: {
      [key: string]: string;
    };
    raw?: boolean;
  };
};

type SubgraphPluginConfig = {
  plugin: {
    version: string;
    path: string;
  };
};

type GRPCSubgraphConfig = {
  name: string;
  routing_url: string;
  grpc: {
    schema_file: string;
    proto_file: string;
    mapping_file: string;
  };
};

type SubgraphMetadata = StandardSubgraphMetaData | SubgraphPluginMetadata | GRPCSubgraphMetadata;

type StandardSubgraphMetaData = {
  kind: SubgraphKind.Standard;
  name: string;
  sdl: string;
  routingUrl: string;
  subscriptionUrl: string;
  subscriptionProtocol: SubscriptionProtocol;
  websocketSubprotocol: WebsocketSubprotocol;
};

type SubgraphPluginMetadata = {
  kind: SubgraphKind.Plugin;
  name: string;
  sdl: string;
  mapping: GRPCMapping;
  protoSchema: string;
  version: string;
};

type GRPCSubgraphMetadata = {
  kind: SubgraphKind.GRPC;
  name: string;
  sdl: string;
  routingUrl: string;
  protoSchema: string;
  mapping: GRPCMapping;
};

type Config = {
  version: number;
  feature_flags: {
    name: string;
    feature_graphs: (StandardSubgraphConfig & { subgraph_name: string })[];
  }[];
  subgraphs: ConfigSubgraph[];
};

function constructRouterSubgraph(result: FederationResultSuccess, s: SubgraphMetadata, index: number): RouterSubgraph {
  const subgraphConfig = result.subgraphConfigBySubgraphName.get(s.name);
  const schema = subgraphConfig?.schema;
  const configurationDataByTypeName = subgraphConfig?.configurationDataByTypeName;

  if (s.kind === SubgraphKind.Standard) {
    const composedSubgraph: ComposedSubgraph = {
      kind: SubgraphKind.Standard,
      id: `${index}`,
      name: s.name,
      url: s.routingUrl,
      sdl: s.sdl,
      subscriptionUrl: s.subscriptionUrl,
      subscriptionProtocol: s.subscriptionProtocol,
      websocketSubprotocol: s.websocketSubprotocol,
      schema,
      configurationDataByTypeName,
    };
    return composedSubgraph;
  }

  if (s.kind === SubgraphKind.Plugin) {
    const composedSubgraphPlugin: ComposedSubgraphPlugin = {
      kind: SubgraphKind.Plugin,
      id: `${index}`,
      name: s.name,
      url: `http://localhost:3000/plugin/${index}`,
      sdl: s.sdl,
      mapping: s.mapping,
      protoSchema: s.protoSchema,
      version: s.version,
      schema,
      configurationDataByTypeName,
    };
    return composedSubgraphPlugin;
  }

  const composedSubgraphGRPC: ComposedSubgraphGRPC = {
    kind: SubgraphKind.GRPC,
    id: `${index}`,
    name: s.name,
    sdl: s.sdl,
    url: s.routingUrl,
    protoSchema: s.protoSchema,
    mapping: s.mapping,
    schema,
    configurationDataByTypeName,
  };
  return composedSubgraphGRPC;
}

export default (opts: BaseCommandOptions) => {
  const command = new Command('compose');
  command.description(
    'Generates a router config from a local composition file. This makes it easy to test your router without a control-plane connection. For production, please use the "router fetch" command',
  );
  command.requiredOption('-i, --input <path-to-input>', 'The yaml file with data about graph and subgraphs.');
  command.option('-o, --out [string]', 'Destination file for the router config.');
  command.option('--suppress-warnings', 'This flag suppresses any warnings produced by composition.');
  command.action(async (options) => {
    const inputFile = resolve(options.input);
    const inputFileLocation = dirname(inputFile);

    if (!existsSync(inputFile)) {
      program.error(
        pc.red(pc.bold(`The input file '${pc.bold(inputFile)}' does not exist. Please check the path and try again.`)),
      );
    }

    const fileContent = (await readFile(inputFile)).toString();
    const config = yaml.load(fileContent) as Config;

    const subgraphs: SubgraphMetadata[] = [];

    for (const [index, subgraphConfig] of config.subgraphs.entries()) {
      const metadata = await toSubgraphMetadata(inputFileLocation, index, subgraphConfig, subgraphs);
      subgraphs.push(metadata);
    }

    const result = composeSubgraphs(
      subgraphs.map((s, index) => {
        if (s.kind === SubgraphKind.Plugin) {
          return {
            name: s.name,
            url: `http://localhost:3000/plugin/${index}`,
            definitions: parse(s.sdl ?? ''),
          };
        }
        return {
          name: s.name,
          url: s.routingUrl,
          definitions: parse(s.sdl),
        };
      }),
    );

    if (!result.success) {
      const compositionErrorsTable = new Table({
        head: [pc.bold(pc.white('ERROR_MESSAGE'))],
        colWidths: [120],
        wordWrap: true,
      });

      console.log(
        pc.red(`We found composition errors, while composing.\n${pc.bold('Please check the errors below:')}`),
      );
      for (const compositionError of result.errors) {
        compositionErrorsTable.push([compositionError.message]);
      }
      console.log(compositionErrorsTable.toString());
      process.exitCode = 1;
      return;
    }

    if (!options.suppressWarnings && result.warnings.length > 0) {
      const compositionWarningsTable = new Table({
        head: [pc.bold(pc.white('WARNING_MESSAGE'))],
        colWidths: [120],
        wordWrap: true,
      });

      console.log(pc.yellow(`The following warnings were produced while composing:`));
      for (const warning of result.warnings) {
        compositionWarningsTable.push([warning.message]);
      }
      console.log(compositionWarningsTable.toString());
    }

    const federatedClientSDL = result.shouldIncludeClientSchema ? printSchema(result.federatedGraphClientSchema) : '';
    const routerConfig = buildRouterConfig({
      federatedClientSDL,
      federatedSDL: printSchemaWithDirectives(result.federatedGraphSchema),
      fieldConfigurations: result.fieldConfigurations,
      // @TODO get router compatibility version programmatically
      routerCompatibilityVersion: ROUTER_COMPATIBILITY_VERSION_ONE,
      schemaVersionId: 'static',
      subgraphs: subgraphs.map((s, index) => constructRouterSubgraph(result, s, index)),
    });

    routerConfig.version = randomUUID();

    if (config.feature_flags && config.feature_flags.length > 0) {
      const ffConfigs = await buildFeatureFlagsConfig(config, inputFileLocation, subgraphs, options);
      routerConfig.featureFlagConfigs = ffConfigs;
    }

    if (options.out) {
      await writeFile(options.out, routerConfig.toJsonString());
      console.log(pc.green(`Router config successfully written to ${pc.bold(options.out)}`));
    } else {
      console.log(routerConfig.toJsonString());
    }
  });

  return command;
};

function toSubgraphMetadata(
  inputFileLocation: string,
  index: number,
  subgraphConfig: ConfigSubgraph,
  subgraphs: SubgraphMetadata[],
): Promise<SubgraphMetadata> {
  if ('plugin' in subgraphConfig) {
    return toSubgraphMetadataPlugin(subgraphConfig, subgraphs);
  }

  if ('grpc' in subgraphConfig) {
    return toSubgraphMetadataGRPC(subgraphConfig);
  }

  return toSubgraphMetadataStandard(inputFileLocation, index, subgraphConfig, subgraphs);
}

async function toSubgraphMetadataGRPC(s: GRPCSubgraphConfig): Promise<GRPCSubgraphMetadata> {
  validateGRPCSubgraph(s);

  const mappingFileContent = await readFile(s.grpc.mapping_file, 'utf8');
  const mapping = GRPCMapping.fromJsonString(mappingFileContent);

  const protoSchemaFileContent = await readFile(s.grpc.proto_file, 'utf8');
  const sdl = await readFile(s.grpc.schema_file, 'utf8');

  return {
    kind: SubgraphKind.GRPC,
    name: s.name,
    sdl,
    routingUrl: s.routing_url,
    protoSchema: protoSchemaFileContent,
    mapping,
  };
}

async function toSubgraphMetadataPlugin(
  s: SubgraphPluginConfig,
  subgraphs: SubgraphMetadata[],
): Promise<SubgraphPluginMetadata> {
  const pluginName = basename(s.plugin.path);
  if (subgraphs.some((sg) => sg.kind === SubgraphKind.Plugin && sg.name === pluginName)) {
    program.error(
      pc.red(
        pc.bold(`A plugin with the name '${pc.bold(pluginName)}' is already registered. Plugin names must be unique.`),
      ),
    );
  }

  validateSubgraphPlugin(s);

  // Check if a plugin with the same name already exists
  const mappingFilePath = resolve(s.plugin.path, 'generated', 'mapping.json');
  const mappingFile = await readFile(mappingFilePath, 'utf8');
  const schemaFilePath = resolve(s.plugin.path, 'src', 'schema.graphql');
  const sdl = await readFile(schemaFilePath, 'utf8');
  const protoSchemaFilePath = resolve(s.plugin.path, 'generated', 'service.proto');
  const protoSchema = await readFile(protoSchemaFilePath, 'utf8');

  return {
    kind: SubgraphKind.Plugin,
    name: pluginName,
    protoSchema,
    version: s.plugin.version,
    sdl,
    mapping: GRPCMapping.fromJsonString(mappingFile),
  };
}

async function toSubgraphMetadataStandard(
  inputFileLocation: string,
  index: number,
  s: StandardSubgraphConfig,
  subgraphs: SubgraphMetadata[],
): Promise<StandardSubgraphMetaData> {
  // The subgraph name is required
  if (!s.name) {
    program.error(
      pc.red(
        pc.bold(`The subgraph name is required for subgraph at index ${index}. Please provide a name and try again.`),
      ),
    );
  }

  const url = s.introspection?.url ?? s.routing_url;

  // Check if a subgraph with the same name already exists
  if (subgraphs.some((sg) => sg.name === s.name)) {
    program.error(
      pc.red(
        pc.bold(`A subgraph with the name '${pc.bold(s.name)}' is already registered. Subgraph names must be unique.`),
      ),
    );
  }

  let schemaSDL = '';

  // The GraphQL schema is provided in the input file
  if (s.schema?.file) {
    const schemaFile = resolve(inputFileLocation, s.schema.file);
    const sdl = (await readFile(schemaFile)).toString();
    schemaSDL = sdl;
  } else {
    // The GraphQL schema is not provided in the input file, so we need to introspect it
    try {
      const result = await introspectSubgraph({
        subgraphURL: url,
        additionalHeaders: Object.entries(s.introspection?.headers ?? {}).map(([key, value]) => ({
          key,
          value,
        })),
        rawIntrospection: s.introspection?.raw,
      });

      if (!result.success) {
        program.error(`Could not introspect subgraph ${s.name}, URL: ${url}: ${result.errorMessage ?? 'failed'}`);
      }

      schemaSDL = result.sdl;
    } catch (e: any) {
      program.error(`Could not introspect subgraph ${s.name}, URL: ${url}: ${e.message}`);
    }
  }

  return {
    kind: SubgraphKind.Standard,
    name: s.name,
    sdl: schemaSDL,
    subscriptionUrl: s.subscription?.url || s.routing_url,
    subscriptionProtocol: s.subscription?.protocol || 'ws',
    websocketSubprotocol: s.subscription?.protocol === 'ws' ? (s.subscription?.websocketSubprotocol ?? 'auto') : 'auto',
    routingUrl: normalizeURL(s.routing_url),
  };
}

function validateGRPCSubgraph(s: GRPCSubgraphConfig) {
  if (!s.name) {
    program.error(
      pc.red(pc.bold(`The subgraph name is missing in the input file. Please check the name and try again.`)),
    );
  }

  if (!s.routing_url) {
    program.error(
      pc.red(pc.bold(`The routing URL is missing in the input file. Please check the routing URL and try again.`)),
    );
  }

  if (!s.grpc.schema_file) {
    program.error(
      pc.red(pc.bold(`The schema file is missing in the input file. Please check the schema file and try again.`)),
    );
  }

  if (!s.grpc.proto_file) {
    program.error(
      pc.red(pc.bold(`The proto file is missing in the input file. Please check the proto file and try again.`)),
    );
  }

  if (!s.grpc.mapping_file) {
    program.error(
      pc.red(pc.bold(`The mapping file is missing in the input file. Please check the mapping file and try again.`)),
    );
  }

  if (!existsSync(s.grpc.schema_file)) {
    program.error(
      pc.red(
        pc.bold(
          `The schema file '${pc.bold(s.grpc.schema_file)}' does not exist. Please check the path and try again.`,
        ),
      ),
    );
  }

  if (!existsSync(s.grpc.proto_file)) {
    program.error(
      pc.red(
        pc.bold(`The proto file '${pc.bold(s.grpc.proto_file)}' does not exist. Please check the path and try again.`),
      ),
    );
  }

  if (!existsSync(s.grpc.mapping_file)) {
    program.error(
      pc.red(
        pc.bold(
          `The mapping file '${pc.bold(s.grpc.mapping_file)}' does not exist. Please check the path and try again.`,
        ),
      ),
    );
  }
}

function validateSubgraphPlugin(s: SubgraphPluginConfig) {
  if (!s.plugin.path) {
    program.error(
      pc.red(pc.bold(`The plugin path is missing in the input file. Please check the path and try again.`)),
    );
  }
  if (!existsSync(s.plugin.path)) {
    program.error(
      pc.red(
        pc.bold(`The plugin path '${pc.bold(s.plugin.path)}' does not exist. Please check the path and try again.`),
      ),
    );
  }

  if (!s.plugin.version) {
    program.error(
      pc.red(pc.bold(`The plugin version is missing in the input file. Please check the version and try again.`)),
    );
  }

  // Check if valid semver
  if (!semver.valid(s.plugin.version)) {
    program.error(
      pc.red(
        pc.bold(
          `The plugin version '${pc.bold(s.plugin.version)}' is not a valid semver. Please check the version and try again.`,
        ),
      ),
    );
  }
}

async function buildFeatureFlagsConfig(
  config: Config,
  inputFileLocation: string,
  subgraphs: SubgraphMetadata[],
  options: any,
): Promise<FeatureFlagRouterExecutionConfigs> {
  const ffConfigs: FeatureFlagRouterExecutionConfigs = new FeatureFlagRouterExecutionConfigs();

  // @TODO This logic should exist only once in the shared package and reused across
  // control-plane and cli

  for (const ff of config.feature_flags) {
    const featureSubgraphs: StandardSubgraphMetaData[] = [];
    const standardSubgraphs = config.subgraphs.filter(
      (ss) => !('plugin' in ss) && !('grpc' in ss),
    ) as StandardSubgraphConfig[];

    // Process each subgraph for this feature flag
    for (const s of standardSubgraphs) {
      // Check if this subgraph is overridden by a feature graph
      const featureSubgraph = ff.feature_graphs.find((ffs) => ffs.subgraph_name === s.name);

      if (featureSubgraph) {
        // This subgraph is overridden by a feature graph
        const url = featureSubgraph.introspection?.url ?? featureSubgraph.routing_url;
        let schemaSDL = '';

        if (featureSubgraph.schema?.file) {
          const schemaFile = resolve(inputFileLocation, featureSubgraph.schema.file);
          schemaSDL = await readFile(schemaFile, 'utf8');
        } else {
          try {
            const result = await introspectSubgraph({
              subgraphURL: url,
              additionalHeaders: Object.entries(featureSubgraph.introspection?.headers ?? {}).map(([key, value]) => ({
                key,
                value,
              })),
              rawIntrospection: featureSubgraph.introspection?.raw,
            });

            if (!result.success) {
              program.error(
                `Could not introspect feature-graph subgraph ${featureSubgraph.name}, URL: ${url}: ${
                  result.errorMessage ?? 'failed'
                }`,
              );
            }

            schemaSDL = result.sdl;
          } catch (e: any) {
            program.error(
              `Could not introspect feature-graph subgraph ${featureSubgraph.name}, URL: ${url}: ${e.message}`,
            );
          }
        }

        featureSubgraphs.push({
          kind: SubgraphKind.Standard,
          name: featureSubgraph.name,
          sdl: schemaSDL,
          routingUrl: featureSubgraph.routing_url,
          subscriptionUrl: featureSubgraph.subscription?.url || featureSubgraph.routing_url,
          subscriptionProtocol: featureSubgraph.subscription?.protocol || 'ws',
          websocketSubprotocol:
            featureSubgraph.subscription?.protocol === 'ws'
              ? featureSubgraph.subscription?.websocketSubprotocol || 'auto'
              : 'auto',
        });
      } else {
        // Use the base subgraph as is
        // Find the corresponding metadata in the original subgraphs array
        const originalSubgraph = subgraphs.find(
          (sub) => sub.kind === SubgraphKind.Standard && sub.name === s.name,
        ) as StandardSubgraphMetaData;

        if (originalSubgraph) {
          featureSubgraphs.push(originalSubgraph);
        }
      }
    }

    const featureResult = composeSubgraphs(
      featureSubgraphs.map((s) => ({
        name: s.name,
        url: normalizeURL(s.routingUrl),
        definitions: parse(s.sdl),
      })),
    );

    if (!featureResult.success) {
      const compositionErrorsTable = new Table({
        head: [pc.bold(pc.white('ERROR_MESSAGE'))],
        colWidths: [120],
        wordWrap: true,
      });

      console.log(
        pc.red(
          `We found composition errors, while composing the feature flag ${pc.italic(ff.name)}.\n${pc.bold(
            'Please check the errors below:',
          )}`,
        ),
      );
      for (const compositionError of featureResult.errors) {
        compositionErrorsTable.push([compositionError.message]);
      }
      console.log(compositionErrorsTable.toString());
      continue;
    }

    if (!options.suppressWarnings && featureResult.warnings.length > 0) {
      const compositionWarningsTable = new Table({
        head: [pc.bold(pc.white('WARNING_MESSAGE'))],
        colWidths: [120],
        wordWrap: true,
      });

      console.log(
        pc.yellow(`The following warnings were produced while composing the feature flag ${pc.italic(ff.name)}:`),
      );
      for (const warning of featureResult.warnings) {
        compositionWarningsTable.push([warning.message]);
      }
      console.log(compositionWarningsTable.toString());
    }

    const featureFederatedClientSDL = featureResult.shouldIncludeClientSchema
      ? printSchema(featureResult.federatedGraphClientSchema)
      : '';
    const featureRouterConfig = buildRouterConfig({
      federatedClientSDL: featureFederatedClientSDL,
      federatedSDL: printSchemaWithDirectives(featureResult.federatedGraphSchema),
      fieldConfigurations: featureResult.fieldConfigurations,
      // @TODO get router compatibility version programmatically
      routerCompatibilityVersion: ROUTER_COMPATIBILITY_VERSION_ONE,
      schemaVersionId: `static`,
      subgraphs: featureSubgraphs.map((s, index): RouterSubgraph => {
        const subgraphConfig = featureResult.subgraphConfigBySubgraphName.get(s.name);
        const schema = subgraphConfig?.schema;
        const configurationDataByTypeName = subgraphConfig?.configurationDataByTypeName;

        const composedSubgraph: ComposedSubgraph = {
          kind: SubgraphKind.Standard,
          id: `${index}`,
          name: s.name,
          url: s.routingUrl,
          sdl: s.sdl,
          subscriptionUrl: s.subscriptionUrl,
          subscriptionProtocol: s.subscriptionProtocol,
          websocketSubprotocol: s.websocketSubprotocol,
          schema,
          configurationDataByTypeName,
        };
        return composedSubgraph;
      }),
    });

    ffConfigs.configByFeatureFlagName[ff.name] = new FeatureFlagRouterExecutionConfig({
      version: featureRouterConfig.version,
      subgraphs: featureRouterConfig.subgraphs,
      engineConfig: featureRouterConfig.engineConfig,
    });

    ffConfigs.configByFeatureFlagName[ff.name].version = randomUUID();
  }

  return ffConfigs;
}
