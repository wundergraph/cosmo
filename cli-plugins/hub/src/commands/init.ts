import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import { failWith, ok, toFailure } from '@wundergraph/wgc-plugin-sdk';
import type { PluginContext, Result } from '@wundergraph/wgc-plugin-sdk';
import { configFileName, renderConfig } from '@wundergraph/wgc-plugin-sdk/config';
import type { SchemaSubgraph } from '@wundergraph/wgc-plugin-sdk/config';

type FileAction = 'created' | 'kept' | 'overwritten';

interface InitOptions {
  dir: string;
  graph?: string;
  namespace: string;
  command?: string;
  force?: boolean;
  json?: boolean;
}

const skippedDirectories = new Set(['node_modules', 'dist', '.git']);

const findSchemaFiles = async (root: string, relativeDir = ''): Promise<string[]> => {
  const entries = await readdir(path.join(root, relativeDir), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) {
        found.push(...(await findSchemaFiles(root, relativePath)));
      }
    } else if (entry.name.endsWith('.graphql') || entry.name.endsWith('.graphqls')) {
      found.push(relativePath);
    }
  }
  return found;
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(/[^\d_a-z-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '') || 'subgraph';

/** `products.graphql` is `products`; a generic `schema.graphql` takes its directory's name. */
const subgraphsFromFiles = (files: string[], root: string): SchemaSubgraph[] => {
  const taken = new Set<string>();
  return files.map((file) => {
    const base = path.posix.basename(file).replace(/\.graphqls?$/, '');
    const parent = path.posix.basename(path.posix.dirname(file));
    const preferred = slugify(base === 'schema' ? (parent === '.' ? path.basename(root) : parent) : base);
    let name = preferred;
    for (let suffix = 2; taken.has(name); suffix++) {
      name = `${preferred}-${suffix}`;
    }
    taken.add(name);
    return { name, kind: 'schema', schema: { file } };
  });
};

const writeIfAbsent = async (
  dir: string,
  fileName: string,
  content: string,
  force: boolean,
): Promise<Result<{ path: string; action: FileAction }>> => {
  const filePath = path.join(dir, fileName);
  const exists = existsSync(filePath);
  if (exists && !force) {
    return ok({ path: fileName, action: 'kept' });
  }
  try {
    await writeFile(filePath, content);
  } catch (error) {
    return failWith({
      message: `Could not write ${filePath}: ${(error as Error).message}`,
      remediation: 'Check the directory permissions.',
    });
  }
  return ok({ path: fileName, action: exists ? 'overwritten' : 'created' });
};

const resolveGraph = async (options: InitOptions, context: PluginContext): Promise<Result<string>> => {
  if (options.graph) {
    return ok(options.graph);
  }
  if (context.prompts.canPrompt) {
    const answer = await context.prompts.text('Federated graph name in Cosmo:');
    if (answer) {
      return ok(answer);
    }
  }
  return failWith({
    kind: 'usage',
    message: 'No federated graph given.',
    remediation: 'Pass `--graph <name>`, the name of the federated graph in Cosmo.',
  });
};

const resolveSubgraphs = async (
  options: InitOptions,
  context: PluginContext,
  dir: string,
): Promise<Result<SchemaSubgraph[]>> => {
  const fallbackName = slugify(path.basename(dir));
  if (options.command) {
    return ok([{ name: fallbackName, kind: 'schema', schema: { command: options.command } }]);
  }

  const files = await findSchemaFiles(dir);
  if (files.length > 0) {
    return ok(subgraphsFromFiles(files, dir));
  }

  if (context.prompts.canPrompt) {
    const command = await context.prompts.text('No .graphql files found. Command that prints the subgraph SDL:');
    if (command) {
      return ok([{ name: fallbackName, kind: 'schema', schema: { command } }]);
    }
  }
  return failWith({
    kind: 'usage',
    message: `No .graphql or .graphqls files under ${dir}.`,
    remediation: 'Pass `--command "<command that prints the SDL>"`, e.g. `--command "npm run --silent print-schema"`.',
    input: dir,
  });
};

const runInit = async (options: InitOptions, context: PluginContext): Promise<void> => {
  const output = context.output({ json: options.json });
  const dir = path.resolve(options.dir);
  if (!existsSync(dir)) {
    output.fail({
      message: `No directory at ${dir}.`,
      input: options.dir,
      remediation: 'Pass `--dir <path>` to an existing directory.',
    });
    return;
  }

  const graph = await resolveGraph(options, context);
  if (!graph.success) {
    output.fail(toFailure(graph));
    return;
  }
  const subgraphs = await resolveSubgraphs(options, context, dir);
  if (!subgraphs.success) {
    output.fail(toFailure(subgraphs));
    return;
  }

  const content = renderConfig({ graph: graph.data, namespace: options.namespace, subgraphs: subgraphs.data });
  const written = await writeIfAbsent(dir, configFileName, content, options.force === true);
  if (!written.success) {
    output.fail(toFailure(written));
    return;
  }

  output.result({ graph: graph.data, subgraphs: subgraphs.data, file: written.data }, (data) => {
    const lines = [`${data.file.action === 'kept' ? pc.dim('kept') : pc.green(data.file.action)} ${data.file.path}`];
    for (const subgraph of data.subgraphs) {
      const source = 'file' in subgraph.schema ? subgraph.schema.file : `$ ${subgraph.schema.command}`;
      lines.push(`  ${pc.cyan(subgraph.name)} ${source}`);
    }
    if (data.file.action === 'kept') {
      lines.push(pc.dim(`${configFileName} was left as it is. Pass --force to overwrite it.`));
    }
    lines.push('Connect this repository in Hub to get its CI workflow.');
    return lines.join('\n');
  });
};

export const initCommand = (context: PluginContext): Command =>
  new Command('init')
    .description(`Write ${configFileName} for this repository`)
    .option('--dir <path>', 'Repository directory', '.')
    .option('--graph <name>', 'Federated graph name in Cosmo')
    .option('-n, --namespace <name>', 'Cosmo namespace of the federated graph', 'default')
    .option('--command <command>', 'Command that prints the subgraph SDL, when the repository has no .graphql files')
    .option('--force', `Overwrite an existing ${configFileName}`)
    .option('--json', 'Print the result as JSON')
    .action((options: InitOptions) => runInit(options, context));
