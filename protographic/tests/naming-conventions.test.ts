import { describe, expect, it } from 'vitest';
import { formatKeyElements, createMethodSuffixFromEntityKey } from '../src/naming-conventions.js';

describe('formatKeyElements', () => {
  it('handles comma-separated keys', () => {
    expect(formatKeyElements('id,name')).toEqual(['Id', 'Name']);
  });

  it('handles space-separated keys', () => {
    expect(formatKeyElements('name id')).toEqual(['Id', 'Name']);
  });

  it('handles mixed separators (comma and space)', () => {
    expect(formatKeyElements('id, name')).toEqual(['Id', 'Name']);
  });

  it('removes duplicates', () => {
    expect(formatKeyElements('name id name')).toEqual(['Id', 'Name']);
  });

  it('sorts keys alphabetically', () => {
    expect(formatKeyElements('name,id')).toEqual(['Id', 'Name']);
  });

  it('converts snake_case to PascalCase', () => {
    expect(formatKeyElements('user_id')).toEqual(['UserId']);
  });

  it('handles single element', () => {
    expect(formatKeyElements('id')).toEqual(['Id']);
  });

  it('handles multiple snake_case words', () => {
    expect(formatKeyElements('first_name last_name')).toEqual(['FirstName', 'LastName']);
  });

  it('handles camelCase input', () => {
    expect(formatKeyElements('userId')).toEqual(['UserId']);
  });

  it('handles multiple keys with various separators', () => {
    expect(formatKeyElements('a, b c,d')).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('createMethodSuffixFromEntityKey', () => {
  it('uses default parameter when no argument provided', () => {
    expect(createMethodSuffixFromEntityKey()).toBe('ById');
  });

  it('handles single key', () => {
    expect(createMethodSuffixFromEntityKey('id')).toBe('ById');
  });

  it('joins multiple comma-separated keys with And', () => {
    expect(createMethodSuffixFromEntityKey('id,name')).toBe('ByIdAndName');
  });

  it('sorts keys alphabetically before joining', () => {
    expect(createMethodSuffixFromEntityKey('name,id')).toBe('ByIdAndName');
  });

  it('handles space-separated keys', () => {
    expect(createMethodSuffixFromEntityKey('id name')).toBe('ByIdAndName');
  });

  it('converts snake_case keys to PascalCase', () => {
    expect(createMethodSuffixFromEntityKey('user_id')).toBe('ByUserId');
  });

  it('handles three keys', () => {
    expect(createMethodSuffixFromEntityKey('name,id,email')).toBe('ByEmailAndIdAndName');
  });

  it('handles mixed separators and duplicates', () => {
    expect(createMethodSuffixFromEntityKey('id, name id')).toBe('ByIdAndName');
  });
});
