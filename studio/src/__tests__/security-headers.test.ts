// @vitest-environment node
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { matchHas } from 'next/dist/shared/lib/router/utils/prepare-destination';
import { describe, expect, test } from 'vitest';
import { securityHeaders } from '../../security-headers.mjs';

const csp = { key: 'Content-Security-Policy', value: "object-src 'none';  base-uri 'self';  " };

/** The headers Next sends for a request, matching each rule the way its router does. */
const responseHeaders = (hubUrl: string | undefined, url: string) => {
  const { pathname, searchParams } = new URL(url, 'https://studio.example.com');
  const query = Object.fromEntries(searchParams);
  const request = new IncomingMessage(new Socket());
  const headers: Record<string, string> = {};

  for (const rule of securityHeaders({ csp, hubUrl })) {
    const matchesPath = getPathMatch(rule.source, { strict: true, removeUnnamedParams: true })(pathname);
    if (matchesPath && matchHas(request, query, rule.has, rule.missing)) {
      for (const { key, value } of rule.headers) {
        headers[key] = value;
      }
    }
  }

  return headers;
};

const unframable = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "object-src 'none';  base-uri 'self';  ",
};

describe('security headers', () => {
  test('Hub may frame a page requested with embed=1', () => {
    expect(responseHeaders('https://hub.example.com/app/', '/acme/members?embed=1')).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "object-src 'none';  base-uri 'self'; frame-ancestors https://hub.example.com;",
    });
    expect(responseHeaders('https://hub.example.com', '/acme/settings?tab=general&embed=1')).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "object-src 'none';  base-uri 'self'; frame-ancestors https://hub.example.com;",
    });
  });

  test('pages requested without embed=1 refuse framing', () => {
    expect(responseHeaders('https://hub.example.com', '/acme/members')).toEqual(unframable);
    expect(responseHeaders('https://hub.example.com', '/acme/members?embed=true')).toEqual(unframable);
    expect(responseHeaders('https://hub.example.com', '/')).toEqual(unframable);
  });

  test('/embed/session refuses framing even with embed=1', () => {
    expect(responseHeaders('https://hub.example.com', '/embed/session?embed=1')).toEqual(unframable);
    expect(responseHeaders('https://hub.example.com', '/embed/session/?embed=1')).toEqual(unframable);
    expect(responseHeaders('https://hub.example.com', '/Embed/Session?embed=1')).toEqual(unframable);
  });

  test('without a Hub URL nothing is framable', () => {
    expect(responseHeaders(undefined, '/acme/members?embed=1')).toEqual(unframable);
    expect(responseHeaders('', '/acme/members?embed=1')).toEqual(unframable);
    expect(responseHeaders('not a url', '/acme/members?embed=1')).toEqual(unframable);
  });

  test('a Docker image names its placeholder, which the entrypoint swaps for the runtime Hub URL', () => {
    expect(responseHeaders('APP_NEXT_HUB_URL', '/acme/members?embed=1')['Content-Security-Policy']).toBe(
      "object-src 'none';  base-uri 'self'; frame-ancestors APP_NEXT_HUB_URL;",
    );
    expect(responseHeaders('APP_NEXT_HUB_URL', '/acme/members')).toEqual(unframable);
  });
});
