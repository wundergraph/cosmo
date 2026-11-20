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
  test('--list-templates lists the presets and a template for every hook family, marking experimental ones', async () => {
    const run = await runForge(['create', '--list-templates'], { workspace: await createWorkspace() });

    const listed = JSON.parse(run.stdout);
    expect(listed.presets.map((entry: { id: string }) => entry.id)).toEqual(['request-id', 'client-name']);
    expect(
      listed.templates.map((entry: { id: string; experimental: boolean }) => [entry.id, entry.experimental]),
    ).toEqual([
      ['router-request', false],
      ['operation-middleware', false],
      ['origin-request', false],
      ['origin-response', false],
      ['tracing', false],
      ['stream-receive', false],
      ['subscription-start', true],
    ]);
  });

  test('an experimental template needs --experimental', async () => {
    const workspace = await createWorkspace({ 'forge.yaml': manifest, 'forge.lock': lockForReleaseA });

    const refused = await runForge(['create', '--template', 'subscription-start', 'guard'], { workspace });
    const created = await runForge(['create', '--template', 'subscription-start', 'guard', '--experimental'], {
      workspace,
    });

    expect(JSON.parse(refused.stdout)).toEqual({
      status: 'error',
      error: {
        message: 'The subscription-start template uses an experimental router hook.',
        input: '--template subscription-start',
        fix: 'Pass --experimental to create it anyway.',
      },
    });
    expect(JSON.parse(created.stdout)).toEqual({
      status: 'success',
      module: 'guard',
      path: './modules/guard',
      from: { kind: 'template', id: 'subscription-start' },
    });
    expect(await read(workspace, 'modules/guard/module.go')).toContain('const moduleID = "guard"');
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

  const lockedAt = lockForReleaseA.replace(
    'modules: []',
    `modules:
  - source:
      go: github.com/acme/mod
    module: github.com/acme/mod
    package: github.com/acme/mod
    version: v1.2.0
    commit: ${commitA}`,
  );
  const lockedAtNewer = lockedAt.replace(
    `version: v1.2.0\n    commit: ${commitA}`,
    `version: v1.3.0\n    commit: ${commitB}`,
  );
  const registered = manifest.replace('modules: []', 'modules:\n  - go: github.com/acme/mod');
  const newerRelease = createFakeSystem({
    modules: { 'github.com/acme/mod@latest': { Path: 'github.com/acme/mod', Version: 'v1.3.0', Hash: commitB } },
  });

  test('re-adding a registered package previews the newer selection and changes nothing without --yes', async () => {
    const workspace = await createWorkspace({ 'forge.yaml': registered, 'forge.lock': lockedAt });

    const run = await runForge(['add', 'github.com/acme/mod'], { workspace, system: newerRelease });

    expect(run.exitCode).toBe(1);
    expect(JSON.parse(run.stdout).error).toMatchObject({
      input: 'github.com/acme/mod',
      fix: 'Review the change, then run the command again with --yes to accept it.',
      details: {
        changes: [
          {
            module: 'github.com/acme/mod',
            from: `v1.2.0 (${commitA.slice(0, 12)})`,
            to: `v1.3.0 (${commitB.slice(0, 12)})`,
          },
        ],
        written: false,
      },
    });
    expect(await read(workspace, 'forge.yaml')).toBe(registered);
    expect(await read(workspace, 'forge.lock')).toBe(lockedAt);
  });

  test('--yes accepts the newer selection and keeps a single registration', async () => {
    const workspace = await createWorkspace({ 'forge.yaml': registered, 'forge.lock': lockedAt });

    const run = await runForge(['add', '--yes', 'github.com/acme/mod'], { workspace, system: newerRelease });

    expect(JSON.parse(run.stdout)).toMatchObject({ status: 'success', written: true });
    expect(await read(workspace, 'forge.yaml')).toBe(registered);
    expect(await read(workspace, 'forge.lock')).toBe(lockedAtNewer);
  });

  test('re-adding with an explicit version replaces the registration in place', async () => {
    const workspace = await createWorkspace({ 'forge.yaml': registered, 'forge.lock': lockedAt });

    await runForge(['add', '--yes', 'github.com/acme/mod@v1.2.0'], {
      workspace,
      system: createFakeSystem(acmeModules),
    });

    expect(await read(workspace, 'forge.yaml')).toBe(
      manifest.replace('modules: []', 'modules:\n  - go: github.com/acme/mod\n    version: v1.2.0'),
    );
  });

  test('re-adding a package that resolves to its current pin reports it as registered', async () => {
    const workspace = await createWorkspace({ 'forge.yaml': registered, 'forge.lock': lockedAtNewer });

    const run = await runForge(['add', 'github.com/acme/mod'], { workspace, system: newerRelease });

    expect(JSON.parse(run.stdout)).toMatchObject({ status: 'success', changes: [], written: false });
  });
});

describe('wgc forge lock', () => {
  const lockedBranch = lockForReleaseA.replace(
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
  const withBranch = manifest.replace(
    'modules: []',
    'modules:\n  - git: https://github.com/acme/router-modules.git\n    ref: main',
  );
  const remotesAndModules = {
    remotes: { 'https://github.com/acme/router-modules.git': `${commitB}\trefs/heads/main` },
    modules: {
      'github.com/acme/mod@v1.2.0': { Path: 'github.com/acme/mod', Version: 'v1.2.0', Hash: commitB },
    },
  };

  test('keeps the pins of unchanged entries even when their branch moved', async () => {
    const workspace = await createWorkspace({ 'forge.yaml': withBranch, 'forge.lock': lockedBranch });

    const run = await runForge(['lock'], { workspace, system: createFakeSystem(remotesAndModules) });

    expect(JSON.parse(run.stdout)).toMatchObject({ status: 'success', changes: [], written: false });
    expect(await read(workspace, 'forge.lock')).toBe(lockedBranch);
  });

  test('previews an added module and writes it only with --yes', async () => {
    const edited = withBranch.replace('ref: main', 'ref: main\n  - go: github.com/acme/mod\n    version: v1.2.0');
    const workspace = await createWorkspace({ 'forge.yaml': edited, 'forge.lock': lockedBranch });

    const preview = await runForge(['lock'], { workspace, system: createFakeSystem(remotesAndModules) });

    expect(preview.exitCode).toBe(1);
    expect(JSON.parse(preview.stdout).error.details.changes).toEqual([
      { module: 'github.com/acme/mod', to: `v1.2.0 (${commitB.slice(0, 12)})` },
    ]);
    expect(await read(workspace, 'forge.lock')).toBe(lockedBranch);

    const applied = await runForge(['lock', '--yes'], { workspace, system: createFakeSystem(remotesAndModules) });

    expect(JSON.parse(applied.stdout)).toMatchObject({ status: 'success', written: true });
    expect(await read(workspace, 'forge.lock')).toBe(
      `${lockedBranch.trimEnd()}
  - source:
      go: github.com/acme/mod
      version: v1.2.0
    module: github.com/acme/mod
    package: github.com/acme/mod
    version: v1.2.0
    commit: ${commitB}
`,
    );
  });

  test('previews a removed module', async () => {
    const workspace = await createWorkspace({ 'forge.yaml': manifest, 'forge.lock': lockedBranch });

    const run = await runForge(['lock', '--yes'], { workspace, system: createFakeSystem(remotesAndModules) });

    expect(JSON.parse(run.stdout).changes).toEqual([
      {
        module: 'https://github.com/acme/router-modules.git',
        from: `v0.0.0-20260101000000-cccccccccccc (${'c'.repeat(12)})`,
      },
    ]);
    expect(await read(workspace, 'forge.lock')).toBe(lockForReleaseA);
  });

  test('a router edited in forge.yaml is sent to router upgrade', async () => {
    const workspace = await createWorkspace({
      'forge.yaml': manifest.replace('0.299.0', '0.300.0'),
      'forge.lock': lockForReleaseA,
    });

    const run = await runForge(['lock', '--yes'], { workspace, system: createFakeSystem(remotesAndModules) });

    expect(JSON.parse(run.stdout).error).toEqual({
      message: 'forge.yaml selects router release 0.300.0, but forge.lock pins router release 0.299.0.',
      input: 'forge.yaml: router',
      fix: 'Restore router release 0.299.0 in forge.yaml, then run `wgc forge router upgrade --config <router.yaml> <candidate>` to change the router.',
    });
    expect(await read(workspace, 'forge.lock')).toBe(lockForReleaseA);
  });
});
