import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { failWith, toFailure } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import {
  configFileName,
  configSchema,
  defaultRouterBinary,
  lockFileName,
  routerSourceSchema,
} from '@wundergraph/wgc-plugin-sdk/config';
import type { RouterConfig, RouterSource, WundergraphConfig } from '@wundergraph/wgc-plugin-sdk/config';
import type { Command } from 'commander';
import type { FileAction } from '../guidance.js';
import { ignoreGeneratedFiles, writeGuidance } from '../guidance.js';
import { resolvePins } from '../pins.js';
import { latestRouterRelease } from '../resolve.js';
import { parseRouterCandidate } from '../sources.js';
import { readConfig, readLock, writeConfig, writeLock } from '../workspace.js';
import { routerSummary, withCommonOptions, workspaceOf } from './shared.js';
import type { CommonOptions, ForgeDependencies } from './shared.js';

interface InitOptions extends CommonOptions {
  graph?: string;
  release?: string;
  rc?: string;
  commit?: string;
}

const requestedRouter = (options: InitOptions): Result<RouterSource | undefined> => {
  const requested = [
    options.release === undefined ? undefined : { release: options.release },
    options.rc === undefined ? undefined : { rc: options.rc },
    options.commit === undefined ? undefined : { commit: options.commit },
  ].filter((source) => source !== undefined);

  if (requested.length === 0) {
    return { success: true, data: undefined };
  }
  if (requested.length > 1) {
    return failWith({
      message: 'Pass only one of --release, --rc and --commit.',
      input: '--release, --rc, --commit',
      remediation: 'A workspace builds one router version. Keep the flag for the version you want.',
    });
  }

  const parsed = routerSourceSchema.safeParse(requested[0]);
  if (!parsed.success) {
    const [flag, value] = Object.entries(requested[0])[0];
    return failWith({
      message: `--${flag} ${value} ${parsed.error.issues[0].message}.`,
      input: `--${flag} ${value}`,
      remediation: 'Pass a release such as 0.299.0, a release candidate such as 0.300.0-rc.1, or a commit SHA.',
    });
  }
  return { success: true, data: parsed.data };
};

/** The directory name as a graph name: letters, digits, `-` and `_`, starting with a letter or digit. */
const graphNameOf = (directory: string): string => {
  const name = path
    .basename(directory)
    .replaceAll(/[^\w-]+/g, '-')
    .replaceAll(/^[^\dA-Za-z]+|-+$/g, '');
  return name === '' ? 'graph' : name;
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

export const registerInit = (command: Command, dependencies: ForgeDependencies): void => {
  withCommonOptions(
    command
      .command('init')
      .description(
        `Add a router to ${configFileName} in the current or named directory, creating the file when there is none, write ${lockFileName}, and add agent guidance. Safe to run again.`,
      )
      .argument(
        '[directory]',
        `The directory of ${configFileName}. Defaults to the nearest one, then the current directory.`,
      )
      .option('--graph <name>', `The federated graph of a new ${configFileName}. Defaults to the directory name.`)
      .option('--release <version>', 'The router release to build, e.g. 0.299.0. Defaults to the latest release.')
      .option('--rc <version>', 'A router release candidate to build, e.g. 0.300.0-rc.1.')
      .option('--commit <sha>', 'A router commit to build.'),
  ).action(async (directory: string | undefined, options: InitOptions) => {
    const { system, context } = dependencies;
    const output = context.output({ json: options.json });
    const workspace = workspaceOf(dependencies, { ...options, dir: directory ?? options.dir });
    const files: { path: string; action: FileAction }[] = [];

    const requested = requestedRouter(options);
    if (!requested.success) {
      return output.fail(toFailure(requested));
    }

    let config: WundergraphConfig;
    let configAction: FileAction;
    if (await fileExists(path.join(workspace, configFileName))) {
      const existing = await readConfig(workspace);
      if (!existing.success) {
        return output.fail(toFailure(existing));
      }
      config = existing.data;
      configAction = config.router === undefined ? 'updated' : 'kept';
    } else {
      const graph = options.graph ?? graphNameOf(workspace);
      const parsed = configSchema.safeParse({ graph });
      if (!parsed.success) {
        return output.fail({
          message: `"${graph}" is not a valid graph name.`,
          input: options.graph === undefined ? 'the directory name' : `--graph ${graph}`,
          remediation: 'Pass --graph with letters, digits, `-` and `_`, for example --graph shop.',
        });
      }
      config = parsed.data;
      configAction = 'created';
    }

    let router: RouterConfig;
    if (config.router === undefined) {
      let source = requested.data;
      if (source === undefined) {
        output.progress({ step: 'find-latest-release', message: 'Finding the latest router release' });
        const latest = await latestRouterRelease(system);
        if (!latest.success) {
          return output.fail(toFailure(latest));
        }
        source = { release: latest.data };

        if (context.prompts.canPrompt && options.json !== true) {
          const answer = await context.prompts.text('Router release to build:', latest.data);
          const selected = parseRouterCandidate(answer);
          if (!selected.success) {
            return output.fail(toFailure(selected));
          }
          source = selected.data;
        }
      }
      router = { source, modules: [], binary: defaultRouterBinary };
      await mkdir(workspace, { recursive: true });
      await writeConfig(workspace, { ...config, router });
    } else {
      router = config.router;
    }
    files.push({ path: configFileName, action: configAction });

    const previous = await readLock(workspace);
    if (!previous.success) {
      return output.fail(toFailure(previous));
    }

    let lock = previous.data;
    if (lock === undefined) {
      const resolved = await resolvePins({ router, previous: undefined, system, output });
      if (!resolved.success) {
        return output.fail(toFailure(resolved));
      }
      lock = resolved.data;
      await writeLock(workspace, lock);
      files.push({ path: lockFileName, action: 'created' });
    } else {
      files.push({ path: lockFileName, action: 'kept' });
    }

    files.push(
      {
        path: 'AGENTS.md',
        action: await writeGuidance(workspace, 'AGENTS.md', context.endpoints.wgcInstallArgs, context.command),
      },
      {
        path: 'CLAUDE.md',
        action: await writeGuidance(workspace, 'CLAUDE.md', context.endpoints.wgcInstallArgs, context.command),
      },
      { path: '.gitignore', action: await ignoreGeneratedFiles(workspace) },
    );

    output.result({ workspace, router: routerSummary(lock), files }, (data) =>
      [
        `Forge workspace ready in ${data.workspace}`,
        `  router ${data.router.source} (${data.router.version})`,
        ...data.files.map((file) => `  ${file.action.padEnd(7)} ${file.path}`),
        'Next: `wgc forge create --list-templates`, then `wgc forge build`.',
      ].join('\n'),
    );
  });
};
