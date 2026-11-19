import type { Command } from 'commander';
import { catalog, createModule } from '../catalog.js';
import { toFailure } from '../failure.js';
import { lockFileName, readLock } from '../lock.js';
import { readManifest, sameSource, writeManifest } from '../manifest.js';
import { withCommonOptions, workspaceOf } from './shared.js';
import type { CommonOptions, ForgeDependencies } from './shared.js';

interface CreateOptions extends CommonOptions {
  template?: string;
  preset?: string;
  experimental?: boolean;
  listTemplates?: boolean;
}

const idsOf = (kind: 'preset' | 'template'): string =>
  catalog
    .filter((entry) => entry.kind === kind)
    .map((entry) => entry.id)
    .join(', ');

export const registerCreate = (command: Command, dependencies: ForgeDependencies): void => {
  withCommonOptions(
    command
      .command('create')
      .description('Add a module to the workspace from a preset or a hook template.')
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

    if ((options.template === undefined) === (options.preset === undefined)) {
      return output.fail({
        message: 'Pass exactly one of --template <id> and --preset <id>.',
        input: '--template, --preset',
        fix: 'Run `wgc forge create --list-templates` to see the IDs.',
      });
    }

    const kind = options.preset === undefined ? 'template' : 'preset';
    const id = options.preset ?? options.template;
    const entry = catalog.find((candidate) => candidate.kind === kind && candidate.id === id);
    if (entry === undefined) {
      return output.fail({
        message: `There is no ${kind} "${id}".`,
        input: `--${kind} ${id}`,
        fix: `Use one of: ${idsOf(kind)}.`,
      });
    }

    if (entry.experimental && options.experimental !== true) {
      return output.fail({
        message: `The ${entry.id} ${kind} uses an experimental router hook.`,
        input: `--${kind} ${entry.id}`,
        fix: 'Pass --experimental to create it anyway.',
      });
    }

    const moduleName = name ?? (kind === 'preset' ? entry.id : undefined);
    if (moduleName === undefined) {
      return output.fail({
        message: 'A module created from a template needs a name.',
        input: `--template ${entry.id}`,
        fix: `Pass the name after the flags, for example \`wgc forge create --template ${entry.id} my-module\`.`,
      });
    }

    const workspace = workspaceOf(dependencies, options);
    const manifest = await readManifest(workspace);
    if (!manifest.success) {
      return output.fail(toFailure(manifest));
    }
    const lock = await readLock(workspace);
    if (!lock.success) {
      return output.fail(toFailure(lock));
    }
    if (lock.data === undefined) {
      return output.fail({
        message: `The workspace has no ${lockFileName}, so the router version the module builds against is unknown.`,
        input: lockFileName,
        fix: 'Run `wgc forge lock` first.',
      });
    }

    const created = await createModule({ workspace, entry, name: moduleName, router: lock.data.router });
    if (!created.success) {
      return output.fail(toFailure(created));
    }

    const source = { path: created.data };
    if (!manifest.data.modules.some((module) => sameSource(module, source))) {
      await writeManifest(workspace, { ...manifest.data, modules: [...manifest.data.modules, source] });
    }

    output.result({ module: moduleName, path: created.data, from: { kind, id: entry.id } }, (data) =>
      [`Created ${data.path} from ${kind} ${entry.id} and added it to forge.yaml.`, 'Next: `wgc forge build`.'].join(
        '\n',
      ),
    );
  });
};
