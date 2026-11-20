import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import type { Command } from 'commander';
import { fail, toFailure } from '../failure.js';
import type { FileAction } from '../guidance.js';
import { ignoreGeneratedFiles, writeGuidance } from '../guidance.js';
import { lockFileName, readLock, renderLock, writeLock } from '../lock.js';
import { defaultBinaryPath, manifestFileName, readManifest, routerSourceSchema, writeManifest } from '../manifest.js';
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
    return fail({
      message: 'Pass only one of --release, --rc and --commit.',
      input: '--release, --rc, --commit',
      fix: 'A workspace builds one router version. Keep the flag for the version you want.',
    });
  }

  const parsed = routerSourceSchema.safeParse(requested[0]);
  if (!parsed.success) {
    const [flag, value] = Object.entries(requested[0])[0];
    return fail({
      message: `--${flag} ${value} ${parsed.error.issues[0].message}.`,
      input: `--${flag} ${value}`,
      fix: 'Pass a release such as 0.299.0, a release candidate such as 0.300.0-rc.1, or a commit SHA.',
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
      .description('Create a Forge workspace: forge.yaml, forge.lock and agent guidance. Safe to run again.')
      .option('--release <version>', 'The router release to build, e.g. 0.299.0. Defaults to the latest release.')
      .option('--rc <version>', 'A router release candidate to build, e.g. 0.300.0-rc.1.')
      .option('--commit <sha>', 'A router commit to build.'),
  ).action(async (options: InitOptions) => {
    const { system, context } = dependencies;
    const output = context.output({ json: options.json });
    const workspace = workspaceOf(dependencies, options);
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
      }
      manifest = { version: 1, router, binary: defaultBinaryPath, modules: [] };
      await writeManifest(workspace, manifest);
      files.push({ path: manifestFileName, action: 'created' });
    }

    const previous = await readLock(workspace);
    if (!previous.success) {
      return output.fail(toFailure(previous));
    }
    const lock = await resolvePins({ manifest, previous: previous.data, refresh: false, system, output });
    if (!lock.success) {
      return output.fail(toFailure(lock));
    }
    if (previous.data === undefined) {
      await writeLock(workspace, lock.data);
      files.push({ path: lockFileName, action: 'created' });
    } else if (renderLock(previous.data) === renderLock(lock.data)) {
      files.push({ path: lockFileName, action: 'kept' });
    } else {
      await writeLock(workspace, lock.data);
      files.push({ path: lockFileName, action: 'updated' });
    }

    files.push(
      { path: 'AGENTS.md', action: await writeGuidance(workspace, 'AGENTS.md') },
      { path: 'CLAUDE.md', action: await writeGuidance(workspace, 'CLAUDE.md') },
      { path: '.gitignore', action: await ignoreGeneratedFiles(workspace) },
    );

    output.result({ workspace, router: routerSummary(lock.data), files }, (data) =>
      [
        `Forge workspace ready in ${data.workspace}`,
        `  router ${data.router.source} (${data.router.version})`,
        ...data.files.map((file) => `  ${file.action.padEnd(7)} ${file.path}`),
        'Next: `wgc forge create --list-templates`, then `wgc forge build`.',
      ].join('\n'),
    );
  });
};
