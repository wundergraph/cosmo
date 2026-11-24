import { access, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { toFailure } from '@wundergraph/wgc-plugin-sdk';
import type { Command } from 'commander';
import { configFileName, lockFileName } from '@wundergraph/wgc-plugin-sdk/config';
import { runModuleTests, workspaceTestsDirectory } from '../behaviour-tests.js';
import type { ModuleOutcome } from '../behaviour-tests.js';
import { buildRouter } from '../build.js';
import { lockMatches, resolvePins } from '../pins.js';
import { describeRouterSource, parseRouterCandidate } from '../sources.js';
import type { System } from '../system.js';
import { readLock, readRouterWorkspace, workspacePaths, writeLock, writeConfig } from '../workspace.js';
import { askToAccept, routerSummary, withCommonOptions, workspaceOf } from './shared.js';
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

type CommandReport = { command: string; passed: true } | { command: string; passed: false; exitCode: number };

const namesWith = (modules: ModuleOutcome[], outcome: ModuleOutcome['outcome']): string[] =>
  modules.filter((module) => module.outcome === outcome).map((module) => module.module);

/** Why a candidate is not eligible, one clause per kind of problem. Empty when every check passed. */
const describeProblems = (modules: ModuleOutcome[], command: CommandReport | undefined): string[] => {
  const problems: string[] = [];

  const failed = namesWith(modules, 'failed');
  if (failed.length > 0) {
    problems.push(`${failed.join(', ')} failed ${failed.length === 1 ? 'its' : 'their'} behaviour tests`);
  }

  const untested = namesWith(modules, 'untested');
  if (untested.length > 0) {
    problems.push(`${untested.join(', ')} ${untested.length === 1 ? 'has' : 'have'} no behaviour test`);
  }

  if (command !== undefined && !command.passed) {
    problems.push(`the test command \`${command.command}\` exited with code ${command.exitCode}`);
  }

  return problems;
};

const describeFix = (modules: ModuleOutcome[]): string => {
  if (namesWith(modules, 'untested').length === 0) {
    return 'Fix the modules for the new router or stay on the current one.';
  }

  return `Add Go tests to each untested module, or a Go test package under ${workspaceTestsDirectory}/<module>, that start the router at FORGE_ROUTER_BINARY with --config FORGE_ROUTER_CONFIG and check the behaviour you rely on.`;
};

export const registerRouterUpgrade = (command: Command, dependencies: ForgeDependencies): void => {
  const router = command.command('router').description('Manage the router version of the workspace.');

  withCommonOptions(
    router
      .command('upgrade')
      .description(
        "Build a candidate router with the workspace modules, run every module's Go behaviour tests against it, and adopt it when they pass.",
      )
      .argument('<candidate>', 'A router release (0.299.0), release candidate (0.300.0-rc.1) or commit SHA.')
      .requiredOption('--config <router.yaml>', 'The router config the tests run the candidate with.')
      .option(
        '--check',
        `Only build and test the candidate. Never changes ${configFileName}, ${lockFileName} or the binary.`,
      )
      .option('--yes', 'Adopt the candidate without asking when the tests pass.')
      .option(
        '--test <command>',
        `A test command to run as well as the module tests. Defaults to \`router.test\` in ${configFileName}.`,
      ),
  ).action(async (candidate: string, options: UpgradeOptions) => {
    const { system, context } = dependencies;
    const output = context.output({ json: options.json });
    const workspace = workspaceOf(dependencies, options);

    const read = await readRouterWorkspace(workspace);
    if (!read.success) {
      return output.fail(toFailure(read));
    }
    const { config, router } = read.data;
    const candidateSource = parseRouterCandidate(candidate);
    if (!candidateSource.success) {
      return output.fail(toFailure(candidateSource));
    }

    const testCommand = options.test ?? router.test;

    const configPath = path.resolve(dependencies.cwd(), options.config);
    if (!(await fileExists(configPath))) {
      return output.fail({
        message: `Router config ${configPath} does not exist.`,
        input: `--config ${options.config}`,
        remediation: 'Pass the path of the router config file the tests should start the router with.',
      });
    }

    const current = await readLock(workspace);
    if (!current.success) {
      return output.fail(toFailure(current));
    }
    if (!lockMatches(router, current.data)) {
      return output.fail({
        message: `${lockFileName} does not pin what ${configFileName} asks for.`,
        input: lockFileName,
        remediation: 'Run `wgc forge lock` to review and pin the module changes before evaluating a router.',
      });
    }
    const candidateRouter = { ...router, source: candidateSource.data };
    const candidateLock = await resolvePins({
      router: candidateRouter,
      previous: current.data,
      system,
      output,
    });
    if (!candidateLock.success) {
      return output.fail(toFailure(candidateLock));
    }

    const paths = workspacePaths(workspace, router);
    const built = await buildRouter({
      workspace,
      router: candidateRouter,
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

    const environment = { FORGE_ROUTER_BINARY: paths.candidateBinary, FORGE_ROUTER_CONFIG: configPath };
    const modules = await runModuleTests({
      workspace,
      router: candidateRouter,
      lock: candidateLock.data,
      buildDirectory: paths.candidateBuildDirectory,
      env: environment,
      system,
      output,
    });
    if (!modules.success) {
      return output.fail(toFailure(modules));
    }

    let command: CommandReport | undefined;
    if (testCommand !== undefined) {
      output.progress({
        step: 'test',
        subject: testCommand,
        message: 'Running the test command against the candidate',
      });
      const tests = await system.runTest({ command: testCommand, cwd: workspace, env: environment });
      command =
        tests.exitCode === 0
          ? { command: testCommand, passed: true }
          : { command: testCommand, passed: false, exitCode: tests.exitCode };
    }

    const report = {
      candidate: routerSummary(candidateLock.data),
      ...(current.data === undefined ? {} : { current: routerSummary(current.data) }),
      dependencyChanges,
      modules: modules.data,
      ...(command === undefined ? {} : { tests: command }),
    };
    const renderReport = (headline: string): string =>
      [
        headline,
        `  ${dependencyChanges.length} dependency change(s)`,
        ...dependencyChanges.map((change) => `    ${change.module} ${describeChange(change)}`),
        `  ${modules.data.length} module(s)`,
        ...modules.data.map((module) => `    ${module.outcome.padEnd(8)} ${module.module}`),
      ].join('\n');

    const problems = describeProblems(modules.data, command);
    if (problems.length > 0) {
      return output.fail({
        message: `Router ${describeRouterSource(candidateSource.data)} cannot be adopted: ${problems.join('; ')}. Nothing was changed.`,
        input: candidate,
        remediation: `${describeFix(modules.data)} The candidate binary is at ${paths.candidateBinary}.`,
        data: { ...report, adopted: false, binary: paths.candidateBinary },
      });
    }

    if (options.check) {
      return output.result({ ...report, adopted: false, binary: paths.candidateBinary }, () =>
        renderReport(`Router ${report.candidate.source} passes the tests. Nothing was changed (--check).`),
      );
    }

    const acceptance = await askToAccept(
      context,
      options,
      `${renderReport('Tests passed.')}\nAdopt router ${report.candidate.source}?`,
    );
    if (acceptance === 'needs-yes') {
      return output.fail({
        kind: 'confirmation',
        message: `Router ${report.candidate.source} passes the tests, but adopting it needs your confirmation.`,
        input: candidate,
        remediation: 'Run the command again with --yes to adopt it.',
      });
    }
    if (acceptance === 'declined') {
      return output.result({ ...report, adopted: false, binary: paths.candidateBinary }, () =>
        renderReport(`Router ${report.candidate.source} passes the tests. Not adopted.`),
      );
    }

    output.progress({ step: 'adopt', subject: paths.binary, message: 'Replacing the binary and updating the pins' });
    await mkdir(path.dirname(paths.binary), { recursive: true });
    await rename(paths.candidateBinary, paths.binary);
    await writeLock(workspace, candidateLock.data);
    await writeConfig(workspace, { ...config, router: candidateRouter });

    output.result({ ...report, adopted: true, binary: paths.binary }, () =>
      renderReport(`Upgraded to router ${report.candidate.source}. Binary: ${paths.binary}`),
    );
  });
};
