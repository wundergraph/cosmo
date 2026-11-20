import { access, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import { buildRouter } from '../build.js';
import { toFailure } from '../failure.js';
import { readLock, writeLock } from '../lock.js';
import {
  describeRouterSource,
  manifestFileName,
  parseRouterCandidate,
  readManifest,
  writeManifest,
} from '../manifest.js';
import { resolvePins } from '../pins.js';
import type { System } from '../system.js';
import { workspacePaths } from '../workspace.js';
import { routerSummary, withCommonOptions, workspaceOf } from './shared.js';
import type { CommonOptions, ForgeDependencies } from './shared.js';

interface UpgradeOptions extends CommonOptions {
  config: string;
  check?: boolean;
  yes?: boolean;
  test?: string;
}

interface DependencyChange {
  module: string;
  from?: string;
  to?: string;
}

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

/** The modules compiled into a Go binary, as `go version -m` reports them. */
const binaryDependencies = async (system: System, binary: string): Promise<Map<string, string>> => {
  const dependencies = new Map<string, string>();
  if (!(await fileExists(binary))) {
    return dependencies;
  }

  const outcome = await system.run({ file: 'go', args: ['version', '-m', binary] });
  for (const line of outcome.stdout.split('\n')) {
    const [kind, module, version] = line.trim().split(/\s+/);
    if (kind === 'dep' && module && version) {
      dependencies.set(module, version);
    }
  }
  return dependencies;
};

const compareDependencies = (current: Map<string, string>, candidate: Map<string, string>): DependencyChange[] => {
  const changes: DependencyChange[] = [];
  for (const module of [...new Set([...current.keys(), ...candidate.keys()])].sort()) {
    const from = current.get(module);
    const to = candidate.get(module);
    if (from !== to) {
      changes.push({ module, ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) });
    }
  }
  return changes;
};

const describeChange = (change: DependencyChange): string => {
  if (change.from === undefined) {
    return `added at ${change.to}`;
  }
  if (change.to === undefined) {
    return `removed (was ${change.from})`;
  }
  return `${change.from} -> ${change.to}`;
};

export const registerRouterUpgrade = (command: Command, dependencies: ForgeDependencies): void => {
  const router = command.command('router').description('Manage the router version of the workspace.');

  withCommonOptions(
    router
      .command('upgrade')
      .description(
        'Build a candidate router with the workspace modules, run the tests against it, and adopt it when they pass.',
      )
      .argument('<candidate>', 'A router release (0.299.0), release candidate (0.300.0-rc.1) or commit SHA.')
      .requiredOption('--config <router.yaml>', 'The router config the tests run the candidate with.')
      .option('--check', 'Only build and test the candidate. Never changes forge.yaml, forge.lock or the binary.')
      .option('--yes', 'Adopt the candidate without asking when the tests pass.')
      .option('--test <command>', 'The test command. Defaults to `test` in forge.yaml.'),
  ).action(async (candidate: string, options: UpgradeOptions) => {
    const { system, context } = dependencies;
    const output = context.output({ json: options.json });
    const workspace = workspaceOf(dependencies, options);

    const manifest = await readManifest(workspace);
    if (!manifest.success) {
      return output.fail(toFailure(manifest));
    }
    const candidateSource = parseRouterCandidate(candidate);
    if (!candidateSource.success) {
      return output.fail(toFailure(candidateSource));
    }

    const testCommand = options.test ?? manifest.data.test;
    if (testCommand === undefined) {
      return output.fail({
        message: 'There is no test command to prove the candidate works with your modules.',
        input: '--test',
        fix: `Pass --test "<command>" or set \`test:\` in ${manifestFileName}. The command receives FORGE_ROUTER_BINARY and FORGE_ROUTER_CONFIG.`,
      });
    }

    const configPath = path.resolve(dependencies.cwd(), options.config);
    if (!(await fileExists(configPath))) {
      return output.fail({
        message: `Router config ${configPath} does not exist.`,
        input: `--config ${options.config}`,
        fix: 'Pass the path of the router config file the tests should start the router with.',
      });
    }

    const current = await readLock(workspace);
    if (!current.success) {
      return output.fail(toFailure(current));
    }
    const candidateManifest = { ...manifest.data, router: candidateSource.data };
    const candidateLock = await resolvePins({
      manifest: candidateManifest,
      previous: current.data,
      refresh: false,
      system,
      output,
    });
    if (!candidateLock.success) {
      return output.fail(toFailure(candidateLock));
    }

    const paths = workspacePaths(workspace, manifest.data);
    const built = await buildRouter({
      workspace,
      manifest: candidateManifest,
      lock: candidateLock.data,
      buildDirectory: paths.candidateBuildDirectory,
      binaryPath: paths.candidateBinary,
      system,
      output,
    });
    if (!built.success) {
      return output.fail(toFailure(built));
    }

    const dependencyChanges = compareDependencies(
      await binaryDependencies(system, paths.binary),
      await binaryDependencies(system, paths.candidateBinary),
    );
    for (const change of dependencyChanges) {
      output.progress({ step: 'compare-dependencies', subject: change.module, message: describeChange(change) });
    }

    const report = {
      candidate: routerSummary(candidateLock.data),
      ...(current.data === undefined ? {} : { current: routerSummary(current.data) }),
      dependencyChanges,
    };

    output.progress({ step: 'test', subject: testCommand, message: 'Running the tests against the candidate' });
    const tests = await system.runTest({
      command: testCommand,
      cwd: workspace,
      env: { FORGE_ROUTER_BINARY: paths.candidateBinary, FORGE_ROUTER_CONFIG: configPath },
    });
    if (tests.exitCode !== 0) {
      return output.fail({
        message: `The tests failed against router ${describeRouterSource(candidateSource.data)} (exit code ${tests.exitCode}). Nothing was changed.`,
        input: testCommand,
        fix: `Fix the modules for the new router or stay on the current one. The candidate binary is at ${paths.candidateBinary}.`,
        details: {
          ...report,
          tests: { command: testCommand, passed: false, exitCode: tests.exitCode },
          adopted: false,
          binary: paths.candidateBinary,
        },
      });
    }

    const passed = { ...report, tests: { command: testCommand, passed: true } };
    const renderReport = (headline: string): string =>
      [
        headline,
        `  ${dependencyChanges.length} dependency change(s)`,
        ...dependencyChanges.map((change) => `    ${change.module} ${describeChange(change)}`),
      ].join('\n');

    if (options.check) {
      return output.result({ ...passed, adopted: false, binary: paths.candidateBinary }, () =>
        renderReport(`Router ${passed.candidate.source} passes the tests. Nothing was changed (--check).`),
      );
    }

    if (!options.yes && !context.prompts.canPrompt) {
      return output.fail({
        message: `Router ${passed.candidate.source} passes the tests, but adopting it needs your confirmation.`,
        input: candidate,
        fix: 'Run the command again with --yes to adopt it.',
      });
    }
    const accepted =
      options.yes === true ||
      (await context.prompts.confirm(
        `${renderReport('Tests passed.')}\nAdopt router ${passed.candidate.source}?`,
        false,
      ));
    if (!accepted) {
      return output.result({ ...passed, adopted: false, binary: paths.candidateBinary }, () =>
        renderReport(`Router ${passed.candidate.source} passes the tests. Not adopted.`),
      );
    }

    output.progress({ step: 'adopt', subject: paths.binary, message: 'Replacing the binary and updating the pins' });
    await mkdir(path.dirname(paths.binary), { recursive: true });
    await rename(paths.candidateBinary, paths.binary);
    await writeLock(workspace, candidateLock.data);
    await writeManifest(workspace, candidateManifest);

    output.result({ ...passed, adopted: true, binary: paths.binary }, () =>
      renderReport(`Upgraded to router ${passed.candidate.source}. Binary: ${paths.binary}`),
    );
  });
};
