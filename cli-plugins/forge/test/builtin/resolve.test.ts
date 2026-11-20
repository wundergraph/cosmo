import { describe, expect, test } from 'vitest';
import { gitRepositoryPath, latestRouterRelease, resolveModule, resolveRouter } from '../../src/builtin/resolve.js';
import { commitA, commitB, createFakeSystem, versionA } from './harness.js';

const failureOf = (result: { success: boolean; errors?: Error[] }) => {
  const [error] = result.errors ?? [];
  return { ...error, message: error?.message };
};

describe('router', () => {
  test('a release is resolved through its router@<version> tag to the commit and Go version', async () => {
    const system = createFakeSystem();

    const router = await resolveRouter(system, { release: '0.299.0' });

    expect(router).toEqual({
      success: true,
      data: { source: { release: '0.299.0' }, commit: commitA, version: versionA, goVersion: '1.26.0' },
    });
    expect(system.commands).toEqual([
      'git ls-remote https://github.com/wundergraph/cosmo refs/tags/router@0.299.0 refs/tags/router@0.299.0^{}',
      `go list -m -json github.com/wundergraph/cosmo/router@${commitA}`,
    ]);
  });

  test('a release candidate is resolved the same way', async () => {
    const system = createFakeSystem({ routerTags: { '0.300.0-rc.1': commitB } });

    const router = await resolveRouter(system, { rc: '0.300.0-rc.1' });

    expect(router).toMatchObject({ data: { commit: commitB, version: 'v0.0.0-20260101000000-bbbbbbbbbbbb' } });
  });

  test('a commit skips the tag lookup', async () => {
    const system = createFakeSystem();

    const router = await resolveRouter(system, { commit: commitA });

    expect(router).toMatchObject({ data: { source: { commit: commitA }, commit: commitA, version: versionA } });
    expect(system.commands).toEqual([`go list -m -json github.com/wundergraph/cosmo/router@${commitA}`]);
  });

  test('a release that was never tagged names the tag and how to list the real ones', async () => {
    const router = await resolveRouter(createFakeSystem(), { release: '9.9.9' });

    expect(failureOf(router)).toMatchObject({
      message: 'Router release 9.9.9 does not exist: https://github.com/wundergraph/cosmo has no tag router@9.9.9.',
      input: 'router@9.9.9',
      fix: "List the router versions with `git ls-remote --tags https://github.com/wundergraph/cosmo 'refs/tags/router@*'` and pick one of them.",
    });
  });

  test('the latest release ignores release candidates', async () => {
    const system = createFakeSystem({
      routerTags: { '0.299.0': commitA, '0.1000.0': commitB, '0.1001.0-rc.1': 'c'.repeat(40) },
    });

    expect(await latestRouterRelease(system)).toEqual({ success: true, data: '0.1000.0' });
  });
});

describe('modules', () => {
  test('a Go package below the module root is pinned to the module that contains it', async () => {
    const system = createFakeSystem({
      modules: { 'github.com/acme/mod@v1.2.0': { Path: 'github.com/acme/mod', Version: 'v1.2.0', Hash: commitB } },
    });

    const module = await resolveModule(system, { go: 'github.com/acme/mod/headers', version: 'v1.2.0' });

    expect(module).toEqual({
      success: true,
      data: {
        source: { go: 'github.com/acme/mod/headers', version: 'v1.2.0' },
        module: 'github.com/acme/mod',
        package: 'github.com/acme/mod/headers',
        version: 'v1.2.0',
        commit: commitB,
      },
    });
  });

  test('a Go package without a version is pinned to the latest one', async () => {
    const system = createFakeSystem({
      modules: { 'github.com/acme/mod@latest': { Path: 'github.com/acme/mod', Version: 'v1.4.1' } },
    });

    const module = await resolveModule(system, { go: 'github.com/acme/mod' });

    expect(module).toMatchObject({ data: { module: 'github.com/acme/mod', version: 'v1.4.1' } });
  });

  test('a Git URL is pinned to the commit of its ref and the package directory inside it', async () => {
    const system = createFakeSystem({
      remotes: { 'https://github.com/acme/router-modules.git': `${commitB}\trefs/heads/main` },
      modules: {
        [`github.com/acme/router-modules@${commitB}`]: {
          Path: 'github.com/acme/router-modules',
          Version: 'v0.0.0-20260202000000-bbbbbbbbbbbb',
        },
      },
    });

    const module = await resolveModule(system, {
      git: 'https://github.com/acme/router-modules.git',
      ref: 'main',
      package: 'auth',
    });

    expect(module).toEqual({
      success: true,
      data: {
        source: { git: 'https://github.com/acme/router-modules.git', ref: 'main', package: 'auth' },
        module: 'github.com/acme/router-modules',
        package: 'github.com/acme/router-modules/auth',
        version: 'v0.0.0-20260202000000-bbbbbbbbbbbb',
        commit: commitB,
      },
    });
    expect(system.commands[0]).toBe('git ls-remote https://github.com/acme/router-modules.git main main^{}');
  });

  test('a Git ref that does not exist names the repository and the ref', async () => {
    const system = createFakeSystem({ remotes: { 'https://github.com/acme/router-modules.git': '' } });

    const module = await resolveModule(system, { git: 'https://github.com/acme/router-modules.git', ref: 'nope' });

    expect(failureOf(module)).toMatchObject({
      message: 'https://github.com/acme/router-modules.git has no branch, tag or commit named "nope".',
      input: 'https://github.com/acme/router-modules.git ref nope',
      fix: 'List the refs with `git ls-remote https://github.com/acme/router-modules.git` and pass one with --ref.',
    });
  });

  test('a Go package nobody publishes names the package', async () => {
    const module = await resolveModule(createFakeSystem(), { go: 'github.com/acme/missing' });

    expect(failureOf(module)).toMatchObject({
      input: 'github.com/acme/missing',
      fix: 'Check the package path and version, and that `go` can download it (GOPRIVATE for private modules).',
    });
  });

  test.each([
    ['https://github.com/acme/router-modules.git', 'github.com/acme/router-modules'],
    ['git@github.com:acme/router-modules.git', 'github.com/acme/router-modules'],
    ['ssh://git@gitlab.example.com/platform/router/modules', 'gitlab.example.com/platform/router/modules'],
  ])('%s is the Go path %s', (url, goPath) => {
    expect(gitRepositoryPath(url)).toEqual({ success: true, data: goPath });
  });
});
