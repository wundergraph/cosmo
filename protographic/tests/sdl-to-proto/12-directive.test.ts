import { describe, expect, it } from 'vitest';
import { compileGraphQLToProto } from '../../src';
import { expectValidProto } from '../util';

describe('SDL to Proto Directive', () => {
  it('should correctly include a deprecation field option on a field', () => {
    const sdl = `
            type User {
                id: ID!
                firstName: String! @deprecated(reason: "This field is deprecated")
                lastName: String!
            }
        `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
      }


      message User {
        string id = 1;
        // Deprecated: This field is deprecated
        string first_name = 2 [deprecated = true];
        string last_name = 3;
      }"
    `);
  });

  it('should correctly include a deprecation field option on an interface', () => {
    const sdl = `
            scalar DateTime

            interface Node {
                id: ID!
                createdAt: DateTime! @deprecated(reason: "This field is deprecated")
                updatedAt: DateTime!
            }

            type User implements Node {
                id: ID!
                createdAt: DateTime!
                updatedAt: DateTime!
            }
        `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
      }


      message Node {
        oneof instance {
        User user = 1;
        }
      }

      message User {
        string id = 1;
        // Deprecated: This field is deprecated
        string created_at = 2 [deprecated = true];
        string updated_at = 3;
      }"
    `);
  });

  it('should correctly prioritize the reason of the field over the interface', () => {
    const sdl = `
            scalar DateTime

            interface Node {
                id: ID!
                createdAt: DateTime! @deprecated(reason: "This field is deprecated")
                updatedAt: DateTime!
            }

            type User implements Node {
                id: ID!
                createdAt: DateTime! @deprecated(reason: "This field is deprecated on the field")
                updatedAt: DateTime!
            }
        `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
      }


      message Node {
        oneof instance {
        User user = 1;
        }
      }

      message User {
        string id = 1;
        // Deprecated: This field is deprecated on the field
        string created_at = 2 [deprecated = true];
        string updated_at = 3;
      }"
    `);
  });

  it('should write a comment when the reason on the field is empty but the interface has a reason', () => {
    const sdl = `
            scalar DateTime

            interface Node {
                id: ID!
                createdAt: DateTime! @deprecated(reason: "This field is deprecated on the interface")
                updatedAt: DateTime!
            }

            type User implements Node {
                id: ID!
                createdAt: DateTime! @deprecated
                updatedAt: DateTime!
            }
        `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
      }


      message Node {
        oneof instance {
        User user = 1;
        }
      }

      message User {
        string id = 1;
        // Deprecated: This field is deprecated on the interface
        string created_at = 2 [deprecated = true];
        string updated_at = 3;
      }"
    `);
  });

  it('should correctly include a deprecation option on an enum element', () => {
    const sdl = `
            enum UserRole {
                ADMIN @deprecated(reason: "This role is deprecated")
                USER
                GUEST @deprecated(reason: "This role is deprecated")
            }
        `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
      }


      enum UserRole {
        USER_ROLE_UNSPECIFIED = 0;
        // Deprecated: This role is deprecated
        USER_ROLE_ADMIN = 1 [deprecated = true];
        USER_ROLE_USER = 2;
        // Deprecated: This role is deprecated
        USER_ROLE_GUEST = 3 [deprecated = true];
      }"
    `);
  });

  it('should not write a comment if the reason is empty', () => {
    const sdl = `
      enum UserRole {
          ADMIN @deprecated(reason: "This role is deprecated")
          USER
          GUEST @deprecated(reason: "")
      }
  `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      // Service definition for DefaultService
      service DefaultService {
      }


      enum UserRole {
        USER_ROLE_UNSPECIFIED = 0;
        // Deprecated: This role is deprecated
        USER_ROLE_ADMIN = 1 [deprecated = true];
        USER_ROLE_USER = 2;
        USER_ROLE_GUEST = 3 [deprecated = true];
      }"
    `);
  });
});
