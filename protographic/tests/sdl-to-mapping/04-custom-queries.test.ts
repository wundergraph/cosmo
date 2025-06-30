import { describe, expect, it, test } from 'vitest';
import { compileGraphQLToMapping } from '../../src';

describe('GraphQL Custom Queries to Proto Mapping', () => {
  it('maps custom queries to Proto', () => {
    const sdl = `
      directive @key(fields: String!) on OBJECT
      
      type User @key(fields: "id") {
        id: ID!
        name: String!
        details: UserDetails!
      }

      type UserDetails {
        age: Int!
      }
      
      type Query {
        user(id: ID!): User
      }
    `;

    const query = `
      query TestQueryUser {
        user(id: "1") {
          id
          name
          details {
            age
          }
        }
      }
    `;

    const mapping = compileGraphQLToMapping(sdl, 'UserService', [query]);

    expect(mapping.toJson()).toMatchInlineSnapshot(`
      {
        "entityMappings": [
          {
            "key": "id",
            "kind": "entity",
            "request": "LookupUserByIdRequest",
            "response": "QueryTestQueryUserResponse",
            "rpc": "LookupUserById",
            "typeName": "User",
            "alias": ["QueryTestQueryUserResponse"],
          },
        ],
        "operationMappings": [
          {
            "mapped": "QueryTestQueryUser",
            "original": "user(id: \"1\") { id name details { age } }",
            "request": "QueryTestQueryUserRequest",
            "response": "QueryTestQueryUserResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
        ],
        "service": "UserService",
        "typeFieldMappings": [
          {
            "fieldMappings": [
              {
                "mapped": "id",
                "original": "id",
              },
              {
                "mapped": "name",
                "original": "name",
              },
              {
                "mapped": "details",
                "original": "details",
              },
            ],
            "mapped": "QueryTestQueryUserResponse",
            "type": "User",
          },
          {
            "fieldMappings": [
              {
                "mapped": "age",
                "original": "age",
              },
            ],
            "type": "UserDetails",
          },
        ],
        "version": 1,
      }
    `);
  });
});
