import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { buildRouterConfig, normalizeURL } from '@wundergraph/cosmo-shared';
import { Command, program } from 'commander';
import { parse, printSchema } from 'graphql';
import * as yaml from 'js-yaml';
import { resolve, dirname } from 'pathe';
import pc from 'picocolors';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { composeSubgraphs, introspectSubgraph } from '../../../utils.js';

type Config = {
  version: number;
  subgraphs: {
    name: string;
    routing_url: string;
    schema?: {
      file: string;
    };
    subscriptions?: {
      protocol?: 'ws' | 'sse' | 'sse-post';
    };
    introspection?: {
      url: string;
      headers?: {
        [key: string]: string;
      };
    };
  }[];
};

export default (opts: BaseCommandOptions) => {
  const command = new Command('compose');
  command.description(
    'Generates a router config from a local composition file. This makes it easy to test your router without a control-plane connection. For production, please use the "router fetch" command',
  );
  command.requiredOption('-i, --input <path-to-input>', 'The yaml file with data about graph and subgraphs.');
  command.option('-o, --out [string]', 'Destination file for the router config.');
  command.action(async (options) => {
    const inputFile = resolve(process.cwd(), options.input);
    const inputFileLocation = dirname(inputFile);

    if (!existsSync(inputFile)) {
      console.log(
        pc.red(pc.bold(`The input file '${pc.bold(inputFile)}' does not exist. Please check the path and try again.`)),
      );
      process.exit(1);
    }

    const fileContent = (await readFile(inputFile)).toString();
    const config = yaml.load(fileContent) as Config;

    const sdls: string[] = [];
    for (const s of config.subgraphs) {
      if (s.schema?.file) {
        const schemaFile = resolve(inputFileLocation, s.schema.file);
        const sdl = (await readFile(schemaFile)).toString();
        sdls.push(sdl);
        continue;
      }

      const result = await introspectSubgraph({
        subgraphURL: s.introspection?.url ?? s.routing_url,
        additionalHeaders: Object.entries(s.introspection?.headers ?? {}).map(([key, value]) => ({
          key,
          value,
        })),
      });

      if (!result.success) {
        program.error(`Could not introspect subgraph ${s.name}: ${result.errorMessage ?? 'failed'}`);
      }

      sdls.push(result.sdl);
    }

    const result = composeSubgraphs(
      config.subgraphs.map((s, index) => ({
        name: s.name,
        url: normalizeURL(s.routing_url),
        definitions: parse(sdls[index]),
      })),
    );

    if (result.errors && result.errors.length > 0) {
      program.error(`Failed to compose: ${result.errors[0]}`);
    }

    if (!result.federationResult) {
      program.error('Failed to compose given subgraphs');
    }

    const routerConfig = buildRouterConfig({
      argumentConfigurations: result.federationResult.argumentConfigurations,
      federatedSDL: printSchema(result.federationResult.federatedGraphSchema),
      subgraphs: config.subgraphs.map((s, index) => ({
        id: `${index}`,
        name: s.name,
        url: normalizeURL(s.routing_url),
        sdl: sdls[index],
        subscriptions: s.subscriptions,
      })),
    });

    if (options.out) {
      await writeFile(options.out, routerConfig.toJsonString());
    } else {
      console.log(routerConfig.toJsonString());
    }
  });

  return command;
};
