import { buildSchema } from 'graphql';
import { describe, expect, it } from 'vitest';

import {
  classifyDeferAdvisorResponse,
  DeferAdvisorRequestGuard,
  prepareDeferAdvisorRequest,
} from './defer-advisor-request';

const schema = buildSchema(/* GraphQL */ `
  type Query {
    product(id: ID!): Product
  }

  type Mutation {
    updateProduct(id: ID!): Product
  }

  type Subscription {
    productUpdated: Product
  }

  type Product {
    id: ID!
    name: String!
  }
`);

describe('prepareDeferAdvisorRequest', () => {
  it('selects the named query and includes its variables in the request', () => {
    const prepared = prepareDeferAdvisorRequest({
      schema,
      query: /* GraphQL */ `
        query First($id: ID!) {
          product(id: $id) {
            id
          }
        }
        query Second($id: ID!) {
          product(id: $id) {
            name
          }
        }
      `,
      operationName: 'Second',
      serializedVariables: '{"id":"2"}',
    });

    expect(prepared).toEqual({
      ok: true,
      body: {
        query: expect.stringContaining('query Second'),
        operationName: 'Second',
        variables: { id: '2' },
      },
      operationName: 'Second',
    });
  });

  it.each([
    {
      name: 'invalid variables JSON',
      query: 'query Selected($id: ID!) { product(id: $id) { id } }',
      operationName: 'Selected',
      variables: '{',
      message: 'Variables must be valid JSON.',
    },
    {
      name: 'non-object variables',
      query: 'query Selected($id: ID!) { product(id: $id) { id } }',
      operationName: 'Selected',
      variables: '[]',
      message: 'Variables must be a JSON object.',
    },
    {
      name: 'missing required variables',
      query: 'query Selected($id: ID!) { product(id: $id) { id } }',
      operationName: 'Selected',
      variables: '{}',
      message: 'Variable "$id" of required type "ID!" was not provided.',
    },
    {
      name: 'unknown named operation',
      query: 'query Selected { product(id: "1") { id } }',
      operationName: 'Missing',
      variables: '{}',
      message: 'Unknown operation "Missing".',
    },
    {
      name: 'ambiguous operation',
      query: 'query First { product(id: "1") { id } } query Second { product(id: "2") { id } }',
      operationName: undefined,
      variables: '{}',
      message: 'Select a query operation to analyze.',
    },
    {
      name: 'mutation',
      query: 'mutation Selected { updateProduct(id: "1") { id } }',
      operationName: 'Selected',
      variables: '{}',
      message: 'Defer Advisor supports query operations only; "Selected" is a mutation.',
    },
    {
      name: 'subscription',
      query: 'subscription Selected { productUpdated { id } }',
      operationName: 'Selected',
      variables: '{}',
      message: 'Defer Advisor supports query operations only; "Selected" is a subscription.',
    },
  ])('blocks $name before transport', ({ query, operationName, variables, message }) => {
    expect(
      prepareDeferAdvisorRequest({
        schema,
        query,
        operationName,
        serializedVariables: variables,
      }),
    ).toEqual({ ok: false, message });
  });
});

describe('classifyDeferAdvisorResponse', () => {
  it('returns advisor data on success', () => {
    const result = { runs: 1 };
    expect(
      classifyDeferAdvisorResponse({
        status: 200,
        statusText: 'OK',
        payload: { extensions: { deferAdvisor: result } },
      }),
    ).toEqual({ kind: 'success', result });
  });

  it.each([
    {
      name: 'client rejection',
      status: 403,
      statusText: 'Forbidden',
      payload: { errors: [{ message: 'Tracing is disabled' }] },
      message: 'Tracing is disabled',
    },
    {
      name: 'unsupported router',
      status: 200,
      statusText: 'OK',
      payload: { data: {} },
      message: 'The router did not return Defer Advisor data.',
    },
  ])('marks $name as permanent so polling can stop', ({ status, statusText, payload, message }) => {
    expect(classifyDeferAdvisorResponse({ status, statusText, payload })).toEqual({
      kind: 'permanent-error',
      message,
    });
  });

  it('keeps server failures retryable', () => {
    expect(
      classifyDeferAdvisorResponse({
        status: 503,
        statusText: 'Service Unavailable',
        payload: { errors: [{ message: 'Temporarily unavailable' }] },
      }),
    ).toEqual({ kind: 'retryable-error', message: 'Temporarily unavailable' });
  });
});

describe('DeferAdvisorRequestGuard', () => {
  it('aborts a superseded request and rejects its late result', () => {
    const guard = new DeferAdvisorRequestGuard();
    const first = guard.start();
    const second = guard.start();

    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(second.signal.aborted).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it('aborts and invalidates the active request during cleanup', () => {
    const guard = new DeferAdvisorRequestGuard();
    const request = guard.start();

    guard.invalidate();

    expect(request.signal.aborted).toBe(true);
    expect(request.isCurrent()).toBe(false);
  });
});
