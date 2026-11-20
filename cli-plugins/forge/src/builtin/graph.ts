import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import { parse } from 'graphql';
import type { DocumentNode } from 'graphql';
import yaml from 'js-yaml';
import { z } from 'zod';
import { fail } from './failure.js';

/** The graph file is the input of `wgc router compose`: the subgraphs and where their schemas are. */
export const defaultGraphFile = 'graph.yaml';

const subgraphEntrySchema = z.looseObject({
  name: z.string().min(1).optional(),
  routing_url: z.string().optional(),
  schema: z.looseObject({ file: z.string().min(1) }).optional(),
  grpc: z
    .looseObject({ schema_file: z.string().min(1), proto_file: z.string().min(1), mapping_file: z.string().min(1) })
    .optional(),
  plugin: z.looseObject({ path: z.string().min(1) }).optional(),
});

const graphFileSchema = z.looseObject({
  version: z.number(),
  subgraphs: z.array(subgraphEntrySchema).default([]),
});

export type SubgraphEntry = z.infer<typeof subgraphEntrySchema>;
export type GraphFile = z.infer<typeof graphFileSchema>;

export interface LoadedSubgraph {
  name: string;
  routingUrl: string;
  /** The schema file as written in reports: relative to the directory of the graph file. */
  file: string;
  document: DocumentNode;
}

/** Reads the graph file. A workspace that has none yet gets `undefined`. */
export const readGraphFile = async (graphPath: string): Promise<Result<GraphFile | undefined>> => {
  let text: string;
  try {
    text = await readFile(graphPath, 'utf8');
  } catch {
    return { success: true, data: undefined };
  }

  let document: unknown;
  try {
    document = yaml.load(text);
  } catch (error) {
    return fail({
      message: `${graphPath} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
      input: graphPath,
      fix: 'Correct the YAML syntax of the graph file.',
    });
  }

  const parsed = graphFileSchema.safeParse(document);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    return fail({
      message: `${graphPath} is not a graph file: ${issue.path.join('.')} ${issue.message}.`,
      input: graphPath,
      fix: 'Use the input format of `wgc router compose`: `version: 1` and a `subgraphs` list.',
    });
  }

  return { success: true, data: parsed.data };
};

export const writeGraphFile = async (graphPath: string, graph: GraphFile): Promise<void> => {
  await writeFile(graphPath, yaml.dump(graph, { lineWidth: -1 }));
};

const schemaFileOf = (entry: SubgraphEntry): string | undefined => {
  if (entry.schema !== undefined) {
    return entry.schema.file;
  }
  if (entry.grpc !== undefined) {
    return entry.grpc.schema_file;
  }
  if (entry.plugin !== undefined) {
    return path.join(entry.plugin.path, 'src', 'schema.graphql');
  }
  return undefined;
};

const loadSubgraph = async (
  graphPath: string,
  entry: SubgraphEntry,
  index: number,
): Promise<Result<LoadedSubgraph>> => {
  const name = entry.name ?? (entry.plugin === undefined ? undefined : path.basename(entry.plugin.path));
  const input = `${graphPath}: subgraphs[${index}]`;
  if (name === undefined) {
    return fail({ message: `Subgraph ${index + 1} in ${graphPath} has no name.`, input, fix: 'Give it a `name`.' });
  }

  const file = schemaFileOf(entry);
  if (file === undefined) {
    return fail({
      message: `Subgraph ${name} has no schema file, so its schema cannot be checked.`,
      input,
      fix: 'Point `schema.file` at the subgraph SDL. Introspection is not used by the check.',
    });
  }

  let sdl: string;
  try {
    sdl = await readFile(path.resolve(path.dirname(graphPath), file), 'utf8');
  } catch {
    return fail({
      message: `The schema file ${file} of subgraph ${name} does not exist.`,
      input,
      fix: 'Correct the path, which is relative to the graph file.',
    });
  }

  try {
    return { success: true, data: { name, routingUrl: entry.routing_url ?? '', file, document: parse(sdl) } };
  } catch (error) {
    return fail({
      message: `${file} is not valid GraphQL: ${error instanceof Error ? error.message : String(error)}`,
      input: file,
      fix: 'Correct the GraphQL syntax of the subgraph schema.',
    });
  }
};

/** Loads and parses the schema of every subgraph in the graph file. */
export const loadGraph = async (graphPath: string): Promise<Result<LoadedSubgraph[]>> => {
  const graph = await readGraphFile(graphPath);
  if (!graph.success) {
    return graph;
  }
  if (graph.data === undefined || graph.data.subgraphs.length === 0) {
    return fail({
      message: `There is no graph to check: ${graphPath} ${graph.data === undefined ? 'does not exist' : 'lists no subgraphs'}.`,
      input: graphPath,
      fix: 'List the subgraphs and their schema files in the graph file, in the input format of `wgc router compose`, or pass --graph <file>.',
    });
  }

  const subgraphs: LoadedSubgraph[] = [];
  for (const [index, entry] of graph.data.subgraphs.entries()) {
    const loaded = await loadSubgraph(graphPath, entry, index);
    if (!loaded.success) {
      return loaded;
    }
    subgraphs.push(loaded.data);
  }

  return { success: true, data: subgraphs };
};
