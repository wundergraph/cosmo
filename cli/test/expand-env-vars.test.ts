/* eslint-disable no-template-curly-in-string */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { expandEnvVars } from '../src/commands/router/commands/compose.js';

describe('expandEnvVars', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('replaces ${VAR} with environment variable value', () => {
    process.env.TEST_VAR = 'hello';
    expect(expandEnvVars('${TEST_VAR}')).toBe('hello');
  });

  test('replaces missing variable with empty string', () => {
    delete process.env.NONEXISTENT_VAR;
    expect(expandEnvVars('${NONEXISTENT_VAR}')).toBe('');
  });

  test('handles multiple variables in one string', () => {
    process.env.VAR1 = 'foo';
    process.env.VAR2 = 'bar';
    expect(expandEnvVars('${VAR1} and ${VAR2}')).toBe('foo and bar');
  });

  test('handles adjacent variables', () => {
    process.env.A = 'hello';
    process.env.B = 'world';
    expect(expandEnvVars('${A}${B}')).toBe('helloworld');
  });

  test('preserves text without variables', () => {
    expect(expandEnvVars('no variables here')).toBe('no variables here');
  });

  test('does not expand bare $VAR without braces', () => {
    process.env.FOO = 'bar';
    expect(expandEnvVars('$FOO')).toBe('$FOO');
  });

  test('does not expand nested ${FOO${BAR}}', () => {
    process.env.BAR = 'baz';
    // Matches ${FOO${BAR} (up to first }), looks up "FOO${BAR" which is undefined
    expect(expandEnvVars('${FOO${BAR}}')).toBe('}');
  });

  test('handles variable in Authorization header context', () => {
    process.env.API_TOKEN = 'secret123';
    const input = `headers:
  Authorization: "Bearer \${API_TOKEN}"`;
    const expected = `headers:
  Authorization: "Bearer secret123"`;
    expect(expandEnvVars(input)).toBe(expected);
  });
});
