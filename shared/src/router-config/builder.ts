import crypto from 'node:crypto';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import { ArgumentConfigurationData, normalizeSubgraphFromString } from '@wundergraph/composition';
import { GraphQLSchema, lexicographicSortSchema } from 'graphql';
import {
  ConfigurationVariable,
  ConfigurationVariableKind,
  DataSourceConfiguration,
  DataSourceKind,
  EngineConfiguration,
  HTTPMethod,
  InternedString,
  RouterConfig,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import {
  argumentConfigurationDatasToFieldConfigurations,
  configurationDataMapToDataSourceConfiguration,
} from './graphql-configuration.js';

export interface Input {
  argumentConfigurations: ArgumentConfigurationData[];
  federatedSDL: string;
  subgraphs: Subgraph[];
}

export interface Subgraph {
  sdl: string;
  url: string;
}

export const internString = (config: EngineConfiguration, str: string): InternedString => {
  const key = crypto.createHash('sha1').update(str).digest('hex');
  config.stringStorage[key] = str;
  return new InternedString({
    key,
  });
};

export const buildRouterConfig = function (input: Input): RouterConfig {
  const engineConfig = new EngineConfiguration({
    defaultFlushInterval: BigInt(500),
    datasourceConfigurations: [],
    fieldConfigurations: [],
    graphqlSchema: '',
    stringStorage: {},
    typeConfigurations: [],
  });

  for (const subgraph of input.subgraphs) {
    let schema: GraphQLSchema = new GraphQLSchema({});
    const { errors, normalizationResult } = normalizeSubgraphFromString(subgraph.sdl);
    if (errors) {
      throw new Error('Normalization failed', { cause: errors[0] });
    }
    if (normalizationResult?.schema) {
      schema = normalizationResult.schema;
    }

    // IMPORTANT NOTE: printSchema and printSchemaWithDirectives promotes extension types to "full" types
    const upstreamSchema = internString(engineConfig, printSchemaWithDirectives(lexicographicSortSchema(schema)));
    const { childNodes, rootNodes, keys, provides, requires } = configurationDataMapToDataSourceConfiguration(
      normalizationResult!.configurationDataMap,
    );
    const datasourceConfig = new DataSourceConfiguration({
      id: subgraph.url,
      childNodes,
      rootNodes,
      keys,
      provides,
      requires,
      kind: DataSourceKind.GRAPHQL,
      customGraphql: {
        customScalarTypeFields: [],
        federation: {
          enabled: true,
          serviceSdl: subgraph.sdl,
        },
        upstreamSchema,
        fetch: {
          url: new ConfigurationVariable({
            kind: ConfigurationVariableKind.STATIC_CONFIGURATION_VARIABLE,
            staticVariableContent: subgraph.url,
          }),
          method: HTTPMethod.POST,
          header: {},
          body: {},
          baseUrl: {},
          path: {},
        },
        subscription: {
          enabled: true,
          url: new ConfigurationVariable({
            kind: ConfigurationVariableKind.STATIC_CONFIGURATION_VARIABLE,
            staticVariableContent: subgraph.url,
          }),
          useSSE: false,
        },
      },
      directives: [],
      overrideFieldPathFromAlias: true,
      requestTimeoutSeconds: BigInt(10),
    });
    engineConfig.datasourceConfigurations.push(datasourceConfig);
  }
  engineConfig.fieldConfigurations = argumentConfigurationDatasToFieldConfigurations(input.argumentConfigurations);
  engineConfig.graphqlSchema = input.federatedSDL;
  return new RouterConfig({
    engineConfig,
  });
};
