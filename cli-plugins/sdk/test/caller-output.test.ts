import { afterEach, describe, expect, test } from 'vitest';
import {
  createCredentials,
  createOutput,
  createPluginContext,
  detectCaller,
  prefersJson,
  readOutputOverride,
} from '../src/index.js';

const capture = () => {
  const chunks: string[] = [];
  return { stream: { write: (chunk: string) => chunks.push(chunk) }, text: () => chunks.join('') };
};

afterEach(() => {
  process.exitCode = undefined;
});

describe('detectCaller', () => {
  test('a CI job wins over everything else', () => {
    expect(detectCaller({ GITHUB_ACTIONS: 'true', CLAUDECODE: '1' }, true)).toBe('ci');
    expect(detectCaller({ CI: '1' }, true)).toBe('ci');
  });

  test('a recognized agent harness is an agent even in a terminal', () => {
    expect(detectCaller({ CLAUDECODE: '1' }, true)).toBe('agent');
  });

  test('a terminal without signals is a human, anything else a script', () => {
    expect(detectCaller({}, true)).toBe('human');
    expect(detectCaller({}, false)).toBe('script');
    expect(detectCaller({ CI: 'false' }, true)).toBe('human');
  });

  test('only humans get readable output by default', () => {
    expect([prefersJson('human'), prefersJson('agent'), prefersJson('ci'), prefersJson('script')]).toEqual([
      false,
      true,
      true,
      true,
    ]);
  });
});

describe('createOutput', () => {
  test('JSON mode keeps progress on stderr as events and the result envelope alone on stdout', () => {
    const stdout = capture();
    const stderr = capture();
    const output = createOutput({ json: true, stdout: stdout.stream, stderr: stderr.stream });

    output.progress({ step: 'compile', subject: 'router', message: 'Compiling router' });
    output.message('Launching sandbox', { event: 'operation', id: 'op_1' });
    output.message('only for people');
    output.result({ path: '/tmp/router' }, (data) => `Built ${data.path}`, {
      url: 'https://hub.example/op_1',
      next: [{ command: 'wgc hub open', description: 'open the sandbox in Hub' }],
    });

    expect(stdout.text()).toBe(
      '{"ok":true,"data":{"path":"/tmp/router"},"url":"https://hub.example/op_1","next":["wgc hub open"]}\n',
    );
    expect(stderr.text()).toBe(
      '{"event":"progress","step":"compile","subject":"router","message":"Compiling router"}\n' +
        '{"event":"operation","id":"op_1"}\n',
    );
  });

  test('a write that changed nothing says so in the envelope', () => {
    const stdout = capture();
    const output = createOutput({ json: true, stdout: stdout.stream, stderr: capture().stream });

    output.result({ sandboxId: 'sb_1' }, () => '', { changed: false });

    expect(stdout.text()).toBe('{"ok":true,"changed":false,"data":{"sandboxId":"sb_1"}}\n');
  });

  test('human mode renders the result and the next commands on stdout and messages on stderr', () => {
    const stdout = capture();
    const stderr = capture();
    const output = createOutput({ json: false, stdout: stdout.stream, stderr: stderr.stream });

    output.message('Launching sandbox "shop-nithin"');
    output.result({ url: 'https://sb.example/graphql' }, (data) => `Sandbox ready  ${data.url}`, {
      next: [
        { command: 'wgc hub collection run smoke', description: 'run your saved operations' },
        { command: 'wgc hub open', description: 'open the sandbox in Hub' },
      ],
    });

    expect(stdout.text()).toBe(
      [
        'Sandbox ready  https://sb.example/graphql',
        '',
        'Next',
        '  wgc hub collection run smoke      run your saved operations',
        '  wgc hub open                      open the sandbox in Hub',
        '',
      ].join('\n'),
    );
    expect(stderr.text()).toBe('Launching sandbox "shop-nithin"\n');
  });

  test('a coded failure prints the error block on stderr with its fix and docs, and exits 1', () => {
    const stdout = capture();
    const stderr = capture();
    const output = createOutput({ json: false, stdout: stdout.stream, stderr: stderr.stream });

    output.fail({
      code: 'FORGE_SOURCE_UNREACHABLE',
      message: 'Forge could not fetch https://payments.internal/graphql (timeout after 10s).',
      remediation: "payments.internal is not on this sandbox's egress allowlist.",
      next: ['wgc hub sandbox egress allow payments.internal'],
      docs: 'https://cosmo-docs.wundergraph.com/errors/FORGE_SOURCE_UNREACHABLE',
    });

    expect(stdout.text()).toBe('');
    expect(stderr.text()).toBe(
      [
        'error FORGE_SOURCE_UNREACHABLE',
        '  Forge could not fetch https://payments.internal/graphql (timeout after 10s).',
        "  payments.internal is not on this sandbox's egress allowlist.",
        '',
        '  Fix   wgc hub sandbox egress allow payments.internal',
        '  Docs  https://cosmo-docs.wundergraph.com/errors/FORGE_SOURCE_UNREACHABLE',
        '',
      ].join('\n'),
    );
    expect(process.exitCode).toBe(1);
  });

  test('a usage failure prints a short error with the flag to pass, and exits 2', () => {
    const stderr = capture();
    const output = createOutput({ json: false, stdout: capture().stream, stderr: stderr.stream });

    output.fail({
      kind: 'usage',
      message: 'sandbox.yaml not found in /work/shop or any parent directory.',
      remediation: 'Run `wgc hub sandbox launch --init-from-graph shop` to create one, or pass --config <path>.',
    });

    expect(stderr.text()).toBe(
      'error: sandbox.yaml not found in /work/shop or any parent directory.\n' +
        'Run `wgc hub sandbox launch --init-from-graph shop` to create one, or pass --config <path>.\n',
    );
    expect(process.exitCode).toBe(2);
  });

  test('each failure kind has its own exit code', () => {
    const exitCodes = (['failed', 'usage', 'findings', 'unauthenticated', 'confirmation', 'interrupted'] as const).map(
      (kind) => {
        createOutput({ json: true, stdout: capture().stream, stderr: capture().stream }).fail({ kind, message: 'x' });
        return process.exitCode;
      },
    );

    expect(exitCodes).toEqual([1, 2, 3, 4, 5, 130]);
  });

  test('JSON failures carry the code, remediation, fix, data and url', () => {
    const stdout = capture();
    const output = createOutput({ json: true, stdout: stdout.stream, stderr: capture().stream });

    output.fail({
      kind: 'findings',
      message: 'The check found 1 blocking finding(s).',
      remediation: 'Repair each finding.',
      next: ['wgc forge check'],
      data: { issues: [{ rule: 'a' }] },
      url: 'https://hub.example/op_9',
    });

    expect(JSON.parse(stdout.text())).toEqual({
      ok: false,
      error: {
        code: 'CHECK_FAILED',
        message: 'The check found 1 blocking finding(s).',
        remediation: 'Repair each finding.',
        next: ['wgc forge check'],
      },
      data: { issues: [{ rule: 'a' }] },
      url: 'https://hub.example/op_9',
    });
    expect(process.exitCode).toBe(3);
  });

  test('people see a failure that renders its data on stdout instead of the error block', () => {
    const stdout = capture();
    const stderr = capture();
    const output = createOutput({ json: false, stdout: stdout.stream, stderr: stderr.stream });

    output.fail({ kind: 'findings', message: '1 failed', data: { failed: 1 } }, (data) => `${data.failed} failed`);

    expect(stdout.text()).toBe('1 failed\n');
    expect(stderr.text()).toBe('');
    expect(process.exitCode).toBe(3);
  });
});

const contextFor = (caller: 'human' | 'agent', outputOverride?: 'json' | 'text') =>
  createPluginContext({
    cliVersion: '0',
    command: 'wgc',
    homeDir: '/nonexistent/.wgc',
    caller,
    endpoints: { cosmoApiUrl: '', cosmoWebUrl: '', hubUrl: '', hubAppUrl: '', wgcInstallArgs: 'wgc@latest' },
    credentials: createCredentials({ env: {}, loginToken: () => Promise.resolve(undefined) }),
    outputOverride,
  });

describe('createPluginContext output choice', () => {
  test('WGC_OUTPUT overrides caller detection and --json overrides WGC_OUTPUT', () => {
    expect(readOutputOverride({ WGC_OUTPUT: 'text' })).toBe('text');
    expect(readOutputOverride({ WGC_OUTPUT: 'yaml' })).toBe(undefined);
    expect(contextFor('agent', 'text').output({}).json).toBe(false);
    expect(contextFor('human', 'json').output({}).json).toBe(true);
    expect(contextFor('agent', 'text').output({ json: true }).json).toBe(true);
    expect(contextFor('agent').output({}).json).toBe(true);
    expect(contextFor('human').output({}).json).toBe(false);
  });
});
