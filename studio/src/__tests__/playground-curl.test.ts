import { buildCurlCommand } from '@/lib/playground-curl';
import { beforeEach, describe, expect, test } from 'vitest';

const url = 'https://router.example.com/graphql';
const query = 'query Employees { employees { id } }';

describe('buildCurlCommand', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('includes the url, a default content type and the operation body', () => {
    const { command, warnings } = buildCurlCommand({ url, query });

    expect(warnings).toEqual([]);
    expect(command).toBe(
      `curl '${url}' \\\n` +
        `  -H 'Content-Type: application/json' \\\n` +
        `  --data-raw '${JSON.stringify({ query })}'`,
    );
  });

  test('includes headers, variables and the operation name', () => {
    const { command } = buildCurlCommand({
      url,
      query,
      operationName: 'Employees',
      variables: '{ "id": 1 }',
      headers: '{ "Authorization": "Bearer token" }',
    });

    expect(command).toContain(`-H 'Authorization: Bearer token'`);
    expect(command).toContain(
      `--data-raw '${JSON.stringify({ query, operationName: 'Employees', variables: { id: 1 } })}'`,
    );
  });

  test('does not add a content type when the user already provided one', () => {
    const { command } = buildCurlCommand({ url, query, headers: '{ "content-type": "application/graphql" }' });

    expect(command).toContain(`-H 'content-type: application/graphql'`);
    expect(command).not.toContain('application/json');
  });

  test('escapes single quotes so the command stays valid in a shell', () => {
    const { command } = buildCurlCommand({
      url,
      query,
      headers: `{ "X-Custom": "it's here" }`,
    });

    expect(command).toContain(`-H 'X-Custom: it'\\''s here'`);
  });

  test('substitutes header placeholders from the playground env', () => {
    localStorage.setItem('playground:env', JSON.stringify({ 'graph-1': { token: 'secret' } }));

    const { command } = buildCurlCommand({
      url,
      query,
      graphId: 'graph-1',
      headers: '{ "Authorization": "Bearer {{token}}" }',
    });

    expect(command).toContain(`-H 'Authorization: Bearer secret'`);
  });

  test('appends extra headers added by the playground', () => {
    const { command } = buildCurlCommand({ url, query, extraHeaders: { 'X-Feature-Flag': 'my-flag' } });

    expect(command).toContain(`-H 'X-Feature-Flag: my-flag'`);
  });

  test('warns and skips header names that are not valid http tokens', () => {
    const { command, warnings } = buildCurlCommand({
      url,
      query,
      headers: '{ "My Header": "nope", "X-Valid": "yes" }',
    });

    expect(warnings).toEqual([
      'The following header names are not valid HTTP tokens and were excluded from the cURL command: My Header.',
    ]);
    expect(command).not.toContain('My Header');
    expect(command).toContain(`-H 'X-Valid: yes'`);
  });

  test('warns and skips malformed variables and headers', () => {
    const { command, warnings } = buildCurlCommand({ url, query, variables: '{ invalid', headers: '{ invalid' });

    expect(warnings).toEqual([
      'Variables were excluded from the cURL command: Invalid JSON.',
      'Headers were excluded from the cURL command: Invalid JSON.',
    ]);
    expect(command).toContain(`--data-raw '${JSON.stringify({ query })}'`);
  });

  test.each([
    ['an array', '[1, 2]', 'Variables were excluded from the cURL command: Expected object, received array.'],
    ['null', 'null', 'Variables were excluded from the cURL command: Expected object, received null.'],
    ['a scalar', '"nope"', 'Variables were excluded from the cURL command: Expected object, received string.'],
  ])('warns when variables are valid json but %s rather than an object', (_label, variables, warning) => {
    const { command, warnings } = buildCurlCommand({ url, query, variables });

    expect(warnings).toEqual([warning]);
    expect(command).toContain(`--data-raw '${JSON.stringify({ query })}'`);
  });

  test('keeps nested json values in the variables verbatim', () => {
    const variables = { filter: { ids: [1, 2], names: ['a'], deleted: null }, limit: 10, exact: true };
    const { command, warnings } = buildCurlCommand({ url, query, variables: JSON.stringify(variables) });

    expect(warnings).toEqual([]);
    expect(command).toContain(`--data-raw '${JSON.stringify({ query, variables })}'`);
  });

  test('coerces number and boolean header values to strings', () => {
    const { command, warnings } = buildCurlCommand({ url, query, headers: '{ "X-Retries": 3, "X-Trace": true }' });

    expect(warnings).toEqual([]);
    expect(command).toContain(`-H 'X-Retries: 3'`);
    expect(command).toContain(`-H 'X-Trace: true'`);
  });

  test('warns and skips headers whose value is not a scalar', () => {
    const { command, warnings } = buildCurlCommand({
      url,
      query,
      headers: '{ "X-Object": { "a": 1 }, "X-List": [1], "X-Null": null, "X-Valid": "yes" }',
    });

    expect(warnings).toEqual([
      'The following headers do not have a string, number or boolean value and were excluded from the cURL command: X-Object, X-List.',
    ]);
    expect(command).not.toContain('X-Object');
    expect(command).not.toContain('X-List');
    expect(command).not.toContain('X-Null');
    expect(command).toContain(`-H 'X-Valid: yes'`);
  });

  test('treats empty editors as no variables and no headers', () => {
    const { command, warnings } = buildCurlCommand({ url, query, variables: '   ', headers: '' });

    expect(warnings).toEqual([]);
    expect(command).toContain(`--data-raw '${JSON.stringify({ query })}'`);
  });
});
