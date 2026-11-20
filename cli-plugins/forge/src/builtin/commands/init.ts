import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { failWith, toFailure } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import type { Command } from 'commander';
import type { FileAction } from '../guidance.js';
import { ignoreGeneratedFiles, writeGuidance } from '../guidance.js';
import { lockFileName, readLock, writeLock } from '../lock.js';
import {
  defaultBinaryPath,
  manifestFileName,
  parseRouterCandidate,
  readManifest,
  routerSourceSchema,
  writeManifest,
} from '../manifest.js';
import type { Manifest, RouterSource } from '../manifest.js';
import { resolvePins } from '../pins.js';
import { latestRouterRelease } from '../resolve.js';
import { routerSummary, withCommonOptions, workspaceOf } from './shared.js';
import type { CommonOptions, ForgeDependencies } from './shared.js';

interface InitOptions extends CommonOptions {
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
        'Initialize a workspace in the current or named directory: select the router release, create forge.yaml and forge.lock, and add agent guidance. Safe to run again.',
      )
      .argument('[directory]', 'The workspace directory. Defaults to the current directory.')
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

    await mkdir(workspace, { recursive: true });

    let manifest: Manifest;
    if (await fileExists(path.join(workspace, manifestFileName))) {
      const existing = await readManifest(workspace);
      if (!existing.success) {
        return output.fail(toFailure(existing));
      }
      manifest = existing.data;
      files.push({ path: manifestFileName, action: 'kept' });
    } else {
      let router = requested.data;
      if (router === undefined) {
        output.progress({ step: 'find-latest-release', message: 'Finding the latest router release' });
        const latest = await latestRouterRelease(system);
        if (!latest.success) {
          return output.fail(toFailure(latest));
        }
        router = { release: latest.data };

        if (context.prompts.canPrompt && options.json !== true) {
          const answer = await context.prompts.text('Router release to build:', latest.data);
          const selected = parseRouterCandidate(answer);
          if (!selected.success) {
            return output.fail(toFailure(selected));
          }
          router = selected.data;
        }
      }
      manifest = { version: 1, router, binary: defaultBinaryPath, modules: [] };
      await writeManifest(workspace, manifest);
      files.push({ path: manifestFileName, action: 'created' });
    }

    const previous = await readLock(workspace);
    if (!previous.success) {
      return output.fail(toFailure(previous));
    }

    let lock = previous.data;
    if (lock === undefined) {
      const resolved = await resolvePins({ manifest, previous: undefined, system, output });
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
