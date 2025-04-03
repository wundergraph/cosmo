import { ApolloClient, InMemoryCache, createHttpLink } from '@apollo/client/core';
import { gql } from '@apollo/client/core';
import {BatchHttpLink} from "@apollo/client/link/batch-http";

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

    console.log(JSON.stringify(response, null, 2));
  });
});