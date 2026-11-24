import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Prompts } from '@wundergraph/wgc-plugin-sdk';
import {
  commitB,
  createFakeSystem,
  createWorkspace,
  lockForReleaseA,
  read,
  routerModule,
  runForge,
  versionA,
  versionB,
} from './harness.js';

const config = `graph: shop
subgraphs:
  - name: products
    schema:
      file: products.graphql
    routing_url: http://localhost:4001/graphql
router:
  release: 0.299.0
  binary: bin/router
  test: go test ./e2e/...
check:
  rules:
    pagination.forward-connection: error
mocks:
  Product:
    name: Desk
`;

const workingBinary = `router ${versionA}`;

const upgradeWorkspace = () =>
  createWorkspace({
    'wundergraph.yaml': config,
    'wundergraph.lock': lockForReleaseA,
    'bin/router': workingBinary,
    'router.yaml': "version: '1'\n",
  });

const expectNothingChanged = async (workspace: string) => {
  expect(await read(workspace, 'wundergraph.yaml')).toBe(config);
  expect(await read(workspace, 'wundergraph.lock')).toBe(lockForReleaseA);
  expect(await read(workspace, 'bin/router')).toBe(workingBinary);
};

const answering = (answer: boolean): Prompts => ({
  canPrompt: true,
  confirm: () => Promise.resolve(answer),
  text: () => Promise.resolve(''),
});

describe('wgc forge router upgrade --check', () => {
  test('builds the candidate apart from the working binary and runs the tests against it', async () => {
    const workspace = await upgradeWorkspace();
    const system = createFakeSystem();

    await runForge(['router', 'upgrade', '--config', 'router.yaml', '--check', '0.300.0'], { workspace, system });

    expect(system.tests).toEqual([
      {
        command: 'go test ./e2e/...',
        cwd: workspace,
        env: {
          FORGE_ROUTER_BINARY: `${workspace}/.forge/candidate/router`,
          FORGE_ROUTER_CONFIG: `${workspace}/router.yaml`,
        },
        binaryAtTestTime: `router ${versionB}`,
      },
    ]);
  });

  test('when the tests pass it reports the dependency changes and changes nothing', async () => {
    const workspace = await upgradeWorkspace();
    const system = createFakeSystem({
      extraDependencies: {
        [versionA]: ['\tdep\tgo.uber.org/zap\tv1.27.0\th1:a=', '\tdep\tgithub.com/old/gone\tv1.0.0\th1:b='],
        [versionB]: ['\tdep\tgo.uber.org/zap\tv1.28.0\th1:c=', '\tdep\tgithub.com/new/arrival\tv0.1.0\th1:d='],
      },
    });

    const run = await runForge(['router', 'upgrade', '--config', 'router.yaml', '--check', '0.300.0'], {
      workspace,
      system,
    });

    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      ok: true,
      data: {
        candidate: { source: 'release 0.300.0', version: versionB, commit: commitB },
        current: { source: 'release 0.299.0', version: versionA, commit: 'a'.repeat(40) },
        dependencyChanges: [
          { module: 'github.com/new/arrival', to: 'v0.1.0' },
          { module: 'github.com/old/gone', from: 'v1.0.0' },
          { module: routerModule, from: versionA, to: versionB },
          { module: 'go.uber.org/zap', from: 'v1.27.0', to: 'v1.28.0' },
        ],
        modules: [],
        tests: { command: 'go test ./e2e/...', passed: true },
        adopted: false,
        binary: `${workspace}/.forge/candidate/router`,
      },
    });
    await expectNothingChanged(workspace);
  });

  test('when the tests fail it exits non-zero, says so, and changes nothing', async () => {
    const workspace = await upgradeWorkspace();
    const system = createFakeSystem({ testExitCode: 2 });

    const run = await runForge(['router', 'upgrade', '--config', 'router.yaml', '--check', '0.300.0'], {
      workspace,
      system,
    });

    expect(run.exitCode).toBe(1);
    expect(JSON.parse(run.stdout)).toEqual({
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message:
          'Router release 0.300.0 cannot be adopted: the test command `go test ./e2e/...` exited with code 2. Nothing was changed.',
        input: '0.300.0',
        remediation: `Fix the modules for the new router or stay on the current one. The candidate binary is at ${workspace}/.forge/candidate/router.`,
      },
      data: {
        candidate: { source: 'release 0.300.0', version: versionB, commit: commitB },
        current: { source: 'release 0.299.0', version: versionA, commit: 'a'.repeat(40) },
        dependencyChanges: [{ module: routerModule, from: versionA, to: versionB }],
        modules: [],
        tests: { command: 'go test ./e2e/...', passed: false, exitCode: 2 },
        adopted: false,
        binary: `${workspace}/.forge/candidate/router`,
      },
    });
    expect(run.progress).toContainEqual({
      step: 'compare-dependencies',
      subject: routerModule,
      message: `${versionA} -> ${versionB}`,
    });
    await expectNothingChanged(workspace);
  });

  test('a candidate that does not compile with the modules never reaches the tests', async () => {
    const workspace = await upgradeWorkspace();
    const system = createFakeSystem({ compileError: 'undefined: core.RemovedHook' });

    const run = await runForge(['router', 'upgrade', '--config', 'router.yaml', '--check', '0.300.0'], {
      workspace,
      system,
    });

    expect(JSON.parse(run.stdout).error.message).toBe('The router did not compile:\nundefined: core.RemovedHook');
    expect(system.tests).toEqual([]);
    await expectNothingChanged(workspace);
  });

  test('--test overrides router.test in wundergraph.yaml', async () => {
    const workspace = await upgradeWorkspace();
    const system = createFakeSystem();

    await runForge(['router', 'upgrade', '--config', 'router.yaml', '--check', '--test', './smoke.sh', '0.300.0'], {
      workspace,
      system,
    });

    expect(system.tests.map((run) => run.command)).toEqual(['./smoke.sh']);
  });

  test('a router config that does not exist is named', async () => {
    const workspace = await upgradeWorkspace();

    const run = await runForge(['router', 'upgrade', '--config', 'missing.yaml', '--check', '0.300.0'], { workspace });

    expect(JSON.parse(run.stdout).error).toEqual({
      code: 'COMMAND_FAILED',
      message: `Router config ${workspace}/missing.yaml does not exist.`,
      input: '--config missing.yaml',
      remediation: 'Pass the path of the router config file the tests should start the router with.',
    });
  });
});

describe('wgc forge router upgrade', () => {
  const upgradedLock = lockForReleaseA
    .replace('release: 0.299.0', 'release: 0.300.0')
    .replace('a'.repeat(40), commitB)
    .replace(versionA, versionB);

  test('--yes adopts a candidate that passes: binary, wundergraph.lock and router.release move together', async () => {
    const workspace = await createWorkspace({
      'wundergraph.yaml': config,
      'wundergraph.lock': lockForReleaseA,
      'bin/router': workingBinary,
    });
    const routerConfigDirectory = await createWorkspace({ 'router.yaml': "version: '1'\n" });
    const routerConfig = `${routerConfigDirectory}/router.yaml`;

    const run = await runForge(['router', 'upgrade', '--config', routerConfig, '--yes', '0.300.0'], { workspace });

    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout).data).toEqual({
      candidate: { source: 'release 0.300.0', version: versionB, commit: commitB },
      current: { source: 'release 0.299.0', version: versionA, commit: 'a'.repeat(40) },
      dependencyChanges: [{ module: routerModule, from: versionA, to: versionB }],
      modules: [],
      tests: { command: 'go test ./e2e/...', passed: true },
      adopted: true,
      binary: `${workspace}/bin/router`,
    });
    expect(await read(workspace, 'bin/router')).toBe(`router ${versionB}`);
    expect(await read(workspace, 'wundergraph.lock')).toBe(upgradedLock);
    expect(await read(workspace, 'wundergraph.yaml')).toBe(`graph: shop
subgraphs:
  - name: products
    schema:
      file: products.graphql
    routing_url: http://localhost:4001/graphql
router:
  release: 0.300.0
  binary: bin/router
  test: go test ./e2e/...
check:
  rules:
    pagination.forward-connection: error
mocks:
  Product:
    name: Desk
`);
    const workspaceFiles = await readdir(workspace, { recursive: true });
    expect(workspaceFiles.filter((file) => path.basename(file) === 'router.yaml')).toEqual([]);
    expect(await readdir(routerConfigDirectory)).toEqual(['router.yaml']);
  });

  test('--yes does not adopt a candidate whose tests fail', async () => {
    const workspace = await upgradeWorkspace();

    const run = await runForge(['router', 'upgrade', '--config', 'router.yaml', '--yes', '0.300.0'], {
      workspace,
      system: createFakeSystem({ testExitCode: 1 }),
    });

    expect(run.exitCode).toBe(1);
    await expectNothingChanged(workspace);
  });

  test('a caller that cannot be asked must pass --yes', async () => {
    const workspace = await upgradeWorkspace();

    const run = await runForge(['router', 'upgrade', '--config', 'router.yaml', '0.300.0'], { workspace });

    expect(run.exitCode).toBe(5);
    expect(JSON.parse(run.stdout).error).toEqual({
      code: 'CONFIRMATION_REQUIRED',
      message: 'Router release 0.300.0 passes the tests, but adopting it needs your confirmation.',
      input: '0.300.0',
      remediation: 'Run the command again with --yes to adopt it.',
    });
    await expectNothingChanged(workspace);
  });

  test('a person who confirms adopts the candidate', async () => {
    const workspace = await upgradeWorkspace();

    const run = await runForge(['router', 'upgrade', '--config', 'router.yaml', '0.300.0'], {
      workspace,
      caller: 'human',
      prompts: answering(true),
    });

    expect(run.stdout).toBe(
      `Upgraded to router release 0.300.0. Binary: ${workspace}/bin/router\n  1 dependency change(s)\n    ${routerModule} ${versionA} -> ${versionB}\n  0 module(s)\n`,
    );
    expect(await read(workspace, 'wundergraph.lock')).toBe(upgradedLock);
  });

  test('a person who declines keeps everything as it was', async () => {
    const workspace = await upgradeWorkspace();

    const run = await runForge(['router', 'upgrade', '--config', 'router.yaml', '0.300.0'], {
      workspace,
      caller: 'human',
      prompts: answering(false),
    });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Router release 0.300.0 passes the tests. Not adopted.');
    await expectNothingChanged(workspace);
  });
});

describe("wgc forge router upgrade runs every module's Go behaviour tests", () => {
  const metrics = 'github.com/acme/router-metrics';

  const configWithModules = `graph: shop
router:
  release: 0.299.0
  binary: bin/router
  modules:
    - path: ./modules/request-id
    - go: ${metrics}
`;

  const lockWithModules = lockForReleaseA.replace(
    'modules: []\n',
    `modules:
  - source:
      go: ${metrics}
    module: ${metrics}
    package: ${metrics}
    version: v1.2.0
`,
  );

  const moduleWorkspace = (files: Record<string, string> = {}) =>
    createWorkspace({
      'wundergraph.yaml': configWithModules,
      'wundergraph.lock': lockWithModules,
      'bin/router': workingBinary,
      'router.yaml': "version: '1'\n",
      'modules/request-id/go.mod': 'module forge.local/request-id\n\ngo 1.26.0\n',
      ...files,
    });

  const expectNothingChanged = async (workspace: string) => {
    expect(await read(workspace, 'wundergraph.yaml')).toBe(configWithModules);
    expect(await read(workspace, 'wundergraph.lock')).toBe(lockWithModules);
    expect(await read(workspace, 'bin/router')).toBe(workingBinary);
  };

  const check = ['router', 'upgrade', '--config', 'router.yaml', '--check', '0.300.0'];

  test('each module is tested in the candidate build with the candidate binary and the router config', async () => {
    const workspace = await moduleWorkspace();
    const system = createFakeSystem({ packagesWithTests: ['forge.local/request-id', `${metrics}/internal/export`] });

    const run = await runForge(check, { workspace, system });

    const env = {
      FORGE_ROUTER_BINARY: `${workspace}/.forge/candidate/router`,
      FORGE_ROUTER_CONFIG: `${workspace}/router.yaml`,
      GOWORK: 'off',
    };
    expect(system.goTests).toEqual([
      { packages: ['forge.local/request-id'], cwd: `${workspace}/.forge/candidate/build`, env },
      { packages: [`${metrics}/internal/export`], cwd: `${workspace}/.forge/candidate/build`, env },
    ]);
    expect(system.tests).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      ok: true,
      data: {
        candidate: { source: 'release 0.300.0', version: versionB, commit: commitB },
        current: { source: 'release 0.299.0', version: versionA, commit: 'a'.repeat(40) },
        dependencyChanges: [{ module: routerModule, from: versionA, to: versionB }],
        modules: [
          { module: 'forge.local/request-id', outcome: 'passed' },
          { module: metrics, outcome: 'passed' },
        ],
        adopted: false,
        binary: `${workspace}/.forge/candidate/router`,
      },
    });
    await expectNothingChanged(workspace);
  });

  test('a remote module without a behaviour test is named as untested and blocks adoption', async () => {
    const workspace = await moduleWorkspace();
    const system = createFakeSystem({ packagesWithTests: ['forge.local/request-id'] });

    const run = await runForge(['router', 'upgrade', '--config', 'router.yaml', '--yes', '0.300.0'], {
      workspace,
      system,
    });

    expect(run.exitCode).toBe(1);
    expect(JSON.parse(run.stdout)).toEqual({
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: `Router release 0.300.0 cannot be adopted: ${metrics} has no behaviour test. Nothing was changed.`,
        input: '0.300.0',
        remediation: `Add Go tests to each untested module, or a Go test package under tests/<module>, that start the router at FORGE_ROUTER_BINARY with --config FORGE_ROUTER_CONFIG and check the behaviour you rely on. The candidate binary is at ${workspace}/.forge/candidate/router.`,
      },
      data: {
        candidate: { source: 'release 0.300.0', version: versionB, commit: commitB },
        current: { source: 'release 0.299.0', version: versionA, commit: 'a'.repeat(40) },
        dependencyChanges: [{ module: routerModule, from: versionA, to: versionB }],
        modules: [
          { module: 'forge.local/request-id', outcome: 'passed' },
          { module: metrics, outcome: 'untested' },
        ],
        adopted: false,
        binary: `${workspace}/.forge/candidate/router`,
      },
    });
    await expectNothingChanged(workspace);
  });

  test('a module the candidate breaks is named with its test output, and the others are still reported', async () => {
    const workspace = await moduleWorkspace();
    const system = createFakeSystem({
      packagesWithTests: ['forge.local/request-id', metrics],
      failingGoTests: { 'forge.local/request-id': '--- FAIL: TestGeneratesOneRequestID\nFAIL\tforge.local/request-id' },
    });

    const run = await runForge(check, { workspace, system });

    expect(run.exitCode).toBe(1);
    const { error, data } = JSON.parse(run.stdout);
    expect(error.message).toBe(
      'Router release 0.300.0 cannot be adopted: forge.local/request-id failed its behaviour tests. Nothing was changed.',
    );
    expect(data.modules).toEqual([
      {
        module: 'forge.local/request-id',
        outcome: 'failed',
        output: '--- FAIL: TestGeneratesOneRequestID\nFAIL\tforge.local/request-id',
      },
      { module: metrics, outcome: 'passed' },
    ]);
    await expectNothingChanged(workspace);
  });

  test('a test package the workspace keeps under tests/<module> covers a remote module', async () => {
    const workspace = await moduleWorkspace({
      [`tests/${metrics}/behaviour_test.go`]: 'package behaviour\n',
    });
    const system = createFakeSystem({ packagesWithTests: ['forge.local/request-id'] });

    const run = await runForge(check, { workspace, system });

    expect(system.goTests.at(-1)).toEqual({
      packages: ['./...'],
      cwd: `${workspace}/tests/${metrics}`,
      env: {
        FORGE_ROUTER_BINARY: `${workspace}/.forge/candidate/router`,
        FORGE_ROUTER_CONFIG: `${workspace}/router.yaml`,
      },
    });
    expect(JSON.parse(run.stdout).data.modules).toEqual([
      { module: 'forge.local/request-id', outcome: 'passed' },
      { module: metrics, outcome: 'passed' },
    ]);
  });

  test('a person reads the same per-module outcomes', async () => {
    const workspace = await moduleWorkspace();
    const system = createFakeSystem({ packagesWithTests: ['forge.local/request-id', metrics] });

    const run = await runForge(check, { workspace, system, caller: 'human' });

    expect(run.stdout).toBe(
      [
        'Router release 0.300.0 passes the tests. Nothing was changed (--check).',
        '  1 dependency change(s)',
        `    ${routerModule} ${versionA} -> ${versionB}`,
        '  2 module(s)',
        '    passed   forge.local/request-id',
        `    passed   ${metrics}`,
        '',
      ].join('\n'),
    );
  });
});
