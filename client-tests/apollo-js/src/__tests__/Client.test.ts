import { ApolloClient, InMemoryCache, createHttpLink } from '@apollo/client/core';
import { gql } from '@apollo/client/core';

const serverUrl = process.env.ROUTER_URL || 'http://localhost:3002/graphql';

describe('Apollo Client Tests', () => {
  let client: ApolloClient<any>;

  beforeEach(() => {
    client = new ApolloClient({
      link: createHttpLink({
        uri: serverUrl,
      }),
      cache: new InMemoryCache(),
    });
  });

  it('should handle failing query', async () => {
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
}); 