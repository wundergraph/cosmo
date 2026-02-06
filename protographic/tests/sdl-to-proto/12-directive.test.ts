import { describe, expect, it } from 'vitest';
import { compileGraphQLToProto } from '../../src/index.js';
import { expectValidProto } from '../util.js';

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
        // Deprecation notice: This field is deprecated
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
        // Deprecation notice: This field is deprecated
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
        // Deprecation notice: This field is deprecated on the field
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
        // Deprecation notice: This field is deprecated on the interface
        string created_at = 2 [deprecated = true];
        string updated_at = 3;
      }"
    `);
  });

  it('should should ignore empty reason on field when interface has a reason', () => {
    const sdl = `
            scalar DateTime

            interface Node {
                id: ID!
                createdAt: DateTime! @deprecated(reason: "This field is deprecated on the interface")
                updatedAt: DateTime!
            }

            type User implements Node {
                id: ID!
                createdAt: DateTime! @deprecated(reason: "    ")
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
        // Deprecation notice: This field is deprecated on the interface
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
        // Deprecation notice: This role is deprecated
        USER_ROLE_ADMIN = 1 [deprecated = true];
        USER_ROLE_USER = 2;
        // Deprecation notice: This role is deprecated
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
        // Deprecation notice: This role is deprecated
        USER_ROLE_ADMIN = 1 [deprecated = true];
        USER_ROLE_USER = 2;
        USER_ROLE_GUEST = 3 [deprecated = true];
      }"
    `);
  });

  it('should correctly include a directive on a field on an input object', () => {
    const sdl = `
      input UserInput {
        id: ID!
        name: String! @deprecated(reason: "This field is deprecated")
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

      message UserInput {
        string id = 1;
        // Deprecation notice: This field is deprecated
        string name = 2 [deprecated = true];
      }"
    `);
  });

  it('should correctly handle deprecated input field with empty reason', () => {
    const sdl = `
      input UserInput {
        id: ID!
        name: String! @deprecated(reason: "")
        email: String!
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

      message UserInput {
        string id = 1;
        string name = 2 [deprecated = true];
        string email = 3;
      }"
    `);
  });

  it('should correctly handle deprecated input field without reason argument', () => {
    const sdl = `
      input UserInput {
        id: ID!
        name: String! @deprecated
        email: String!
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

      message UserInput {
        string id = 1;
        string name = 2 [deprecated = true];
        string email = 3;
      }"
    `);
  });

  it('should correctly handle multiple deprecated fields in input object', () => {
    const sdl = `
      input UserInput {
        id: ID!
        firstName: String! @deprecated(reason: "Use fullName instead")
        lastName: String! @deprecated(reason: "Use fullName instead")
        fullName: String!
        age: Int @deprecated(reason: "This field will be removed")
        email: String!
      }
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/wrappers.proto";

      // Service definition for DefaultService
      service DefaultService {
      }

      message UserInput {
        string id = 1;
        // Deprecation notice: Use fullName instead
        string first_name = 2 [deprecated = true];
        // Deprecation notice: Use fullName instead
        string last_name = 3 [deprecated = true];
        string full_name = 4;
        // Deprecation notice: This field will be removed
        google.protobuf.Int32Value age = 5 [deprecated = true];
        string email = 6;
      }"
    `);
  });

  it('should correctly handle nested input objects with deprecated fields', () => {
    const sdl = `
      input AddressInput {
        street: String!
        city: String!
        zipCode: String! @deprecated(reason: "Use postalCode instead")
        postalCode: String!
      }

      input UserInput {
        id: ID!
        name: String!
        address: AddressInput!
        oldAddress: AddressInput @deprecated(reason: "This field is no longer needed")
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

      message AddressInput {
        string street = 1;
        string city = 2;
        // Deprecation notice: Use postalCode instead
        string zip_code = 3 [deprecated = true];
        string postal_code = 4;
      }

      message UserInput {
        string id = 1;
        string name = 2;
        AddressInput address = 3;
        // Deprecation notice: This field is no longer needed
        AddressInput old_address = 4 [deprecated = true];
      }"
    `);
  });

  it('should correctly handle input objects with different field types and deprecation', () => {
    const sdl = `
      enum UserRole {
        ADMIN
        USER
        GUEST
      }

      input UserInput {
        id: ID!
        name: String!
        role: UserRole! @deprecated(reason: "Use roles array instead")
        roles: [UserRole!]!
        isActive: Boolean! @deprecated(reason: "Use status field instead")
        metadata: String @deprecated(reason: "This field is deprecated")
      }
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl);

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/wrappers.proto";

      // Service definition for DefaultService
      service DefaultService {
      }

      enum UserRole {
        USER_ROLE_UNSPECIFIED = 0;
        USER_ROLE_ADMIN = 1;
        USER_ROLE_USER = 2;
        USER_ROLE_GUEST = 3;
      }

      message UserInput {
        string id = 1;
        string name = 2;
        // Deprecation notice: Use roles array instead
        UserRole role = 3 [deprecated = true];
        repeated UserRole roles = 4;
        // Deprecation notice: Use status field instead
        bool is_active = 5 [deprecated = true];
        // Deprecation notice: This field is deprecated
        google.protobuf.StringValue metadata = 6 [deprecated = true];
      }"
    `);
  });
});
