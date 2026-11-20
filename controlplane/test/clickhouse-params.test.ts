import { describe, expect, test } from 'vitest';
import { serializeClickHouseParam } from '../src/core/clickhouse/params.js';

describe('serializeClickHouseParam', () => {
  test('escapes backslashes and control characters in strings, which ClickHouse parses in escaped format', () => {
    expect(serializeClickHouseParam('a\\b')).toBe('a\\\\b');
    expect(serializeClickHouseParam('tab\tline\nret\r')).toBe('tab\\tline\\nret\\r');
    expect(serializeClickHouseParam("it's")).toBe("it's");
    expect(serializeClickHouseParam('ü€😀')).toBe('ü€😀');
  });

  test('writes numbers and booleans as text', () => {
    expect(serializeClickHouseParam(42)).toBe('42');
    expect(serializeClickHouseParam(1.5)).toBe('1.5');
    expect(serializeClickHouseParam(true)).toBe('true');
  });

  test('quotes and escapes every element of a string array', () => {
    expect(serializeClickHouseParam(['a', "it's", 'x\\y', 'tab\t', 'ü'])).toBe("['a','it\\'s','x\\\\y','tab\\t','ü']");
    expect(serializeClickHouseParam([])).toBe('[]');
  });

  test('writes number arrays unquoted', () => {
    expect(serializeClickHouseParam([1, 2.5, 3])).toBe('[1,2.5,3]');
  });
});
