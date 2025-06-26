import { describe, expect, it } from 'vitest';
import { compileGraphQLToProto } from '../../src';
import { expectValidProto } from '../util';

describe('SDL to Proto Custom Queries', () => {
  it('should convert GraphQL custom queries to Proto', () => {
    const sdl = `
      type User {
        id: ID!
        name: String
        details: UserDetails
      }

      type UserDetails {
        age: Int
      }

      type Query {
        user(
          id: ID!
        ): User
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

    const { proto: protoText, lockData } = compileGraphQLToProto(sdl, { excludeRootQuery: true, customQueries: [query] , includeComments: false});

    // Validate Proto definition
    expectValidProto(protoText);
    expect(lockData).toMatchInlineSnapshot(`
      {
        "enums": {},
        "messages": {
          "QueryTestQueryUserRequest": {
            "fields": {
              "id": 1,
            },
          },
          "QueryTestQueryUserResponse": {
            "fields": {
              "details": 3,
              "id": 1,
              "name": 2,
            },
          },
          "QueryTestQueryUserUserDetails": {
            "fields": {
              "age": 1,
            },
          },
        },
        "version": "1.0.0",
      }
    `);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      option go_package = "cosmo/pkg/proto/service.v1;servicev1";

      service DefaultService {
        rpc QueryTestQueryUser(QueryTestQueryUserRequest) returns (QueryTestQueryUserResponse) {}
      }

      message QueryTestQueryUserRequest {
        string id = 1;
      }

      message QueryTestQueryUserResponse {
        string id = 1;
        string name = 2;
        QueryTestQueryUserUserDetails details = 3;
      }

      message QueryTestQueryUserUserDetails {
        int32 age = 1;
      }"
    `);
  });
});
