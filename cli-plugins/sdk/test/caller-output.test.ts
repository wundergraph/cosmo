import { afterEach, describe, expect, test } from 'vitest';
import { createOutput, detectCaller, prefersJson } from '../src/index.js';

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
  test('JSON mode keeps progress on stderr as events and the result alone on stdout', () => {
    const stdout = capture();
    const stderr = capture();
    const output = createOutput({ json: true, stdout: stdout.stream, stderr: stderr.stream });

    output.progress({ step: 'compile', subject: 'router', message: 'Compiling router' });
    output.result({ path: '/tmp/router' }, (data) => `Built ${data.path}`);

    expect(stdout.text()).toBe('{"status":"success","path":"/tmp/router"}\n');
    expect(stderr.text()).toBe(
      '{"event":"progress","step":"compile","subject":"router","message":"Compiling router"}\n',
    );
  });

  test('human mode renders the result and reports failures with their fix', () => {
    const stdout = capture();
    const stderr = capture();
    const output = createOutput({ json: false, stdout: stdout.stream, stderr: stderr.stream });

    output.result({ path: '/tmp/router' }, (data) => `Built ${data.path}`);
    output.fail({ message: 'Module not found', input: 'modules[0]', fix: 'Run forge add' });

    expect(stdout.text()).toBe('Built /tmp/router\n');
    expect(stderr.text()).toContain('Module not found');
    expect(stderr.text()).toContain('fix: Run forge add');
    expect(process.exitCode).toBe(1);
  });

  test('JSON failures carry their details', () => {
    const stdout = capture();
    const output = createOutput({ json: true, stdout: stdout.stream, stderr: capture().stream });

    output.fail({ message: 'tests failed', details: { dependencyChanges: [{ module: 'a', from: 'v1', to: 'v2' }] } });

    expect(JSON.parse(stdout.text())).toEqual({
      status: 'error',
      error: { message: 'tests failed', details: { dependencyChanges: [{ module: 'a', from: 'v1', to: 'v2' }] } },
    });
  });

  test('JSON failures are structured and set the exit code', () => {
    const stdout = capture();
    const output = createOutput({ json: true, stdout: stdout.stream, stderr: capture().stream });

    output.fail({ message: 'boom', input: 'forge.yaml' });

    expect(JSON.parse(stdout.text())).toEqual({ status: 'error', error: { message: 'boom', input: 'forge.yaml' } });
    expect(process.exitCode).toBe(1);
  });
});
