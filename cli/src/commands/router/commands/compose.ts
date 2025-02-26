import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { buildRouterConfig, normalizeURL } from '@wundergraph/cosmo-shared';
import { Command, program } from 'commander';
import { parse, printSchema } from 'graphql';
import * as yaml from 'js-yaml';
import { dirname, resolve } from 'pathe';
import pc from 'picocolors';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import {
  FeatureFlagRouterExecutionConfig,
  FeatureFlagRouterExecutionConfigs,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import Table from 'cli-table3';
import { ROUTER_COMPATIBILITY_VERSION_ONE } from '@wundergraph/composition';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { composeSubgraphs, introspectSubgraph } from '../../../utils.js';

// @TODO inout validation
type Subgraph = {
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

type Config = {
  version: number;
  feature_flags: {
    name: string;
    feature_graphs: (Subgraph & { subgraph_name: string })[];
  }[];
  subgraphs: Subgraph[];
};

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

    const subgraphSDLs = new Map<string, string>();
    for (const s of config.subgraphs) {
      if (s.schema?.file) {
        const schemaFile = resolve(inputFileLocation, s.schema.file);
        const sdl = (await readFile(schemaFile)).toString();
        subgraphSDLs.set(s.name, sdl);
        continue;
      }

      const url = s.introspection?.url ?? s.routing_url;

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

        subgraphSDLs.set(s.name, result.sdl);
      } catch (e: any) {
        program.error(`Could not introspect subgraph ${s.name}, URL: ${url}: ${e.message}`);
      }
    }

    const result = composeSubgraphs(
      config.subgraphs.map((s, index) => ({
        name: s.name,
        url: normalizeURL(s.routing_url),
        definitions: parse(subgraphSDLs.get(s.name) ?? ''),
      })),
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
      subgraphs: config.subgraphs.map((s, index) => {
        const subgraphConfig = result.subgraphConfigBySubgraphName.get(s.name);
        const schema = subgraphConfig?.schema;
        const configurationDataByTypeName = subgraphConfig?.configurationDataByTypeName;
        return {
          id: `${index}`,
          name: s.name,
          url: normalizeURL(s.routing_url),
          sdl: subgraphSDLs.get(s.name) ?? '',
          subscriptionUrl: s.subscription?.url || s.routing_url,
          subscriptionProtocol: s.subscription?.protocol || 'ws',
          websocketSubprotocol:
            s.subscription?.protocol === 'ws' ? s.subscription?.websocketSubprotocol || 'auto' : undefined,
          schema,
          configurationDataByTypeName,
        };
      }),
    });

    routerConfig.version = randomUUID();

    if (config.feature_flags && config.feature_flags.length > 0) {
      const ffConfigs: FeatureFlagRouterExecutionConfigs = new FeatureFlagRouterExecutionConfigs();

      // @TODO This logic should exist only once in the shared package and reused across
      // control-plane and cli

      for (const ff of config.feature_flags) {
        const subgraphs: Subgraph[] = [];

        // Replace base subgraphs with feature flag subgraphs
        for (const s of config.subgraphs) {
          const featureSubgraph = ff.feature_graphs.find((ffs) => ffs.subgraph_name === s.name);
          if (featureSubgraph) {
            if (featureSubgraph?.schema?.file) {
              const schemaFile = resolve(inputFileLocation, featureSubgraph.schema.file);
              const sdl = (await readFile(schemaFile)).toString();
              // Replace feature subgraph sdl with the base subgraph sdl
              subgraphSDLs.set(featureSubgraph.name, sdl);
            } else {
              const url = featureSubgraph.introspection?.url ?? featureSubgraph.routing_url;
              try {
                const result = await introspectSubgraph({
                  subgraphURL: url,
                  additionalHeaders: Object.entries(featureSubgraph.introspection?.headers ?? {}).map(
                    ([key, value]) => ({
                      key,
                      value,
                    }),
                  ),
                  rawIntrospection: featureSubgraph.introspection?.raw,
                });

                if (!result.success) {
                  program.error(
                    `Could not introspect feature-graph subgraph ${featureSubgraph.name}, URL: ${url}: ${
                      result.errorMessage ?? 'failed'
                    }`,
                  );
                }

                // Replace feature subgraph sdl with the base subgraph sdl
                subgraphSDLs.set(s.name, result.sdl);
              } catch (e: any) {
                program.error(
                  `Could not introspect feature-graph subgraph ${featureSubgraph.name}, URL: ${url}: ${e.message}`,
                );
              }
            }

            subgraphs.push({
              name: featureSubgraph.name,
              routing_url: featureSubgraph.routing_url,
              schema: featureSubgraph.schema,
              subscription: featureSubgraph.subscription,
              introspection: featureSubgraph.introspection,
            });
          } else {
            subgraphs.push(s);
          }
        }

        const result = composeSubgraphs(
          subgraphs.map((s, index) => ({
            name: s.name,
            url: normalizeURL(s.routing_url),
            definitions: parse(subgraphSDLs.get(s.name) ?? ''),
          })),
        );

        if (!result.success) {
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
          for (const compositionError of result.errors) {
            compositionErrorsTable.push([compositionError.message]);
          }
          console.log(compositionErrorsTable.toString());
          continue;
        }

        if (!options.suppressWarnings && result.warnings.length > 0) {
          const compositionWarningsTable = new Table({
            head: [pc.bold(pc.white('WARNING_MESSAGE'))],
            colWidths: [120],
            wordWrap: true,
          });

          console.log(
            pc.yellow(`The following warnings were produced while composing the feature flag ${pc.italic(ff.name)}:`),
          );
          for (const warning of result.warnings) {
            compositionWarningsTable.push([warning.message]);
          }
          console.log(compositionWarningsTable.toString());
        }

        const federatedClientSDL = result.shouldIncludeClientSchema
          ? printSchema(result.federatedGraphClientSchema)
          : '';
        const routerConfig = buildRouterConfig({
          federatedClientSDL,
          federatedSDL: printSchemaWithDirectives(result.federatedGraphSchema),
          fieldConfigurations: result.fieldConfigurations,
          // @TODO get router compatibility version programmatically
          routerCompatibilityVersion: ROUTER_COMPATIBILITY_VERSION_ONE,
          schemaVersionId: `static`,
          subgraphs: subgraphs.map((s, index) => {
            const subgraphConfig = result.subgraphConfigBySubgraphName.get(s.name);
            const schema = subgraphConfig?.schema;
            const configurationDataByTypeName = subgraphConfig?.configurationDataByTypeName;
            return {
              id: `${index}`,
              name: s.name,
              url: normalizeURL(s.routing_url),
              sdl: subgraphSDLs.get(s.name) ?? '',
              subscriptionUrl: s.subscription?.url || s.routing_url,
              subscriptionProtocol: s.subscription?.protocol || 'ws',
              websocketSubprotocol:
                s.subscription?.protocol === 'ws' ? s.subscription?.websocketSubprotocol || 'auto' : undefined,
              schema,
              configurationDataByTypeName,
            };
          }),
        });

        ffConfigs.configByFeatureFlagName[ff.name] = new FeatureFlagRouterExecutionConfig({
          version: routerConfig.version,
          subgraphs: routerConfig.subgraphs,
          engineConfig: routerConfig.engineConfig,
        });

        ffConfigs.configByFeatureFlagName[ff.name].version = randomUUID();
      }

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
