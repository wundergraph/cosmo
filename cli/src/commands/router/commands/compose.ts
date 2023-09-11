import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { buildRouterConfig } from '@wundergraph/cosmo-shared';
import { Command, program } from 'commander';
import { parse, printSchema } from 'graphql';
import * as yaml from 'js-yaml';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { composeSubgraphs, introspectSubgraph } from '../../../utils.js';

type Subgraph = {
  name: string;
  url: string;
  headers?: {
    [key: string]: string;
  };
};

type Graph = {
  name: string;
  router: {
    url: string;
  };
  subgraphs: Subgraph[];
};

type Config = {
  version: number;
  graphs: Graph[];
};

export default (opts: BaseCommandOptions) => {
  const command = new Command('compose');
  command.description('Generates the router config locally. The output can be piped to a file.');
  command.requiredOption('-i, --input <path-to-input>', 'The yaml file with data about graph and subgraphs.');
  command.action(async (options) => {
    const inputFile = resolve(process.cwd(), options.input);

    if (!existsSync(inputFile)) {
      console.log(
        pc.red(pc.bold(`The input file '${pc.bold(inputFile)}' does not exist. Please check the path and try again.`)),
      );
      process.exit(1);
    }

    const fileContent = (await readFile(inputFile)).toString();
    const config = yaml.load(fileContent) as Config;

    const promises = [];
    for (const s of config.graphs[0].subgraphs) {
      const promise = introspectSubgraph({
        subgraphURL: s.url,
        additionalHeaders: Object.entries(s.headers ?? {}).map(([key, value]) => ({
          key,
          value,
        })),
      });
      promises.push(promise);
    }

    const introspectResults = await Promise.all(promises);

    if (introspectResults.some((r) => !r.success)) {
      program.error('Could not introspect one or more subgraphs');
    }

    const result = composeSubgraphs(
      config.graphs[0].subgraphs.map((s, index) => ({
        name: s.name,
        url: s.url,
        definitions: parse(introspectResults[index].sdl),
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
      subgraphs: config.graphs[0].subgraphs.map((s, index) => ({
        name: s.name,
        url: s.url,
        sdl: introspectResults[index].sdl,
      })),
    });

    console.log(routerConfig.toJsonString());
  });

  return command;
};
