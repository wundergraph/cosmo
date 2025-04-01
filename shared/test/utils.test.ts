import { expect, test, describe } from 'vitest';
import { normalizeURL } from '../src';

describe('normalizeURL', () => {
  test.each([
    {
      input: 'https://localhost:3000?test=1',
      expected: 'https://localhost:3000',
    },
    {
      input: 'https://localhost:3000/?',
      expected: 'https://localhost:3000/',
    },
    {
      input: 'https://localhost:3000/?##',
      expected: 'https://localhost:3000/',
    },
    {
      input: 'https://localhost:3000?',
      expected: 'https://localhost:3000',
    },
    {
      input: 'https://localhost:3000?#',
      expected: 'https://localhost:3000',
    },
    {
      input: 'https://subdomain.example.com/test/#fragment/',
      expected: 'https://subdomain.example.com/test/',
    },
    {
      input: 'https://subdomain.example.com/test#fragment/',
      expected: 'https://subdomain.example.com/test',
    },
    {
      input: 'https://example.com/a/b/c/d?query=123#fragment',
      expected: 'https://example.com/a/b/c/d',
    },
    {
      input: 'localhost:3000',
      expected: 'localhost:3000',
    },
    {
      input: 'localhost:3000/test',
      expected: 'localhost:3000/test',
    },
    {
      input: 'http://example.com',
      expected: 'http://example.com',
    },
    {
      input: 'ws://example.com',
      expected: 'ws://example.com',
    },
    {
      input: 'ftp://example.com',
      expected: 'ftp://example.com',
    },
  ])('should normalize $input', ({ input, expected }) => {
    expect(normalizeURL(input)).toBe(expected);
  });

  test.each([
    'invalid url',
    '//localhost:3000',
    '/?',
    '/############'
  ])('should throw for invalid url: %s', (input) => {
    expect(() => normalizeURL(input)).toThrowError();
  });

  test('should normalize url with long fragment', () => {
    let url = 'https://example.com/#';
    for (let i = 0; i < 3000; i++) {
      url += 'a';
    }

    const result = normalizeURL(url);
    expect(result).toBe('https://example.com/');
  });
});
