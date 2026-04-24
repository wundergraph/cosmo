import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa, type Result, type ResultPromise } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import {
  checkDockerReadiness,
  getDemoLogPath,
  prepareSupportingData,
  publishAllPlugins,
  runRouterContainer,
} from '../../src/commands/demo/util.js';
import { publishPluginPipeline, readPluginFiles } from '../../src/core/plugin-publish.js';
import type { Client } from '../../src/core/client/client.js';

const mocks = vi.hoisted(() => ({ cacheDir: '' }));

vi.mock('execa');
vi.stubGlobal('fetch', vi.fn());

// runRouterContainer and publishAllPlugins pipe long-running docker output into a write stream.
// Real streams open asynchronously and would race against the tmpdir cleanup in afterEach.
vi.mock('node:fs', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:fs')>();
  return {
    ...mod,
    createWriteStream: vi.fn(() => ({
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
    })),
  };
});

vi.mock('../../src/core/config.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/core/config.js')>();
  return {
    ...mod,
    get cacheDir() {
      return mocks.cacheDir;
    },
  };
});

vi.mock('../../src/core/plugin-publish.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/core/plugin-publish.js')>();
  return { ...mod, publishPluginPipeline: vi.fn(), readPluginFiles: vi.fn() };
});

// Suppress the logo, spinner output, and commander error banners so CI logs stay readable.
function silenceOutput() {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
}

function spyOnExit(): MockInstance<typeof process.exit> {
  return vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit');
  });
}

// Build a fully-typed execa Result so tests can hand mockResolvedValueOnce a value that satisfies
// the declared return type of `execa(...)` without `as never` at every call site. Only `stdout`
// is typically relevant for the code under test; the rest are neutral defaults.
// The error-related fields (name/message/stack/cause/shortMessage/originalMessage/code) are
// typed as `never` on a successful Result — execa uses this as a structural signal that these
// only exist on ExecaError. We set them to `undefined as never` so the literal satisfies the type.
function execaResult(overrides: Partial<Result> = {}): Result {
  return {
    stdout: '',
    stderr: '',
    all: undefined,
    stdio: [undefined, '', ''],
    ipcOutput: [],
    pipedFrom: [],
    command: '',
    escapedCommand: '',
    cwd: '',
    durationMs: 0,
    failed: false,
    timedOut: false,
    isCanceled: false,
    isGracefullyCanceled: false,
    isMaxBuffer: false,
    isTerminated: false,
    isForcefullyTerminated: false,
    name: undefined as never,
    message: undefined as never,
    stack: undefined as never,
    cause: undefined as never,
    shortMessage: undefined as never,
    originalMessage: undefined as never,
    code: undefined as never,
    ...overrides,
  };
}

describe('prepareSupportingData', () => {
  let tmpDir: string;
  let exitSpy: MockInstance<typeof process.exit>;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'demo-prep-'));
    mocks.cacheDir = tmpDir;
    silenceOutput();
    exitSpy = spyOnExit();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('downloads plugin files from github into cacheDir', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tree: [
              { type: 'blob', path: 'plugins/products/schema.graphql' },
              { type: 'blob', path: 'plugins/reviews/Dockerfile' },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(new TextEncoder().encode('schema content')))
      .mockResolvedValueOnce(new Response(new TextEncoder().encode('docker content')));

    const result = await prepareSupportingData();

    expect(result).toBe(path.join(tmpDir, 'demo'));
    expect(existsSync(path.join(tmpDir, 'demo', 'plugins/products/schema.graphql'))).toBe(true);
    expect(existsSync(path.join(tmpDir, 'demo', 'plugins/reviews/Dockerfile'))).toBe(true);
  });

  it('exits when github tree api fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 502, statusText: 'Bad Gateway' }));

    await expect(prepareSupportingData()).rejects.toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when tree response is malformed', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ invalid: 'shape' })));

    await expect(prepareSupportingData()).rejects.toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when a file fetch fails', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tree: [{ type: 'blob', path: 'plugins/products/schema.graphql' }] })),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404, statusText: 'Not Found' }));

    await expect(prepareSupportingData()).rejects.toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('checkDockerReadiness', () => {
  let exitSpy: MockInstance<typeof process.exit>;

  beforeEach(() => {
    silenceOutput();
    exitSpy = spyOnExit();
  });

  it('succeeds when docker, buildx, and the docker-container builder are all present', async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce(execaResult({ stdout: '25.0.0' }))
      .mockResolvedValueOnce(execaResult({ stdout: 'v0.12.0' }))
      .mockResolvedValueOnce(
        execaResult({ stdout: 'NAME STATUS\ndefault docker\ncosmo-builder docker-container running' }),
      );

    await expect(checkDockerReadiness()).resolves.toBeUndefined();
  });

  it('exits when docker is not available', async () => {
    vi.mocked(execa).mockRejectedValueOnce(new Error('docker not found'));

    await expect(checkDockerReadiness()).rejects.toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when buildx is not available', async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce(execaResult({ stdout: '25.0.0' }))
      .mockRejectedValueOnce(new Error('buildx not installed'));

    await expect(checkDockerReadiness()).rejects.toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('creates docker-container builder when missing', async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce(execaResult({ stdout: '25.0.0' }))
      .mockResolvedValueOnce(execaResult({ stdout: 'v0.12.0' }))
      .mockResolvedValueOnce(execaResult({ stdout: 'NAME\ndefault docker' }))
      .mockResolvedValueOnce(execaResult())
      .mockResolvedValueOnce(execaResult());

    await expect(checkDockerReadiness()).resolves.toBeUndefined();
    expect(execa).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['buildx', 'create', '--use', '--driver', 'docker-container']),
    );
  });

  it('exits when builder creation fails', async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce(execaResult({ stdout: '25.0.0' }))
      .mockResolvedValueOnce(execaResult({ stdout: 'v0.12.0' }))
      .mockResolvedValueOnce(execaResult({ stdout: 'NAME\ndefault docker' }))
      .mockRejectedValueOnce(new Error('permission denied'));

    await expect(checkDockerReadiness()).rejects.toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// The long-running docker process is simulated with a Promise that never resolves so it stays
// alive while readiness polling runs; pipeToLog safely no-ops on null streams.
function mockDockerProc(): ResultPromise {
  const proc = Object.assign(new Promise<never>(() => {}), { stdout: null, stderr: null });
  return proc as unknown as ResultPromise;
}

describe('runRouterContainer', () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'demo-router-'));
    logPath = path.join(tmpDir, 'demo.log');
    silenceOutput();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns success when the router becomes ready', async () => {
    vi.mocked(execa).mockResolvedValueOnce(execaResult()).mockReturnValueOnce(mockDockerProc());

    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));

    const controller = new AbortController();
    const result = await runRouterContainer({
      routerToken: 'test-token',
      routerBaseUrl: 'http://localhost:3002',
      signal: controller.signal,
      logPath,
    });

    expect(result).toEqual({ error: null });
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3002/health/ready',
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('returns error when readiness check times out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    vi.mocked(execa).mockResolvedValueOnce(execaResult()).mockReturnValueOnce(mockDockerProc());

    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));

    const controller = new AbortController();
    const promise = runRouterContainer({
      routerToken: 'test-token',
      routerBaseUrl: 'http://localhost:3002',
      signal: controller.signal,
      logPath,
    });

    await vi.advanceTimersByTimeAsync(65_000);
    const result = await promise;

    expect(result.error?.message).toContain('timed out');

    vi.useRealTimers();
  });

  it('removes any stale router container before starting a new one', async () => {
    vi.mocked(execa).mockResolvedValueOnce(execaResult()).mockReturnValueOnce(mockDockerProc());

    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));

    const controller = new AbortController();
    await runRouterContainer({
      routerToken: 'test-token',
      routerBaseUrl: 'http://localhost:3002',
      signal: controller.signal,
      logPath,
    });

    expect(execa).toHaveBeenCalledWith('docker', ['rm', '-f', 'cosmo-router']);
  });
});

describe('publishAllPlugins', () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'demo-publish-'));
    logPath = path.join(tmpDir, 'demo.log');
    silenceOutput();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('publishes all configured plugins sequentially', async () => {
    vi.mocked(readPluginFiles).mockResolvedValue({} as never);
    vi.mocked(publishPluginPipeline).mockResolvedValue({ error: null });

    const result = await publishAllPlugins({
      client: {} as Client,
      supportDir: tmpDir,
      signal: new AbortController().signal,
      logPath,
    });

    expect(result).toEqual({ error: null });
    expect(publishPluginPipeline).toHaveBeenCalledTimes(2);
  });

  it('stops and returns the error when the first plugin fails', async () => {
    vi.mocked(readPluginFiles).mockResolvedValue({} as never);
    vi.mocked(publishPluginPipeline).mockResolvedValueOnce({ error: new Error('build failed') });

    const result = await publishAllPlugins({
      client: {} as Client,
      supportDir: tmpDir,
      signal: new AbortController().signal,
      logPath,
    });

    expect(result.error?.message).toBe('build failed');
    expect(publishPluginPipeline).toHaveBeenCalledTimes(1);
  });
});

describe('getDemoLogPath', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'demo-log-'));
    mocks.cacheDir = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the demo.log path under cacheDir', () => {
    expect(getDemoLogPath()).toBe(path.join(tmpDir, 'demo', 'demo.log'));
  });

  it('creates the demo directory when missing', () => {
    const result = getDemoLogPath();
    expect(existsSync(path.dirname(result))).toBe(true);
  });
});
