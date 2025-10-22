import { describe, expect, it } from 'vitest';
import { compileGraphQLToMapping } from '../../src';

describe('SDL to Mapping Field Resolvers', () => {
  it('should correctly handle field resolvers', () => {
    const sdl = `
            type Query {
                user(id: ID!): User!
            }
            
            type User {
                id: ID!
                name: String!
                post(upper: Boolean!): Post! @connect__fieldResolver(context: "id name")
            }

            type Post {
                id: ID!
                title: String!
            }
        `;

    const mappingText = compileGraphQLToMapping(sdl);

    expect(mappingText.toJson()).toMatchInlineSnapshot(`
      {
        "operationMappings": [
          {
            "mapped": "QueryUser",
            "original": "user",
            "request": "QueryUserRequest",
            "response": "QueryUserResponse",
            "type": "OPERATION_TYPE_QUERY",
          },
        ],
        "resolveMappings": [
          {
            "lookupMapping": {
              "fieldMapping": {
                "argumentMappings": [
                  {
                    "mapped": "upper",
                    "original": "upper",
                  },
                ],
                "mapped": "post",
                "original": "post",
              },
              "type": "User",
            },
            "request": "ResolveUserPostRequest",
            "response": "ResolveUserPostResponse",
            "rpc": "ResolveUserPost",
            "type": "LOOKUP_TYPE_RESOLVE",
          },
        ],
        "service": "DefaultService",
        "typeFieldMappings": [
          {
            "fieldMappings": [
              {
                "argumentMappings": [
                  {
                    "mapped": "id",
                    "original": "id",
                  },
                ],
                "mapped": "user",
                "original": "user",
              },
            ],
            "type": "Query",
          },
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
                "argumentMappings": [
                  {
                    "mapped": "upper",
                    "original": "upper",
                  },
                ],
                "mapped": "post",
                "original": "post",
              },
            ],
            "type": "User",
          },
          {
            "fieldMappings": [
              {
                "mapped": "id",
                "original": "id",
              },
              {
                "mapped": "title",
                "original": "title",
              },
            ],
            "type": "Post",
          },
        ],
        "version": 1,
      }
    `);
  });
});
