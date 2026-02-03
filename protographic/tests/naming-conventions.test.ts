import { describe, expect, it } from 'vitest';
import { normalizeKeyElements, createMethodSuffixFromEntityKey } from '../src/naming-conventions';

describe('normalizeKeyElements', () => {
  it('handles comma-separated keys', () => {
    expect(normalizeKeyElements('id,name')).toEqual(['Id', 'Name']);
  });

  it('handles space-separated keys', () => {
    expect(normalizeKeyElements('name id')).toEqual(['Id', 'Name']);
  });

  it('handles mixed separators (comma and space)', () => {
    expect(normalizeKeyElements('id, name')).toEqual(['Id', 'Name']);
  });

  it('removes duplicates', () => {
    expect(normalizeKeyElements('name id name')).toEqual(['Id', 'Name']);
  });

  it('sorts keys alphabetically', () => {
    expect(normalizeKeyElements('name,id')).toEqual(['Id', 'Name']);
  });

  it('converts snake_case to PascalCase', () => {
    expect(normalizeKeyElements('user_id')).toEqual(['UserId']);
  });

  it('handles single element', () => {
    expect(normalizeKeyElements('id')).toEqual(['Id']);
  });

  it('handles multiple snake_case words', () => {
    expect(normalizeKeyElements('first_name last_name')).toEqual(['FirstName', 'LastName']);
  });

  it('handles camelCase input', () => {
    expect(normalizeKeyElements('userId')).toEqual(['UserId']);
  });

  it('handles multiple keys with various separators', () => {
    expect(normalizeKeyElements('a, b c,d')).toEqual(['A', 'B', 'C', 'D']);
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
