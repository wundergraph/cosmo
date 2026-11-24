import { readdir } from 'node:fs/promises';
import type { Prompts } from '@wundergraph/wgc-plugin-sdk';
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

const config = `graph: shop
subgraphs: []
router:
  release: 0.299.0
`;

const withModules = (entries: string): string =>
  config.replace('release: 0.299.0\n', `release: 0.299.0\n  modules:\n${entries}`);

const initializedFiles = ['.gitignore', 'AGENTS.md', 'CLAUDE.md', 'wundergraph.lock', 'wundergraph.yaml'];

describe('wgc forge init', () => {
  test('pins the latest router release and writes the workspace files', async () => {
    const workspace = await createWorkspace();

    const run = await runForge(['init', '--graph', 'shop'], {
      workspace,
      system: createFakeSystem({ routerTags: { '0.298.0': commitB, '0.299.0': commitA } }),
    });

    expect(JSON.parse(run.stdout)).toEqual({
      ok: true,
      data: {
        workspace,
        router: { source: 'release 0.299.0', version: versionA, commit: commitA },
        files: [
          { path: 'wundergraph.yaml', action: 'created' },
          { path: 'wundergraph.lock', action: 'created' },
          { path: 'AGENTS.md', action: 'created' },
          { path: 'CLAUDE.md', action: 'created' },
          { path: '.gitignore', action: 'created' },
        ],
      },
    });
    expect(await read(workspace, 'wundergraph.yaml')).toBe(config);
    expect(await read(workspace, 'wundergraph.lock')).toBe(lockForReleaseA);
    expect(await read(workspace, '.gitignore')).toBe('.forge/\n');
    expect(await read(workspace, 'AGENTS.md')).toContain('`wgc forge build` compiles the router');
    expect((await readdir(workspace)).sort()).toEqual(initializedFiles);
  });

  test('--rc pins a release candidate', async () => {
    const workspace = await createWorkspace();

    await runForge(['init', '--graph', 'shop', '--rc', '0.300.0-rc.1'], {
      workspace,
      system: createFakeSystem({ routerTags: { '0.300.0-rc.1': commitB } }),
    });

    expect(await read(workspace, 'wundergraph.yaml')).toBe(config.replace('release: 0.299.0', 'rc: 0.300.0-rc.1'));
  });

  test('running it again keeps the selected release, wundergraph.yaml and the notes people wrote', async () => {
    const edited = `# The shop graph\n${config.replace('release: 0.299.0', 'release: 0.299.0\n  test: ./smoke.sh')}`;
    const workspace = await createWorkspace({
      'wundergraph.yaml': edited,
      'wundergraph.lock': lockForReleaseA,
      'AGENTS.md': '# Our team rules\n\nAlways run the linter.\n',
      '.gitignore': 'node_modules\n',
    });
    const system = createFakeSystem({ routerTags: { '0.299.0': commitA, '0.400.0': commitB } });

    const run = await runForge(['init', '--release', '0.400.0'], { workspace, system });

    expect(JSON.parse(run.stdout).data.files).toEqual([
      { path: 'wundergraph.yaml', action: 'kept' },
      { path: 'wundergraph.lock', action: 'kept' },
      { path: 'AGENTS.md', action: 'updated' },
      { path: 'CLAUDE.md', action: 'created' },
      { path: '.gitignore', action: 'updated' },
    ]);
    expect(await read(workspace, 'wundergraph.yaml')).toBe(edited);
    expect(await read(workspace, 'wundergraph.lock')).toBe(lockForReleaseA);
    expect(await read(workspace, '.gitignore')).toBe('node_modules\n.forge/\n');
    const guidance = await read(workspace, 'AGENTS.md');
    expect(guidance.startsWith('# Our team rules\n\nAlways run the linter.\n\n<!-- wgc-forge:start -->')).toBe(true);
    expect(guidance).toContain('`npm i -g wgc@latest && wgc plugins install forge`');

    const third = await runForge(['init'], { workspace, system });
    expect(JSON.parse(third.stdout).data.files.map((file: { action: string }) => file.action)).toEqual([
      'kept',
      'kept',
      'kept',
      'kept',
      'kept',
    ]);
    expect(await read(workspace, 'AGENTS.md')).toBe(guidance);
  });

  const graphWithoutRouter = `graph: shop
subgraphs:
  - name: products
    schema:
      file: products.graphql
    routing_url: http://localhost:4001/graphql
mocks:
  Product:
    name: Lamp
`;

  test('adds a router to a wundergraph.yaml that has none, keeping its subgraphs and mocks', async () => {
    const workspace = await createWorkspace({ 'wundergraph.yaml': graphWithoutRouter });
    const system = createFakeSystem({ routerTags: { '0.299.0': commitA } });

    const run = await runForge(['init'], { workspace, system });

    expect(JSON.parse(run.stdout).data.files).toEqual([
      { path: 'wundergraph.yaml', action: 'updated' },
      { path: 'wundergraph.lock', action: 'created' },
      { path: 'AGENTS.md', action: 'created' },
      { path: 'CLAUDE.md', action: 'created' },
      { path: '.gitignore', action: 'created' },
    ]);
    const updated = `graph: shop
subgraphs:
  - name: products
    schema:
      file: products.graphql
    routing_url: http://localhost:4001/graphql
router:
  release: 0.299.0
mocks:
  Product:
    name: Lamp
`;
    expect(await read(workspace, 'wundergraph.yaml')).toBe(updated);
    expect(await read(workspace, 'wundergraph.lock')).toBe(lockForReleaseA);
    expect((await readdir(workspace)).sort()).toEqual(initializedFiles);

    const again = await runForge(['init'], { workspace, system });

    expect(JSON.parse(again.stdout).data.files[0]).toEqual({ path: 'wundergraph.yaml', action: 'kept' });
    expect(await read(workspace, 'wundergraph.yaml')).toBe(updated);
  });

  test('a new wundergraph.yaml is named after its directory without --graph', async () => {
    const parent = await createWorkspace();

    const run = await runForge(['init', 'My Router!'], {
      workspace: parent,
      system: createFakeSystem({ routerTags: { '0.299.0': commitA } }),
    });

    expect(JSON.parse(run.stdout).data.workspace).toBe(`${parent}/My Router!`);
    expect(await read(parent, 'My Router!/wundergraph.yaml')).toBe(config.replace('graph: shop', 'graph: My-Router'));
  });

  test('an invalid --graph is refused', async () => {
    const workspace = await createWorkspace();

    const run = await runForge(['init', '--graph', '-x', '--release', '0.299.0'], { workspace });

    expect(run.exitCode).toBe(1);
    expect(JSON.parse(run.stdout).error).toEqual({
      code: 'COMMAND_FAILED',
      message: '"-x" is not a valid graph name.',
      input: '--graph -x',
      remediation: 'Pass --graph with letters, digits, `-` and `_`, for example --graph shop.',
    });
    expect(await readdir(workspace)).toEqual([]);
  });

  test('two router flags are refused', async () => {
    const workspace = await createWorkspace();

    const run = await runForge(['init', '--release', '0.299.0', '--commit', commitA], { workspace });

    expect(JSON.parse(run.stdout).error.message).toBe('Pass only one of --release, --rc and --commit.');
  });

  test('a directory argument initializes the workspace there', async () => {
    const parent = await createWorkspace();

    const run = await runForge(['init', 'routers/edge'], {
      workspace: parent,
      system: createFakeSystem({ routerTags: { '0.299.0': commitA } }),
    });

    expect(JSON.parse(run.stdout).data.workspace).toBe(`${parent}/routers/edge`);
    expect(await read(parent, 'routers/edge/wundergraph.yaml')).toBe(config.replace('graph: shop', 'graph: edge'));
  });

  test('a person selects the router release, with the latest one offered', async () => {
    const workspace = await createWorkspace();
    const questions: string[] = [];
    const prompts: Prompts = {
      canPrompt: true,
      confirm: () => Promise.resolve(false),
      text: (question, defaultAnswer) => {
        questions.push(`${question} (${defaultAnswer})`);
        return Promise.resolve('0.300.0-rc.1');
      },
    };

    await runForge(['init', '--graph', 'shop'], {
      workspace,
      caller: 'human',
      prompts,
      system: createFakeSystem({ routerTags: { '0.299.0': commitA, '0.300.0-rc.1': commitB } }),
    });

    expect(questions).toEqual(['Router release to build: (0.299.0)']);
    expect(await read(workspace, 'wundergraph.yaml')).toBe(config.replace('release: 0.299.0', 'rc: 0.300.0-rc.1'));
  });
});

describe('wgc forge create', () => {
  test('--list-templates lists the presets and a template for every hook family, marking experimental ones', async () => {
    const run = await runForge(['create', '--list-templates'], { workspace: await createWorkspace() });

    const listed = JSON.parse(run.stdout).data;
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
    const workspace = await createWorkspace({ 'wundergraph.yaml': config, 'wundergraph.lock': lockForReleaseA });

    const refused = await runForge(['create', '--template', 'subscription-start', 'guard'], { workspace });
    const created = await runForge(['create', '--template', 'subscription-start', 'guard', '--experimental'], {
      workspace,
    });

    expect(JSON.parse(refused.stdout)).toEqual({
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: 'The subscription-start template uses an experimental router hook.',
        input: '--template subscription-start',
        remediation: 'Pass --experimental to create it anyway.',
      },
    });
    expect(JSON.parse(created.stdout)).toEqual({
      ok: true,
      data: {
        module: 'guard',
        path: './modules/guard',
        from: { kind: 'template', id: 'subscription-start' },
      },
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

  test('--preset copies the module with its test, pins it to the locked router and adds it to wundergraph.yaml', async () => {
    const workspace = await createWorkspace({ 'wundergraph.yaml': config, 'wundergraph.lock': lockForReleaseA });

    const run = await runForge(['create', '--preset', 'request-id'], { workspace });

    expect(JSON.parse(run.stdout)).toEqual({
      ok: true,
      data: {
        module: 'request-id',
        path: './modules/request-id',
        from: { kind: 'preset', id: 'request-id' },
      },
    });
    expect(await read(workspace, 'modules/request-id/go.mod')).toBe(
      `module forge.local/request-id\n\ngo 1.26.0\n\nrequire ${routerModule} ${versionA}\n`,
    );
    expect(await read(workspace, 'modules/request-id/module.go')).toContain('core.RegisterModule(&RequestID{})');
    expect(await read(workspace, 'modules/request-id/module_test.go')).toContain('func TestGeneratesOneRequestID');
    expect(await read(workspace, 'wundergraph.yaml')).toBe(withModules('    - path: ./modules/request-id\n'));
  });

  test('a person picks a starter from the menu and names the module', async () => {
    const workspace = await createWorkspace({ 'wundergraph.yaml': config, 'wundergraph.lock': lockForReleaseA });
    const answers = ['2', 'require-client'];
    const questions: string[] = [];
    const prompts: Prompts = {
      canPrompt: true,
      confirm: () => Promise.resolve(false),
      text: (question) => {
        questions.push(question);
        return Promise.resolve(answers.shift() ?? '');
      },
    };

    const run = await runForge(['create'], { workspace, caller: 'human', prompts });

    expect(questions[0]).toContain(' 2. client-name');
    expect(questions[1]).toBe('Module name:');
    expect(run.stdout).toContain('Created ./modules/require-client from preset client-name');
    expect(await read(workspace, 'wundergraph.yaml')).toBe(withModules('    - path: ./modules/require-client\n'));
  });

  test('an agent without --template or --preset is told to pass one', async () => {
    const workspace = await createWorkspace({ 'wundergraph.yaml': config, 'wundergraph.lock': lockForReleaseA });

    const run = await runForge(['create'], { workspace });

    expect(JSON.parse(run.stdout).error).toEqual({
      code: 'COMMAND_FAILED',
      message: 'Pass one of --template <id> and --preset <id>.',
      input: '--template, --preset',
      remediation: 'Run `wgc forge create --list-templates` to see the IDs.',
    });
  });

  test('--template names the module ID after the module', async () => {
    const workspace = await createWorkspace({ 'wundergraph.yaml': config, 'wundergraph.lock': lockForReleaseA });

    await runForge(['create', '--template', 'origin-request', 'sign-requests'], { workspace });

    const code = await read(workspace, 'modules/sign-requests/module.go');
    expect(code).toContain('const moduleID = "sign-requests"');
    expect(code).toContain('func (m *Module) OnOriginRequest(');
  });

  test('an unknown preset lists the real ones', async () => {
    const workspace = await createWorkspace({ 'wundergraph.yaml': config, 'wundergraph.lock': lockForReleaseA });

    const run = await runForge(['create', '--preset', 'rate-limit'], { workspace });

    expect(JSON.parse(run.stdout).error).toEqual({
      code: 'COMMAND_FAILED',
      message: 'There is no preset "rate-limit".',
      input: '--preset rate-limit',
      remediation: 'Use one of: request-id, client-name.',
    });
  });

  test('creating over an existing module is refused', async () => {
    const workspace = await createWorkspace({
      'wundergraph.yaml': config,
      'wundergraph.lock': lockForReleaseA,
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
    const workspace = await createWorkspace({ 'wundergraph.yaml': config, 'wundergraph.lock': lockForReleaseA });

    const run = await runForge(
      ['add', '--ref', 'v2.0.0', '--package', 'auth', 'https://github.com/acme/router-modules.git'],
      { workspace, system: createFakeSystem(acmeModules) },
    );

    expect(JSON.parse(run.stdout)).toEqual({
      ok: true,
      data: {
        added: { git: 'https://github.com/acme/router-modules.git', ref: 'v2.0.0', package: 'auth' },
        pinned: {
          module: 'github.com/acme/router-modules/auth',
          package: 'github.com/acme/router-modules/auth',
          version: 'v2.0.0',
          commit: commitB,
        },
      },
    });
    expect(await read(workspace, 'wundergraph.yaml')).toBe(
      withModules('    - git: https://github.com/acme/router-modules.git\n      ref: v2.0.0\n      package: auth\n'),
    );
    expect(await read(workspace, 'wundergraph.lock')).toBe(
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
    expect((await readdir(workspace)).sort()).toEqual(['wundergraph.lock', 'wundergraph.yaml']);
  });

  test('a Go package path with @version is added and pinned', async () => {
    const workspace = await createWorkspace({ 'wundergraph.yaml': config, 'wundergraph.lock': lockForReleaseA });

    const run = await runForge(['add', 'github.com/acme/mod/headers@v1.2.0'], {
      workspace,
      system: createFakeSystem(acmeModules),
    });

    expect(JSON.parse(run.stdout).data).toMatchObject({
      added: { go: 'github.com/acme/mod/headers', version: 'v1.2.0' },
      pinned: { module: 'github.com/acme/mod', package: 'github.com/acme/mod/headers', version: 'v1.2.0' },
    });
  });

  test('a local path is added without a pin', async () => {
    const workspace = await createWorkspace({
      'wundergraph.yaml': config,
      'wundergraph.lock': lockForReleaseA,
      'modules/mine/go.mod': 'module forge.local/mine\n',
    });

    const run = await runForge(['add', 'modules/mine'], { workspace });

    expect(JSON.parse(run.stdout)).toEqual({ ok: true, data: { added: { path: './modules/mine' } } });
    expect(await read(workspace, 'wundergraph.lock')).toBe(lockForReleaseA);
  });

  test('a module that cannot be resolved leaves wundergraph.yaml and wundergraph.lock alone', async () => {
    const workspace = await createWorkspace({ 'wundergraph.yaml': config, 'wundergraph.lock': lockForReleaseA });

    const run = await runForge(['add', 'github.com/acme/missing'], { workspace });

    expect(run.exitCode).toBe(1);
    expect(JSON.parse(run.stdout).error.input).toBe('github.com/acme/missing');
    expect(await read(workspace, 'wundergraph.yaml')).toBe(config);
    expect(await read(workspace, 'wundergraph.lock')).toBe(lockForReleaseA);
  });

  test('--ref on a Go package is refused with the @version form', async () => {
    const workspace = await createWorkspace({ 'wundergraph.yaml': config, 'wundergraph.lock': lockForReleaseA });

    const run = await runForge(['add', '--ref', 'main', 'github.com/acme/mod'], { workspace });

    expect(JSON.parse(run.stdout).error).toEqual({
      code: 'COMMAND_FAILED',
      message: '--ref and --package only apply to a Git URL.',
      input: 'github.com/acme/mod',
      remediation: 'For a Go package, put the version after an @, for example github.com/acme/mod/headers@v1.2.0.',
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
  const registered = withModules('    - go: github.com/acme/mod\n');
  const newerRelease = createFakeSystem({
    modules: { 'github.com/acme/mod@latest': { Path: 'github.com/acme/mod', Version: 'v1.3.0', Hash: commitB } },
  });

  test('re-adding a registered package previews the newer selection and changes nothing without --yes', async () => {
    const workspace = await createWorkspace({ 'wundergraph.yaml': registered, 'wundergraph.lock': lockedAt });

    const run = await runForge(['add', 'github.com/acme/mod'], { workspace, system: newerRelease });

    expect(run.exitCode).toBe(5);
    expect(JSON.parse(run.stdout)).toMatchObject({
      error: {
        code: 'CONFIRMATION_REQUIRED',
        input: 'github.com/acme/mod',
        remediation: 'Review the change, then run the command again with --yes to accept it.',
      },
      data: {
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
    expect(await read(workspace, 'wundergraph.yaml')).toBe(registered);
    expect(await read(workspace, 'wundergraph.lock')).toBe(lockedAt);
  });

  test('--yes accepts the newer selection and keeps a single registration', async () => {
    const workspace = await createWorkspace({ 'wundergraph.yaml': registered, 'wundergraph.lock': lockedAt });

    const run = await runForge(['add', '--yes', 'github.com/acme/mod'], { workspace, system: newerRelease });

    expect(JSON.parse(run.stdout)).toMatchObject({ ok: true, data: { written: true } });
    expect(await read(workspace, 'wundergraph.yaml')).toBe(registered);
    expect(await read(workspace, 'wundergraph.lock')).toBe(lockedAtNewer);
  });

  test('re-adding with an explicit version replaces the registration in place', async () => {
    const workspace = await createWorkspace({ 'wundergraph.yaml': registered, 'wundergraph.lock': lockedAt });

    await runForge(['add', '--yes', 'github.com/acme/mod@v1.2.0'], {
      workspace,
      system: createFakeSystem(acmeModules),
    });

    expect(await read(workspace, 'wundergraph.yaml')).toBe(
      withModules('    - go: github.com/acme/mod\n      version: v1.2.0\n'),
    );
  });

  test('re-adding a package that resolves to its current pin reports it as registered', async () => {
    const workspace = await createWorkspace({ 'wundergraph.yaml': registered, 'wundergraph.lock': lockedAtNewer });

    const run = await runForge(['add', 'github.com/acme/mod'], { workspace, system: newerRelease });

    expect(JSON.parse(run.stdout)).toMatchObject({ ok: true, data: { changes: [], written: false } });
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
  const withBranch = withModules('    - git: https://github.com/acme/router-modules.git\n      ref: main\n');
  const remotesAndModules = {
    remotes: { 'https://github.com/acme/router-modules.git': `${commitB}\trefs/heads/main` },
    modules: {
      'github.com/acme/mod@v1.2.0': { Path: 'github.com/acme/mod', Version: 'v1.2.0', Hash: commitB },
    },
  };

  test('keeps the pins of unchanged entries even when their branch moved', async () => {
    const workspace = await createWorkspace({ 'wundergraph.yaml': withBranch, 'wundergraph.lock': lockedBranch });

    const run = await runForge(['lock'], { workspace, system: createFakeSystem(remotesAndModules) });

    expect(JSON.parse(run.stdout)).toMatchObject({ ok: true, data: { changes: [], written: false } });
    expect(await read(workspace, 'wundergraph.lock')).toBe(lockedBranch);
  });

  test('previews an added module and writes it only with --yes', async () => {
    const edited = withModules(
      '    - git: https://github.com/acme/router-modules.git\n      ref: main\n    - go: github.com/acme/mod\n      version: v1.2.0\n',
    );
    const workspace = await createWorkspace({ 'wundergraph.yaml': edited, 'wundergraph.lock': lockedBranch });

    const preview = await runForge(['lock'], { workspace, system: createFakeSystem(remotesAndModules) });

    expect(preview.exitCode).toBe(5);
    expect(JSON.parse(preview.stdout).error.next).toEqual(['wgc forge lock --yes']);
    expect(JSON.parse(preview.stdout).data.changes).toEqual([
      { module: 'github.com/acme/mod', to: `v1.2.0 (${commitB.slice(0, 12)})` },
    ]);
    expect(await read(workspace, 'wundergraph.lock')).toBe(lockedBranch);

    const applied = await runForge(['lock', '--yes'], { workspace, system: createFakeSystem(remotesAndModules) });

    expect(JSON.parse(applied.stdout)).toMatchObject({ ok: true, data: { written: true } });
    expect(await read(workspace, 'wundergraph.lock')).toBe(
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
    const workspace = await createWorkspace({ 'wundergraph.yaml': config, 'wundergraph.lock': lockedBranch });

    const run = await runForge(['lock', '--yes'], { workspace, system: createFakeSystem(remotesAndModules) });

    expect(JSON.parse(run.stdout).data.changes).toEqual([
      {
        module: 'https://github.com/acme/router-modules.git',
        from: `v0.0.0-20260101000000-cccccccccccc (${'c'.repeat(12)})`,
      },
    ]);
    expect(await read(workspace, 'wundergraph.lock')).toBe(lockForReleaseA);
  });

  test('a router edited in wundergraph.yaml is sent to router upgrade', async () => {
    const workspace = await createWorkspace({
      'wundergraph.yaml': config.replace('0.299.0', '0.300.0'),
      'wundergraph.lock': lockForReleaseA,
    });

    const run = await runForge(['lock', '--yes'], { workspace, system: createFakeSystem(remotesAndModules) });

    expect(JSON.parse(run.stdout).error).toEqual({
      code: 'COMMAND_FAILED',
      message: 'wundergraph.yaml selects router release 0.300.0, but wundergraph.lock pins router release 0.299.0.',
      input: 'wundergraph.yaml: router',
      remediation:
        'Restore router release 0.299.0 in wundergraph.yaml, then run `wgc forge router upgrade --config <router.yaml> <candidate>` to change the router.',
    });
    expect(await read(workspace, 'wundergraph.lock')).toBe(lockForReleaseA);
  });
});
