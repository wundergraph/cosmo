import { describe, expect, test } from 'vitest';
import {
  commitA,
  commitB,
  createFakeSystem,
  createWorkspace,
  lockForReleaseA,
  read,
  routerModule,
  runForge,
  versionA,
} from './harness.js';

const manifest = `version: 1
router:
  release: 0.299.0
binary: .forge/bin/router
modules: []
`;

describe('wgc forge init', () => {
  test('pins the latest router release and writes the workspace files', async () => {
    const workspace = await createWorkspace();

    const run = await runForge(['init'], {
      workspace,
      system: createFakeSystem({ routerTags: { '0.298.0': commitB, '0.299.0': commitA } }),
    });

    expect(JSON.parse(run.stdout)).toEqual({
      status: 'success',
      workspace,
      router: { source: 'release 0.299.0', version: versionA, commit: commitA },
      files: [
        { path: 'forge.yaml', action: 'created' },
        { path: 'forge.lock', action: 'created' },
        { path: 'AGENTS.md', action: 'created' },
        { path: 'CLAUDE.md', action: 'created' },
        { path: '.gitignore', action: 'created' },
      ],
    });
    expect(await read(workspace, 'forge.yaml')).toBe(manifest);
    expect(await read(workspace, 'forge.lock')).toBe(lockForReleaseA);
    expect(await read(workspace, '.gitignore')).toBe('.forge/\n');
    expect(await read(workspace, 'AGENTS.md')).toContain('`wgc forge build` compiles the router');
  });

  test('--rc pins a release candidate', async () => {
    const workspace = await createWorkspace();

    await runForge(['init', '--rc', '0.300.0-rc.1'], {
      workspace,
      system: createFakeSystem({ routerTags: { '0.300.0-rc.1': commitB } }),
    });

    expect(await read(workspace, 'forge.yaml')).toBe(manifest.replace('release: 0.299.0', 'rc: 0.300.0-rc.1'));
  });

  test('running it again keeps the selected release, the manifest and the notes people wrote', async () => {
    const edited = `${manifest.replace('modules: []', 'test: ./smoke.sh\nmodules: []')}`;
    const workspace = await createWorkspace({
      'forge.yaml': edited,
      'forge.lock': lockForReleaseA,
      'AGENTS.md': '# Our team rules\n\nAlways run the linter.\n',
      '.gitignore': 'node_modules\n',
    });
    const system = createFakeSystem({ routerTags: { '0.299.0': commitA, '0.400.0': commitB } });

    const run = await runForge(['init', '--release', '0.400.0'], { workspace, system });

    expect(JSON.parse(run.stdout).files).toEqual([
      { path: 'forge.yaml', action: 'kept' },
      { path: 'forge.lock', action: 'kept' },
      { path: 'AGENTS.md', action: 'updated' },
      { path: 'CLAUDE.md', action: 'created' },
      { path: '.gitignore', action: 'updated' },
    ]);
    expect(await read(workspace, 'forge.yaml')).toBe(edited);
    expect(await read(workspace, 'forge.lock')).toBe(lockForReleaseA);
    expect(await read(workspace, '.gitignore')).toBe('node_modules\n.forge/\n');
    const guidance = await read(workspace, 'AGENTS.md');
    expect(guidance.startsWith('# Our team rules\n\nAlways run the linter.\n\n<!-- wgc-forge:start -->')).toBe(true);

    const third = await runForge(['init'], { workspace, system });
    expect(JSON.parse(third.stdout).files.map((file: { action: string }) => file.action)).toEqual([
      'kept',
      'kept',
      'kept',
      'kept',
      'kept',
    ]);
    expect(await read(workspace, 'AGENTS.md')).toBe(guidance);
  });

  test('two router flags are refused', async () => {
    const workspace = await createWorkspace();

    const run = await runForge(['init', '--release', '0.299.0', '--commit', commitA], { workspace });

    expect(JSON.parse(run.stdout).error.message).toBe('Pass only one of --release, --rc and --commit.');
  });
});

describe('wgc forge create', () => {
  test('--list-templates lists the two presets and the four hook templates', async () => {
    const run = await runForge(['create', '--list-templates'], { workspace: await createWorkspace() });

    const listed = JSON.parse(run.stdout);
    expect(listed.presets.map((entry: { id: string }) => entry.id)).toEqual(['request-id', 'client-name']);
    expect(listed.templates.map((entry: { id: string }) => entry.id)).toEqual([
      'router-request',
      'operation-middleware',
      'origin-request',
      'origin-response',
    ]);
  });

  test('--list-templates reads as a table for a person', async () => {
    const run = await runForge(['create', '--list-templates'], { workspace: await createWorkspace(), caller: 'human' });

    expect(run.stdout.split('\n').slice(0, 2)).toEqual([
      'Presets (wgc forge create --preset <id>):',
      '  request-id             Answers every request with exactly one non-empty X-Request-ID header.',
    ]);
  });

  test('--preset copies the module with its test, pins it to the locked router and adds it to forge.yaml', async () => {
    const workspace = await createWorkspace({ 'forge.yaml': manifest, 'forge.lock': lockForReleaseA });

    const run = await runForge(['create', '--preset', 'request-id'], { workspace });

    expect(JSON.parse(run.stdout)).toEqual({
      status: 'success',
      module: 'request-id',
      path: './modules/request-id',
      from: { kind: 'preset', id: 'request-id' },
    });
    expect(await read(workspace, 'modules/request-id/go.mod')).toBe(
      `module forge.local/request-id\n\ngo 1.26.0\n\nrequire ${routerModule} ${versionA}\n`,
    );
    expect(await read(workspace, 'modules/request-id/module.go')).toContain('core.RegisterModule(&RequestID{})');
    expect(await read(workspace, 'modules/request-id/module_test.go')).toContain('func TestGeneratesOneRequestID');
    expect(await read(workspace, 'forge.yaml')).toBe(
      manifest.replace('modules: []', 'modules:\n  - path: ./modules/request-id'),
    );
  });

  test('--template names the module ID after the module', async () => {
    const workspace = await createWorkspace({ 'forge.yaml': manifest, 'forge.lock': lockForReleaseA });

    await runForge(['create', '--template', 'origin-request', 'sign-requests'], { workspace });

    const code = await read(workspace, 'modules/sign-requests/module.go');
    expect(code).toContain('const moduleID = "sign-requests"');
    expect(code).toContain('func (m *Module) OnOriginRequest(');
  });

  test('an unknown preset lists the real ones', async () => {
    const workspace = await createWorkspace({ 'forge.yaml': manifest, 'forge.lock': lockForReleaseA });

    const run = await runForge(['create', '--preset', 'rate-limit'], { workspace });

    expect(JSON.parse(run.stdout).error).toEqual({
      message: 'There is no preset "rate-limit".',
      input: '--preset rate-limit',
      fix: 'Use one of: request-id, client-name.',
    });
  });

  test('creating over an existing module is refused', async () => {
    const workspace = await createWorkspace({
      'forge.yaml': manifest,
      'forge.lock': lockForReleaseA,
      'modules/request-id/module.go': 'package mine\n',
    });

    const run = await runForge(['create', '--preset', 'request-id'], { workspace });

    expect(JSON.parse(run.stdout).error.message).toBe('./modules/request-id already exists.');
    expect(await read(workspace, 'modules/request-id/module.go')).toBe('package mine\n');
  });
});

describe('wgc forge add', () => {
  const acmeModules = {
    remotes: { 'https://github.com/acme/router-modules.git': `${commitB}\trefs/tags/v2.0.0` },
    modules: {
      [`github.com/acme/router-modules/auth@${commitB}`]: {
        Path: 'github.com/acme/router-modules/auth',
        Version: 'v2.0.0',
      },
      'github.com/acme/mod@v1.2.0': { Path: 'github.com/acme/mod', Version: 'v1.2.0', Hash: commitB },
    },
  };

  test('a Git URL with --ref and --package is added and pinned to its commit', async () => {
    const workspace = await createWorkspace({ 'forge.yaml': manifest, 'forge.lock': lockForReleaseA });

    const run = await runForge(
      ['add', '--ref', 'v2.0.0', '--package', 'auth', 'https://github.com/acme/router-modules.git'],
      { workspace, system: createFakeSystem(acmeModules) },
    );

    expect(JSON.parse(run.stdout)).toEqual({
      status: 'success',
      added: { git: 'https://github.com/acme/router-modules.git', ref: 'v2.0.0', package: 'auth' },
      pinned: {
        module: 'github.com/acme/router-modules/auth',
        package: 'github.com/acme/router-modules/auth',
        version: 'v2.0.0',
        commit: commitB,
      },
    });
    expect(await read(workspace, 'forge.yaml')).toBe(
      manifest.replace(
        'modules: []',
        'modules:\n  - git: https://github.com/acme/router-modules.git\n    ref: v2.0.0\n    package: auth',
      ),
    );
    expect(await read(workspace, 'forge.lock')).toBe(
      lockForReleaseA.replace(
        'modules: []',
        `modules:
  - source:
      git: https://github.com/acme/router-modules.git
      ref: v2.0.0
      package: auth
    module: github.com/acme/router-modules/auth
    package: github.com/acme/router-modules/auth
    version: v2.0.0
    commit: ${commitB}`,
      ),
    );
  });

  test('a Go package path with @version is added and pinned', async () => {
    const workspace = await createWorkspace({ 'forge.yaml': manifest, 'forge.lock': lockForReleaseA });

    const run = await runForge(['add', 'github.com/acme/mod/headers@v1.2.0'], {
      workspace,
      system: createFakeSystem(acmeModules),
    });

    expect(JSON.parse(run.stdout)).toMatchObject({
      added: { go: 'github.com/acme/mod/headers', version: 'v1.2.0' },
      pinned: { module: 'github.com/acme/mod', package: 'github.com/acme/mod/headers', version: 'v1.2.0' },
    });
  });

  test('a local path is added without a pin', async () => {
    const workspace = await createWorkspace({
      'forge.yaml': manifest,
      'forge.lock': lockForReleaseA,
      'modules/mine/go.mod': 'module forge.local/mine\n',
    });

    const run = await runForge(['add', 'modules/mine'], { workspace });

    expect(JSON.parse(run.stdout)).toEqual({ status: 'success', added: { path: './modules/mine' } });
    expect(await read(workspace, 'forge.lock')).toBe(lockForReleaseA);
  });

  test('a module that cannot be resolved leaves forge.yaml and forge.lock alone', async () => {
    const workspace = await createWorkspace({ 'forge.yaml': manifest, 'forge.lock': lockForReleaseA });

    const run = await runForge(['add', 'github.com/acme/missing'], { workspace });

    expect(run.exitCode).toBe(1);
    expect(JSON.parse(run.stdout).error.input).toBe('github.com/acme/missing');
    expect(await read(workspace, 'forge.yaml')).toBe(manifest);
    expect(await read(workspace, 'forge.lock')).toBe(lockForReleaseA);
  });

  test('--ref on a Go package is refused with the @version form', async () => {
    const workspace = await createWorkspace({ 'forge.yaml': manifest, 'forge.lock': lockForReleaseA });

    const run = await runForge(['add', '--ref', 'main', 'github.com/acme/mod'], { workspace });

    expect(JSON.parse(run.stdout).error).toEqual({
      message: '--ref and --package only apply to a Git URL.',
      input: 'github.com/acme/mod',
      fix: 'For a Go package, put the version after an @, for example github.com/acme/mod/headers@v1.2.0.',
    });
  });

  test('adding the same module twice is refused', async () => {
    const workspace = await createWorkspace({
      'forge.yaml': manifest.replace('modules: []', 'modules:\n  - go: github.com/acme/mod\n    version: v1.2.0'),
    });

    const run = await runForge(['add', 'github.com/acme/mod@v1.2.0'], { workspace });

    expect(JSON.parse(run.stdout).error.message).toBe('github.com/acme/mod is already a module of this workspace.');
  });
});

describe('wgc forge lock', () => {
  test('resolves every pin again, moving a branch forward', async () => {
    const withBranch = manifest.replace(
      'modules: []',
      'modules:\n  - git: https://github.com/acme/router-modules.git\n    ref: main',
    );
    const staleLock = lockForReleaseA.replace(
      'modules: []',
      `modules:
  - source:
      git: https://github.com/acme/router-modules.git
      ref: main
    module: github.com/acme/router-modules
    package: github.com/acme/router-modules
    version: v0.0.0-20260101000000-cccccccccccc
    commit: ${'c'.repeat(40)}`,
    );
    const workspace = await createWorkspace({ 'forge.yaml': withBranch, 'forge.lock': staleLock });
    const system = createFakeSystem({
      remotes: { 'https://github.com/acme/router-modules.git': `${commitB}\trefs/heads/main` },
      modules: {
        [`github.com/acme/router-modules@${commitB}`]: {
          Path: 'github.com/acme/router-modules',
          Version: 'v0.0.0-20260202000000-bbbbbbbbbbbb',
        },
      },
    });

    const run = await runForge(['lock'], { workspace, system });

    expect(JSON.parse(run.stdout)).toEqual({
      status: 'success',
      router: { source: 'release 0.299.0', version: versionA, commit: commitA },
      modules: [
        {
          package: 'github.com/acme/router-modules',
          module: 'github.com/acme/router-modules',
          version: 'v0.0.0-20260202000000-bbbbbbbbbbbb',
          commit: commitB,
        },
      ],
    });
    expect(await read(workspace, 'forge.lock')).toContain(`commit: ${commitB}`);
  });
});
