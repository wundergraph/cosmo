import { toFailure } from '@wundergraph/wgc-plugin-sdk';
import type { Command } from 'commander';
import type { Prompts } from '@wundergraph/wgc-plugin-sdk';
import { configFileName, lockFileName } from '@wundergraph/wgc-plugin-sdk/config';
import { catalog, createModule } from '../catalog.js';
import type { CatalogEntry } from '../catalog.js';
import { sameSource } from '../sources.js';
import { readLock, readRouterWorkspace, writeConfig } from '../workspace.js';
import { withCommonOptions, workspaceOf } from './shared.js';
import type { CommonOptions, ForgeDependencies } from './shared.js';

interface CreateOptions extends CommonOptions {
  template?: string;
  preset?: string;
  experimental?: boolean;
  listTemplates?: boolean;
}

/** The starter menu for a person at a terminal: every preset and template, picked by number. */
const chooseStarter = async (prompts: Prompts): Promise<CatalogEntry | undefined> => {
  const menu = catalog.map(
    (entry, index) =>
      `  ${String(index + 1).padStart(2)}. ${entry.id.padEnd(22)} ${entry.kind.padEnd(8)} ${entry.description}`,
  );
  const answer = await prompts.text(['Starters:', ...menu, 'Choose a starter by number:'].join('\n'));
  const index = Number.parseInt(answer, 10) - 1;
  return catalog[index];
};

const idsOf = (kind: 'preset' | 'template'): string =>
  catalog
    .filter((entry) => entry.kind === kind)
    .map((entry) => entry.id)
    .join(', ');

export const registerCreate = (command: Command, dependencies: ForgeDependencies): void => {
  withCommonOptions(
    command
      .command('create')
      .description(
        'Create and register a local module. Opens the starter menu at a terminal, or pass --template <id> or --preset <id>.',
      )
      .argument('[name]', 'The module name, used for modules/<name>. Defaults to the preset ID.')
      .option('--template <id>', 'Start from an empty hook. See --list-templates.')
      .option('--preset <id>', 'Add a finished module. See --list-templates.')
      .option('--list-templates', 'List the presets and templates.')
      .option('--experimental', 'Allow templates built on experimental router hooks.'),
  ).action(async (name: string | undefined, options: CreateOptions) => {
    const output = dependencies.context.output({ json: options.json });

    if (options.listTemplates) {
      const describe = (kind: 'preset' | 'template') =>
        catalog
          .filter((entry) => entry.kind === kind)
          .map(({ id, description, experimental }) => ({ id, description, experimental: experimental === true }));
      return output.result({ presets: describe('preset'), templates: describe('template') }, (data) =>
        [
          'Presets (wgc forge create --preset <id>):',
          ...data.presets.map((entry) => `  ${entry.id.padEnd(22)} ${entry.description}`),
          'Templates (wgc forge create --template <id> <name>):',
          ...data.templates.map((entry) => `  ${entry.id.padEnd(22)} ${entry.description}`),
        ].join('\n'),
      );
    }

    if (options.template !== undefined && options.preset !== undefined) {
      return output.fail({
        message: 'Pass only one of --template <id> and --preset <id>.',
        input: '--template, --preset',
        remediation: 'Run `wgc forge create --list-templates` to see the IDs.',
      });
    }

    const interactive = dependencies.context.prompts.canPrompt && options.json !== true;
    if (options.template === undefined && options.preset === undefined && !interactive) {
      return output.fail({
        message: 'Pass one of --template <id> and --preset <id>.',
        input: '--template, --preset',
        remediation: 'Run `wgc forge create --list-templates` to see the IDs.',
      });
    }

    let entry: CatalogEntry | undefined;
    if (options.template === undefined && options.preset === undefined) {
      entry = await chooseStarter(dependencies.context.prompts);
      if (entry === undefined) {
        return output.fail({
          message: 'That is not one of the listed starters.',
          input: 'starter',
          remediation: 'Run `wgc forge create` again and type the number of a starter.',
        });
      }
    } else {
      const kind = options.preset === undefined ? 'template' : 'preset';
      const id = options.preset ?? options.template;
      entry = catalog.find((candidate) => candidate.kind === kind && candidate.id === id);
      if (entry === undefined) {
        return output.fail({
          message: `There is no ${kind} "${id}".`,
          input: `--${kind} ${id}`,
          remediation: `Use one of: ${idsOf(kind)}.`,
        });
      }
    }
    const kind = entry.kind;

    if (entry.experimental && options.experimental !== true) {
      return output.fail({
        message: `The ${entry.id} ${kind} uses an experimental router hook.`,
        input: `--${kind} ${entry.id}`,
        remediation: 'Pass --experimental to create it anyway.',
      });
    }

    const defaultName = kind === 'preset' ? entry.id : undefined;
    const moduleName =
      name ?? (interactive ? await dependencies.context.prompts.text('Module name:', defaultName) : defaultName);
    if (moduleName === undefined || moduleName === '') {
      return output.fail({
        message: 'A module created from a template needs a name.',
        input: `--template ${entry.id}`,
        remediation: `Pass the name after the flags, for example \`wgc forge create --template ${entry.id} my-module\`.`,
      });
    }

    const workspace = workspaceOf(dependencies, options);
    const read = await readRouterWorkspace(workspace);
    if (!read.success) {
      return output.fail(toFailure(read));
    }
    const { config, router } = read.data;
    const lock = await readLock(workspace);
    if (!lock.success) {
      return output.fail(toFailure(lock));
    }
    if (lock.data === undefined) {
      return output.fail({
        message: `The workspace has no ${lockFileName}, so the router version the module builds against is unknown.`,
        input: lockFileName,
        remediation: 'Run `wgc forge lock` first.',
      });
    }

    const created = await createModule({ workspace, entry, name: moduleName, router: lock.data.router });
    if (!created.success) {
      return output.fail(toFailure(created));
    }

    const source = { path: created.data };
    if (!router.modules.some((module) => sameSource(module, source))) {
      await writeConfig(workspace, { ...config, router: { ...router, modules: [...router.modules, source] } });
    }

    output.result({ module: moduleName, path: created.data, from: { kind, id: entry.id } }, (data) =>
      [
        `Created ${data.path} from ${kind} ${entry.id} and added it to ${configFileName}.`,
        'Next: `wgc forge build`.',
      ].join('\n'),
    );
  });
};
