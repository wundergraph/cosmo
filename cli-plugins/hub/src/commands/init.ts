import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Command, Option } from 'commander';
import yaml from 'js-yaml';
import pc from 'picocolors';
import { failWith, ok, toFailure } from '@wundergraph/wgc-plugin-sdk';
import type { PluginContext, Result } from '@wundergraph/wgc-plugin-sdk';
import { hubGitlabTokenVariable } from '../common/hub.js';
import { defaultAudience, sandboxFileName } from '../common/sandbox-config.js';

type CiProvider = 'github' | 'gitlab' | 'none';

type FileAction = 'created' | 'kept' | 'overwritten';

interface InitOptions {
  dir: string;
  schema?: string;
  generate?: string;
  ci?: CiProvider;
  audience: string;
  force?: boolean;
  json?: boolean;
}

interface SubgraphDraft {
  name: string;
  schema?: string;
  generate?: string;
}

const skippedDirectories = new Set(['node_modules', 'dist', '.git']);

const githubWorkflowPath = path.join('.github', 'workflows', 'hub-sandbox.yml');
const gitlabSnippetPath = 'hub-sandbox.gitlab-ci.yml';

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
const subgraphsFromFiles = (files: string[], root: string): SubgraphDraft[] => {
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
    return { name, schema: file };
  });
};

const githubWorkflow = (audience: string, wgcInstallArgs: string, command: string): string => `name: Hub sandbox

on:
  pull_request:

permissions:
  contents: read
  id-token: write

jobs:
  schema-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install --global ${wgcInstallArgs}
      - run: ${command} plugins install hub
      - run: ${command} hub schema push --json --sha \${{ github.event.pull_request.head.sha }}${audience === defaultAudience ? '' : ` --audience ${audience}`}
`;

const gitlabSnippet = (
  audience: string,
  wgcInstallArgs: string,
  command: string,
): string => `# Include from .gitlab-ci.yml:
#   include:
#     - local: ${gitlabSnippetPath}
hub-sandbox:
  image: node:22
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  id_tokens:
    ${hubGitlabTokenVariable}:
      aud: ${audience}
  script:
    - npm install --global ${wgcInstallArgs}
    - ${command} plugins install hub
    - ${command} hub schema push --json${audience === defaultAudience ? '' : ` --audience ${audience}`}
`;

const writeIfAbsent = async (
  dir: string,
  relativePath: string,
  content: string,
  force: boolean,
): Promise<Result<{ path: string; action: FileAction }>> => {
  const filePath = path.join(dir, relativePath);
  const displayPath = relativePath.split(path.sep).join('/');
  const exists = existsSync(filePath);
  if (exists && !force) {
    return ok({ path: displayPath, action: 'kept' });
  }
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  } catch (error) {
    return failWith({
      message: `Could not write ${filePath}: ${(error as Error).message}`,
      remediation: 'Check the directory permissions.',
    });
  }
  return ok({ path: displayPath, action: exists ? 'overwritten' : 'created' });
};

const chooseCi = (dir: string, requested: CiProvider | undefined): CiProvider => {
  if (requested) {
    return requested;
  }
  if (existsSync(path.join(dir, '.github'))) {
    return 'github';
  }
  if (existsSync(path.join(dir, '.gitlab-ci.yml'))) {
    return 'gitlab';
  }
  return 'none';
};

const resolveSchemaSlug = async (options: InitOptions, context: PluginContext): Promise<Result<string>> => {
  if (options.schema) {
    return ok(options.schema);
  }
  if (context.prompts.canPrompt) {
    const answer = await context.prompts.text('Hub schema slug (from the schema URL in Hub):');
    if (answer) {
      return ok(answer);
    }
  }
  return failWith({
    kind: 'usage',
    message: 'No Hub schema slug given.',
    remediation: 'Pass `--schema <slug>`, the slug in the schema URL in Hub.',
  });
};

const resolveSubgraphs = async (
  options: InitOptions,
  context: PluginContext,
  dir: string,
): Promise<Result<SubgraphDraft[]>> => {
  const fallbackName = slugify(path.basename(dir));
  if (options.generate) {
    return ok([{ name: fallbackName, generate: options.generate }]);
  }

  const files = await findSchemaFiles(dir);
  if (files.length > 0) {
    return ok(subgraphsFromFiles(files, dir));
  }

  if (context.prompts.canPrompt) {
    const command = await context.prompts.text('No .graphql files found. Command that prints the subgraph SDL:');
    if (command) {
      return ok([{ name: fallbackName, generate: command }]);
    }
  }
  return failWith({
    kind: 'usage',
    message: `No .graphql or .graphqls files under ${dir}.`,
    remediation:
      'Pass `--generate "<command that prints the SDL>"`, e.g. `--generate "npm run --silent print-schema"`.',
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

  const schema = await resolveSchemaSlug(options, context);
  if (!schema.success) {
    output.fail(toFailure(schema));
    return;
  }
  const subgraphs = await resolveSubgraphs(options, context, dir);
  if (!subgraphs.success) {
    output.fail(toFailure(subgraphs));
    return;
  }

  const document: Record<string, string | SubgraphDraft[]> = { schema: schema.data };
  if (options.audience !== defaultAudience) {
    document.audience = options.audience;
  }
  document.subgraphs = subgraphs.data;

  const ci = chooseCi(dir, options.ci);
  const planned: Array<{ path: string; content: string }> = [
    { path: sandboxFileName, content: yaml.dump(document, { lineWidth: -1 }) },
  ];
  if (ci === 'github') {
    planned.push({
      path: githubWorkflowPath,
      content: githubWorkflow(options.audience, context.endpoints.wgcInstallArgs, context.command),
    });
  } else if (ci === 'gitlab') {
    planned.push({
      path: gitlabSnippetPath,
      content: gitlabSnippet(options.audience, context.endpoints.wgcInstallArgs, context.command),
    });
  }

  const files: Array<{ path: string; action: FileAction }> = [];
  for (const file of planned) {
    const written = await writeIfAbsent(dir, file.path, file.content, options.force === true);
    if (!written.success) {
      output.fail(toFailure(written));
      return;
    }
    files.push(written.data);
  }

  output.result({ schema: schema.data, ci, subgraphs: subgraphs.data, files }, (data) => {
    const lines = data.files.map(
      (file) => `${file.action === 'kept' ? pc.dim('kept') : pc.green(file.action)} ${file.path}`,
    );
    lines.push(
      ...data.subgraphs.map((subgraph) => `  ${pc.cyan(subgraph.name)} ${subgraph.schema ?? `$ ${subgraph.generate}`}`),
    );
    if (data.files.some((file) => file.action === 'kept')) {
      lines.push(pc.dim('Existing files were left as they are. Pass --force to overwrite them.'));
    }
    if (data.ci === 'gitlab') {
      lines.push(`Include it from .gitlab-ci.yml:  include: [{ local: ${gitlabSnippetPath} }]`);
    }
    if (data.ci === 'none') {
      lines.push(pc.dim('No CI file written. Pass --ci github or --ci gitlab to add one.'));
    }
    return lines.join('\n');
  });
};

export const initCommand = (context: PluginContext): Command =>
  new Command('init')
    .description('Write sandbox.yaml for this repository and a CI job that pushes its schema to Hub')
    .option('--dir <path>', 'Repository directory', '.')
    .option('--schema <slug>', 'Hub schema slug')
    .option('--generate <command>', 'Command that prints the subgraph SDL, when the repository has no .graphql files')
    .addOption(new Option('--ci <provider>', 'CI file to write').choices(['github', 'gitlab', 'none']))
    .option('--audience <audience>', 'OIDC audience Hub expects from CI', defaultAudience)
    .option('--force', 'Overwrite existing files')
    .option('--json', 'Print the result as JSON')
    .action((options: InitOptions) => runInit(options, context));
