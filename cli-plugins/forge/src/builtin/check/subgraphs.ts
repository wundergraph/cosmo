import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { failWith } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import { configFileName } from '@wundergraph/wgc-plugin-sdk/config';
import type { Subgraph } from '@wundergraph/wgc-plugin-sdk/config';
import { parse } from 'graphql';
import type { DocumentNode } from 'graphql';
import { lastLines } from '../failure.js';
import type { System } from '../system.js';

export interface LoadedSubgraph {
  name: string;
  routingUrl: string;
  /** Where findings point: the schema file relative to wundergraph.yaml, or the command that prints the SDL. */
  file: string;
  document: DocumentNode;
}

type SchemaOrigin = { file: string } | { command: string };

const schemaOrigin = (subgraph: Subgraph): SchemaOrigin => {
  if (subgraph.kind === 'plugin') {
    return { file: path.posix.join(subgraph.path, 'src', 'schema.graphql') };
  }
  return subgraph.schema;
};

const readSdl = async (
  workspace: string,
  subgraph: Subgraph,
  origin: SchemaOrigin,
  system: System,
): Promise<Result<string>> => {
  const input = `${configFileName}: subgraphs ${subgraph.name}`;

  if ('command' in origin) {
    const outcome = await system.run({ file: 'sh', args: ['-c', origin.command], cwd: workspace });
    if (outcome.exitCode !== 0) {
      return failWith({
        message: `The schema command \`${origin.command}\` of subgraph ${subgraph.name} exited with code ${outcome.exitCode}:\n${lastLines(outcome.stderr)}`,
        input,
        remediation: `Fix the command, which runs in the directory of ${configFileName} and must print the subgraph SDL.`,
      });
    }
    return { success: true, data: outcome.stdout };
  }

  try {
    return { success: true, data: await readFile(path.resolve(workspace, origin.file), 'utf8') };
  } catch {
    return failWith({
      message: `The schema file ${origin.file} of subgraph ${subgraph.name} does not exist.`,
      input,
      remediation: `Correct the path, which is relative to ${configFileName}.`,
    });
  }
};

/** Loads and parses the schema of every subgraph in wundergraph.yaml. */
export const loadSubgraphs = async (
  workspace: string,
  subgraphs: Subgraph[],
  system: System,
): Promise<Result<LoadedSubgraph[]>> => {
  if (subgraphs.length === 0) {
    return failWith({
      message: `There is no graph to check: ${configFileName} lists no subgraphs.`,
      input: `${configFileName}: subgraphs`,
      remediation: `List the subgraphs and their schemas under \`subgraphs\` in ${configFileName}.`,
    });
  }

  const loaded: LoadedSubgraph[] = [];
  for (const subgraph of subgraphs) {
    const origin = schemaOrigin(subgraph);
    const sdl = await readSdl(workspace, subgraph, origin, system);
    if (!sdl.success) {
      return sdl;
    }

    const file = 'command' in origin ? origin.command : origin.file;
    let document: DocumentNode;
    try {
      document = parse(sdl.data);
    } catch (error) {
      return failWith({
        message: `${file} is not valid GraphQL: ${error instanceof Error ? error.message : String(error)}`,
        input: file,
        remediation: 'Correct the GraphQL syntax of the subgraph schema.',
      });
    }

    const routingUrl = subgraph.kind === 'plugin' ? '' : (subgraph.routing_url ?? '');
    loaded.push({ name: subgraph.name, routingUrl, file, document });
  }

  return { success: true, data: loaded };
};
