import { writeFile } from 'node:fs/promises';
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

const manifest = `version: 1
router:
  release: 0.299.0
binary: bin/router
test: go test ./e2e/...
modules: []
`;

const workingBinary = `router ${versionA}`;

const upgradeWorkspace = () =>
  createWorkspace({
    'forge.yaml': manifest,
    'forge.lock': lockForReleaseA,
    'bin/router': workingBinary,
    'router.yaml': "version: '1'\n",
  });

const expectNothingChanged = async (workspace: string) => {
  expect(await read(workspace, 'forge.yaml')).toBe(manifest);
  expect(await read(workspace, 'forge.lock')).toBe(lockForReleaseA);
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
      status: 'success',
      candidate: { source: 'release 0.300.0', version: versionB, commit: commitB },
      current: { source: 'release 0.299.0', version: versionA, commit: 'a'.repeat(40) },
      dependencyChanges: [
        { module: 'github.com/new/arrival', to: 'v0.1.0' },
        { module: 'github.com/old/gone', from: 'v1.0.0' },
        { module: routerModule, from: versionA, to: versionB },
        { module: 'go.uber.org/zap', from: 'v1.27.0', to: 'v1.28.0' },
      ],
      tests: { command: 'go test ./e2e/...', passed: true },
      adopted: false,
      binary: `${workspace}/.forge/candidate/router`,
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
      status: 'error',
      error: {
        message: 'The tests failed against router release 0.300.0 (exit code 2). Nothing was changed.',
        input: 'go test ./e2e/...',
        fix: `Fix the modules for the new router or stay on the current one. The candidate binary is at ${workspace}/.forge/candidate/router.`,
        details: {
          candidate: { source: 'release 0.300.0', version: versionB, commit: commitB },
          current: { source: 'release 0.299.0', version: versionA, commit: 'a'.repeat(40) },
          dependencyChanges: [{ module: routerModule, from: versionA, to: versionB }],
          tests: { command: 'go test ./e2e/...', passed: false, exitCode: 2 },
          adopted: false,
          binary: `${workspace}/.forge/candidate/router`,
        },
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

  test('--test overrides the command from forge.yaml', async () => {
    const workspace = await upgradeWorkspace();
    const system = createFakeSystem();

    await runForge(['router', 'upgrade', '--config', 'router.yaml', '--check', '--test', './smoke.sh', '0.300.0'], {
      workspace,
      system,
    });

    expect(system.tests.map((run) => run.command)).toEqual(['./smoke.sh']);
  });

  test('without any test command it refuses before building', async () => {
    const workspace = await upgradeWorkspace();
    const system = createFakeSystem();
    await writeFile(`${workspace}/forge.yaml`, manifest.replace('test: go test ./e2e/...\n', ''));

    const run = await runForge(['router', 'upgrade', '--config', 'router.yaml', '--check', '0.300.0'], {
      workspace,
      system,
    });

    expect(JSON.parse(run.stdout).error).toEqual({
      message: 'There is no test command to prove the candidate works with your modules.',
      input: '--test',
      fix: 'Pass --test "<command>" or set `test:` in forge.yaml. The command receives FORGE_ROUTER_BINARY and FORGE_ROUTER_CONFIG.',
    });
    expect(system.commands).toEqual([]);
  });

  test('a router config that does not exist is named', async () => {
    const workspace = await upgradeWorkspace();

    const run = await runForge(['router', 'upgrade', '--config', 'missing.yaml', '--check', '0.300.0'], { workspace });

    expect(JSON.parse(run.stdout).error).toEqual({
      message: `Router config ${workspace}/missing.yaml does not exist.`,
      input: '--config missing.yaml',
      fix: 'Pass the path of the router config file the tests should start the router with.',
    });
  });
});

describe('wgc forge router upgrade', () => {
  const upgradedLock = lockForReleaseA
    .replace('release: 0.299.0', 'release: 0.300.0')
    .replace('a'.repeat(40), commitB)
    .replace(versionA, versionB);

  test('--yes adopts a candidate that passes: binary, forge.lock and forge.yaml move together', async () => {
    const workspace = await upgradeWorkspace();

    const run = await runForge(['router', 'upgrade', '--config', 'router.yaml', '--yes', '0.300.0'], { workspace });

    expect(JSON.parse(run.stdout)).toMatchObject({
      status: 'success',
      adopted: true,
      binary: `${workspace}/bin/router`,
    });
    expect(await read(workspace, 'bin/router')).toBe(`router ${versionB}`);
    expect(await read(workspace, 'forge.lock')).toBe(upgradedLock);
    expect(await read(workspace, 'forge.yaml')).toBe(manifest.replace('release: 0.299.0', 'release: 0.300.0'));
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

    expect(run.exitCode).toBe(1);
    expect(JSON.parse(run.stdout).error).toEqual({
      message: 'Router release 0.300.0 passes the tests, but adopting it needs your confirmation.',
      input: '0.300.0',
      fix: 'Run the command again with --yes to adopt it.',
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
      `Upgraded to router release 0.300.0. Binary: ${workspace}/bin/router\n  1 dependency change(s)\n    ${routerModule} ${versionA} -> ${versionB}\n`,
    );
    expect(await read(workspace, 'forge.lock')).toBe(upgradedLock);
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
