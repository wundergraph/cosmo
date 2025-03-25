import { expect, test } from 'vitest';
import { normalizeURL } from '../src';

test('Normalize urls', () => {
  const urls = [
    {
      input: 'https://localhost:3000?test=1',
      expected: 'https://localhost:3000',
    },
    {
      input: 'https://localhost:3000/?',
      expected: 'https://localhost:3000',
    },
    {
      input: 'https://subdomain.example.com/test/#fragment/',
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
      input: '//localhost:3000',
      expected: 'localhost:3000',
    },
    {
      input: 'http://example.com',
      expected: 'http://example.com',
    },
    {
      input: 'telnet://192.0.2.16:80/',
      expected: 'telnet://192.0.2.16:80',
    },
  ];

  for (const u of urls) {
    const result = normalizeURL(u.input);
    expect(result).toBe(u.expected);
  }
});
