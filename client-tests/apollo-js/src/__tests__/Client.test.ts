import { ApolloClient, InMemoryCache, createHttpLink, gql, Observable, ApolloError } from '@apollo/client';
import { BatchHttpLink } from '@apollo/client/link/batch-http';
import { fail } from 'assert';
import { describe, it, expect } from 'vitest';
import { Subscription } from 'zen-observable-ts';

const serverUrl = process.env.ROUTER_URL || 'http://localhost:3002/graphql';

describe('Apollo Client Tests', () => {
  it('should handle failing query', async () => {
    const client = new ApolloClient({
      link: createHttpLink({
        uri: serverUrl,
      }),
      cache: new InMemoryCache(),
    });

    const query = gql`
      query QueryFailure {
        employees {
          id
          isAvailable2
        }
      }
    `;

    try {
      await client.query({ query });
    } catch (error: any) {
      expect(error.message).toContain('field: isAvailable2 not defined on type: Employee');
    }
  });

  it('should handle successful query', async () => {
    const client = new ApolloClient({
      link: createHttpLink({
        uri: serverUrl,
      }),
      cache: new InMemoryCache(),
    });

    const query = gql`
      query QuerySuccess {
        employees {
          id
          isAvailable
        }
      }
    `;

    const result = await client.query({ query });
    expect(result.errors).toBeUndefined();
    expect(result.data?.employees).toBeDefined();
    expect(Array.isArray(result.data?.employees)).toBe(true);
    expect(result.data?.employees.length).toBeGreaterThan(0);
    expect(result.data?.employees[0]).toHaveProperty('id');
    expect(result.data?.employees[0]).toHaveProperty('isAvailable');
  });

  it('should handle batched successful queries', async () => {
    const client = new ApolloClient({
      link: new BatchHttpLink({
        uri: serverUrl,
        batchMax: 100,
        batchInterval: 700
      }),
      cache: new InMemoryCache(),
    });

    const query1 = gql`
      query QuerySuccess {
        employees {
          id
        }
      }
    `;

    const query2= gql`query QuerySuccess {
      employees {
        isAvailable
      }
    }`;

    const query3= gql`query QuerySuccess {
      employees {
        test: isAvailable
      }
    }`;

    const req1 = client.query({ query: query1 })
    const req2 = client.query({ query: query2 })
    const req3 = client.query({ query: query3 })

    const response = await Promise.all([req1, req2, req3]);

    const expectedString = `[{"data":{"employees":[{"__typename":"Employee","id":1},{"__typename":"Employee","id":2},{"__typename":"Employee","id":3},{"__typename":"Employee","id":4},{"__typename":"Employee","id":5},{"__typename":"Employee","id":7},{"__typename":"Employee","id":8},{"__typename":"Employee","id":10},{"__typename":"Employee","id":11},{"__typename":"Employee","id":12}]},"loading":false,"networkStatus":7},{"data":{"employees":[{"__typename":"Employee","isAvailable":false},{"__typename":"Employee","isAvailable":false},{"__typename":"Employee","isAvailable":false},{"__typename":"Employee","isAvailable":false},{"__typename":"Employee","isAvailable":false},{"__typename":"Employee","isAvailable":false},{"__typename":"Employee","isAvailable":false},{"__typename":"Employee","isAvailable":false},{"__typename":"Employee","isAvailable":false},{"__typename":"Employee","isAvailable":false}]},"loading":false,"networkStatus":7},{"data":{"employees":[{"__typename":"Employee","test":false},{"__typename":"Employee","test":false},{"__typename":"Employee","test":false},{"__typename":"Employee","test":false},{"__typename":"Employee","test":false},{"__typename":"Employee","test":false},{"__typename":"Employee","test":false},{"__typename":"Employee","test":false},{"__typename":"Employee","test":false},{"__typename":"Employee","test":false}]},"loading":false,"networkStatus":7}]`;
    expect(response[0].errors).toBeUndefined();
    expect(response[0].data).toBeDefined();

    expect(JSON.stringify(response)).toEqual(expectedString);
  });

  it('should handle successful subscription', async () => {
    const client = new ApolloClient({
      link: createHttpLink({
        uri: serverUrl,
      }),
      cache: new InMemoryCache(),
    });

    const subscriptionQuery = gql`
      subscription SubscriptionSuccess {
        countEmp2(max: 3, intervalMilliseconds: 500)
      }
    `;

    let receivedCount = 0;
    const subscriptionPromise = new Promise<void>((resolve, reject) => {
      const observable: Observable<any> = client.subscribe({ query: subscriptionQuery });
      const subscription: Subscription = observable.subscribe({
        next: (result: any) => {
          expect(result.errors).toBeUndefined();
          expect(result.data?.countEmp2).toBe(receivedCount);
          receivedCount++;
          
          if (receivedCount >= 4) {
            subscription.unsubscribe();
            resolve();
          }
        },
        error: (error: Error) => {
          reject(error);
        }
      });
    });

    await expect(subscriptionPromise).resolves.not.toThrow();
  });

  it('should handle failed subscription', async () => {
    const client = new ApolloClient({
      link: createHttpLink({
        uri: serverUrl,
      }),
      cache: new InMemoryCache(),
    });

    const subscriptionQuery = gql`
      subscription SubscriptionFailure {
        countEmpTest2(max: 3, intervalMilliseconds: 500)
      }
    `;

    const subscriptionPromise = new Promise<void>((resolve, reject) => {
      const observable: Observable<any> = client.subscribe({ query: subscriptionQuery });
      const subscription: Subscription = observable.subscribe({
        next: (_result: any) => {
          subscription.unsubscribe();
          resolve();
          fail("should not be called");
        },
        error: (error: ApolloError) => {
          expect(error.graphQLErrors.length).toBe(1);
          expect(error.graphQLErrors[0]).toEqual({
            "message": "field: countEmpTest2 not defined on type: Subscription",
            "path": ["subscription"],
          })
          reject(error);
        }
      });
    });

    await expect(subscriptionPromise).rejects.toThrow();
  });
});