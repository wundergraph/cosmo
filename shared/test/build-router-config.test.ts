import { describe, expect, test } from 'vitest';
import { buildRouterConfig, Input } from '../src';

describe('Router compatibility version tests', () => {
  test('that an invalid router compatibility version throws an error', () => {
    const input = {
      routerCompatibilityVersion: '1',
    } as Input;
    expect(() => buildRouterConfig(input)).toThrowError('Invalid router compatibility version "1".');
  });

  test('that "v1" is a valid router compatibility version', () => {
    const input = {
      routerCompatibilityVersion: 'v1',
      subgraphs: [{}],
    } as Input;
    expect(() => buildRouterConfig(input)).toThrowError('Normalization failed to return a ConfigurationDataByTypeName.');
  });
});
