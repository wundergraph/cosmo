import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Output, Result } from '@wundergraph/wgc-plugin-sdk';
import type { Lock, RouterConfig } from '@wundergraph/wgc-plugin-sdk/config';
import { readLocalModuleName } from './build.js';
import { lastLines } from './failure.js';
import { isLocalModule } from './sources.js';
import type { CommandOutcome, System } from './system.js';

/** Behaviour tests a team keeps in the workspace for a module live in `tests/<Go package path>`. */
export const workspaceTestsDirectory = 'tests';

export type ModuleOutcome =
  | { module: string; outcome: 'passed' }
  | { module: string; outcome: 'failed'; output: string }
  | { module: string; outcome: 'untested' };

export interface ModuleTestRequest {
  workspace: string;
  router: RouterConfig;
  lock: Lock;
  /** The generated build module of the router under test, which selects the router version the tests compile against. */
  buildDirectory: string;
  /** Tells the tests which router binary and router config to start. */
  env: Record<string, string>;
  system: System;
  output: Output;
}

/** The Go package each registered module is imported as, local modules first in wundergraph.yaml order. */
const registeredPackages = async ({ workspace, router, lock }: ModuleTestRequest): Promise<Result<string[]>> => {
  const packages: string[] = [];

  for (const source of router.modules) {
    if (!isLocalModule(source)) {
      continue;
    }

    const name = await readLocalModuleName(workspace, source.path);
    if (!name.success) {
      return name;
    }
    packages.push(name.data);
  }

  for (const module of lock.modules) {
    packages.push(module.package);
  }

  return { success: true, data: packages };
};

const hasGoTests = async (directory: string): Promise<boolean> => {
  let entries: string[];
  try {
    entries = await readdir(directory, { recursive: true });
  } catch {
    return false;
  }

  return entries.some((entry) => entry.endsWith('_test.go'));
};

const testOutput = (outcome: CommandOutcome): string => lastLines(`${outcome.stdout}\n${outcome.stderr}`, 40);

const testModule = async (request: ModuleTestRequest, modulePackage: string): Promise<ModuleOutcome> => {
  const { workspace, buildDirectory, env, system } = request;
  const goEnv = { ...env, GOWORK: 'off' };

  const listed = await system.run({
    file: 'go',
    args: ['list', '-f', '{{if or .TestGoFiles .XTestGoFiles}}{{.ImportPath}}{{end}}', `${modulePackage}/...`],
    cwd: buildDirectory,
    env: goEnv,
  });
  if (listed.exitCode !== 0) {
    return { module: modulePackage, outcome: 'failed', output: testOutput(listed) };
  }

  const ownPackages = listed.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const workspaceTests = path.join(workspace, workspaceTestsDirectory, ...modulePackage.split('/'));
  const hasWorkspaceTests = await hasGoTests(workspaceTests);

  if (ownPackages.length === 0 && !hasWorkspaceTests) {
    return { module: modulePackage, outcome: 'untested' };
  }

  if (ownPackages.length > 0) {
    // -count=1 because Go's test cache does not notice that the router binary changed.
    const own = await system.run({
      file: 'go',
      args: ['test', '-count=1', ...ownPackages],
      cwd: buildDirectory,
      env: goEnv,
    });
    if (own.exitCode !== 0) {
      return { module: modulePackage, outcome: 'failed', output: testOutput(own) };
    }
  }

  if (hasWorkspaceTests) {
    const shared = await system.run({ file: 'go', args: ['test', '-count=1', './...'], cwd: workspaceTests, env });
    if (shared.exitCode !== 0) {
      return { module: modulePackage, outcome: 'failed', output: testOutput(shared) };
    }
  }

  return { module: modulePackage, outcome: 'passed' };
};

/**
 * Runs the Go behaviour tests of every registered module against one router build: the tests that ship with
 * the module, compiled against that router, and the ones the workspace keeps for it under `tests/`.
 */
export const runModuleTests = async (request: ModuleTestRequest): Promise<Result<ModuleOutcome[]>> => {
  const packages = await registeredPackages(request);
  if (!packages.success) {
    return packages;
  }

  const outcomes: ModuleOutcome[] = [];
  for (const modulePackage of packages.data) {
    request.output.progress({ step: 'test-module', subject: modulePackage, message: 'Running its behaviour tests' });
    const outcome = await testModule(request, modulePackage);
    request.output.progress({ step: 'test-module', subject: modulePackage, message: outcome.outcome });
    outcomes.push(outcome);
  }

  return { success: true, data: outcomes };
};
