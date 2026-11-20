import { describe, expect, test } from 'vitest';
import { toFailure } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import { parseLock, renderLock } from '../../src/builtin/lock.js';
import { parseManifest, parseRouterCandidate, renderManifest } from '../../src/builtin/manifest.js';
import { commitA, lockForReleaseA, versionA } from './harness.js';

const failureOf = (result: Result<object>) => (result.success ? undefined : toFailure(result));

describe('forge.yaml', () => {
  test('reads a router release and the three kinds of module', () => {
    const manifest = parseManifest(`
version: 1
router:
  release: 0.299.0
test: go test ./...
modules:
  - path: ./modules/request-id
  - go: github.com/acme/mod/headers
    version: v1.2.0
  - git: https://github.com/acme/router-modules.git
    ref: main
    package: auth
`);

    expect(manifest).toEqual({
      success: true,
      data: {
        version: 1,
        router: { release: '0.299.0' },
        binary: '.forge/bin/router',
        test: 'go test ./...',
        modules: [
          { path: './modules/request-id' },
          { go: 'github.com/acme/mod/headers', version: 'v1.2.0' },
          { git: 'https://github.com/acme/router-modules.git', ref: 'main', package: 'auth' },
        ],
      },
    });
  });

  test('reads a release candidate and a commit as the router source', () => {
    expect(parseManifest('version: 1\nrouter:\n  rc: 0.300.0-rc.1\n')).toMatchObject({
      data: { router: { rc: '0.300.0-rc.1' }, modules: [] },
    });
    expect(parseManifest(`version: 1\nrouter:\n  commit: ${commitA}\n`)).toMatchObject({
      data: { router: { commit: commitA } },
    });
  });

  test('a router with two sources names the field and the valid shapes', () => {
    const manifest = parseManifest('version: 1\nrouter:\n  release: 0.299.0\n  commit: abcdef1\n');

    expect(failureOf(manifest)).toMatchObject({
      message:
        'forge.yaml is not valid: router must be exactly one of { release: <version> }, { rc: <version> } or { commit: <sha> }.',
      input: 'forge.yaml: router',
      remediation: 'Correct the field in forge.yaml. Run `wgc forge init` in an empty directory to see a valid file.',
    });
  });

  test('a module that is none of path, go or git names its position', () => {
    const manifest = parseManifest('version: 1\nrouter:\n  release: 0.299.0\nmodules:\n  - url: nope\n');

    expect(failureOf(manifest)).toMatchObject({
      message:
        'forge.yaml is not valid: modules.0 must be one of { path: <directory> }, { go: <package>, version?: <version> } or { git: <url>, ref?: <ref>, package?: <directory> }.',
      input: 'forge.yaml: modules.0',
    });
  });

  test('broken YAML is reported as a YAML problem in forge.yaml', () => {
    expect(failureOf(parseManifest('version: [1'))).toMatchObject({
      input: 'forge.yaml',
      remediation: 'Correct the YAML syntax in forge.yaml.',
    });
  });

  test('writes the manifest back in a stable field order', () => {
    const manifest = parseManifest('modules:\n  - path: ./modules/a\nrouter:\n  release: 0.299.0\nversion: 1\n');
    if (!manifest.success) {
      throw new Error('fixture must parse');
    }

    expect(renderManifest(manifest.data)).toBe(
      'version: 1\nrouter:\n  release: 0.299.0\nbinary: .forge/bin/router\nmodules:\n  - path: ./modules/a\n',
    );
  });
});

describe('router candidates', () => {
  test.each([
    ['0.299.0', { release: '0.299.0' }],
    ['0.300.0-rc.1', { rc: '0.300.0-rc.1' }],
    ['1a182a7', { commit: '1a182a7' }],
  ])('%s is read as %o', (candidate, source) => {
    expect(parseRouterCandidate(candidate)).toEqual({ success: true, data: source });
  });

  test('anything else is rejected with the accepted forms', () => {
    expect(failureOf(parseRouterCandidate('latest'))).toMatchObject({
      message: '"latest" is not a router release, release candidate or commit.',
      input: 'latest',
      remediation: 'Pass a release such as 0.299.0, a release candidate such as 0.300.0-rc.1, or a commit SHA.',
    });
  });
});

describe('forge.lock', () => {
  test('reads the pinned router and remote modules', () => {
    const lock = parseLock(`
version: 1
router:
  source:
    release: 0.299.0
  commit: ${commitA}
  version: ${versionA}
  goVersion: 1.26.0
modules:
  - source:
      go: github.com/acme/mod/headers
    module: github.com/acme/mod
    package: github.com/acme/mod/headers
    version: v1.2.0
`);

    expect(lock).toEqual({
      success: true,
      data: {
        version: 1,
        router: { source: { release: '0.299.0' }, commit: commitA, version: versionA, goVersion: '1.26.0' },
        modules: [
          {
            source: { go: 'github.com/acme/mod/headers' },
            module: 'github.com/acme/mod',
            package: 'github.com/acme/mod/headers',
            version: 'v1.2.0',
          },
        ],
      },
    });
  });

  test('renders exactly the file it reads', () => {
    const lock = parseLock(lockForReleaseA);
    if (!lock.success) {
      throw new Error('fixture must parse');
    }

    expect(renderLock(lock.data)).toBe(lockForReleaseA);
  });

  test('a shortened commit is rejected and the fix is to lock again', () => {
    const lock = parseLock(lockForReleaseA.replace(commitA, 'abc1234'));

    expect(failureOf(lock)).toMatchObject({
      message: 'forge.lock is not valid: router.commit must be a full 40 character commit SHA.',
      input: 'forge.lock: router.commit',
      remediation: 'Delete forge.lock and run `wgc forge lock` to write it again.',
    });
  });

  test('a local module in the lock is rejected, because local modules are never pinned', () => {
    const lock = parseLock(
      lockForReleaseA.replace(
        'modules: []',
        'modules:\n  - source:\n      path: ./modules/a\n    module: forge.local/a\n    package: forge.local/a\n    version: v0.0.0',
      ),
    );

    expect(lock.success).toBe(false);
  });
});
