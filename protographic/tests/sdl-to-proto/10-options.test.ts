import { describe, expect, it } from 'vitest';
import { compileGraphQLToProto } from '../../src';
import { expectValidProto } from '../util';

describe('SDL to Proto Options', () => {
  it('should generate proto with go_package option', () => {
    const sdl = `
      type Query {
        stringField: String
        intField: Int
        floatField: Float
        booleanField: Boolean
        idField: ID
      }
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl, {
      goPackage: 'github.com/wundergraph/cosmo/protographic',
    });

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      option go_package = "github.com/wundergraph/cosmo/protographic";

      import "google/protobuf/wrappers.proto";

      // Service definition for DefaultService
      service DefaultService {
        rpc QueryBooleanField(QueryBooleanFieldRequest) returns (QueryBooleanFieldResponse) {}
        rpc QueryFloatField(QueryFloatFieldRequest) returns (QueryFloatFieldResponse) {}
        rpc QueryIdField(QueryIdFieldRequest) returns (QueryIdFieldResponse) {}
        rpc QueryIntField(QueryIntFieldRequest) returns (QueryIntFieldResponse) {}
        rpc QueryStringField(QueryStringFieldRequest) returns (QueryStringFieldResponse) {}
      }

      // Request message for stringField operation.
      message QueryStringFieldRequest {
      }
      // Response message for stringField operation.
      message QueryStringFieldResponse {
        google.protobuf.StringValue string_field = 1;
      }
      // Request message for intField operation.
      message QueryIntFieldRequest {
      }
      // Response message for intField operation.
      message QueryIntFieldResponse {
        google.protobuf.Int32Value int_field = 1;
      }
      // Request message for floatField operation.
      message QueryFloatFieldRequest {
      }
      // Response message for floatField operation.
      message QueryFloatFieldResponse {
        google.protobuf.DoubleValue float_field = 1;
      }
      // Request message for booleanField operation.
      message QueryBooleanFieldRequest {
      }
      // Response message for booleanField operation.
      message QueryBooleanFieldResponse {
        google.protobuf.BoolValue boolean_field = 1;
      }
      // Request message for idField operation.
      message QueryIdFieldRequest {
      }
      // Response message for idField operation.
      message QueryIdFieldResponse {
        google.protobuf.StringValue id_field = 1;
      }"
    `);
  });

  it('should not generate required options for operation fields', () => {
    const sdl = `
      type Query {
        stringField: String!
        intField: Int!
        floatField: Float
        booleanField: Boolean
        idField: ID
      }
      
      type Mutation {
        createUser(input: UserInput!): User!
      }

      input UserInput {
        name: String!
      }
      
      type User {
        id: ID!
        name: String!
      }
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl, {
      includeRequiredAnnotations: true,
    });

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/descriptor.proto";
      import "google/protobuf/wrappers.proto";

      extend google.protobuf.FieldOptions {
        bool is_required = 50000;
      }

      // Service definition for DefaultService
      service DefaultService {
        rpc MutationCreateUser(MutationCreateUserRequest) returns (MutationCreateUserResponse) {}
        rpc QueryBooleanField(QueryBooleanFieldRequest) returns (QueryBooleanFieldResponse) {}
        rpc QueryFloatField(QueryFloatFieldRequest) returns (QueryFloatFieldResponse) {}
        rpc QueryIdField(QueryIdFieldRequest) returns (QueryIdFieldResponse) {}
        rpc QueryIntField(QueryIntFieldRequest) returns (QueryIntFieldResponse) {}
        rpc QueryStringField(QueryStringFieldRequest) returns (QueryStringFieldResponse) {}
      }

      // Request message for stringField operation.
      message QueryStringFieldRequest {
      }
      // Response message for stringField operation.
      message QueryStringFieldResponse {
        string string_field = 1;
      }
      // Request message for intField operation.
      message QueryIntFieldRequest {
      }
      // Response message for intField operation.
      message QueryIntFieldResponse {
        int32 int_field = 1;
      }
      // Request message for floatField operation.
      message QueryFloatFieldRequest {
      }
      // Response message for floatField operation.
      message QueryFloatFieldResponse {
        google.protobuf.DoubleValue float_field = 1;
      }
      // Request message for booleanField operation.
      message QueryBooleanFieldRequest {
      }
      // Response message for booleanField operation.
      message QueryBooleanFieldResponse {
        google.protobuf.BoolValue boolean_field = 1;
      }
      // Request message for idField operation.
      message QueryIdFieldRequest {
      }
      // Response message for idField operation.
      message QueryIdFieldResponse {
        google.protobuf.StringValue id_field = 1;
      }
      // Request message for createUser operation.
      message MutationCreateUserRequest {
        UserInput input = 1;
      }
      // Response message for createUser operation.
      message MutationCreateUserResponse {
        User create_user = 1;
      }

      message UserInput {
        string name = 1 [(is_required) = true];
      }

      message User {
        string id = 1 [(is_required) = true];
        string name = 2 [(is_required) = true];
      }"
    `);
  });

  it('should generate proto with required option for input types', () => {
    const sdl = `
      input UserInput {
        id: ID!
        name: String!
        email: String
        age: Int
      }
    `;

    const { proto: protoText } = compileGraphQLToProto(sdl, {
      includeRequiredAnnotations: true,
    });

    expectValidProto(protoText);

    expect(protoText).toMatchInlineSnapshot(`
      "syntax = "proto3";
      package service.v1;

      import "google/protobuf/descriptor.proto";
      import "google/protobuf/wrappers.proto";

      extend google.protobuf.FieldOptions {
        bool is_required = 50000;
      }

      // Service definition for DefaultService
      service DefaultService {
      }

      message UserInput {
        string id = 1 [(is_required) = true];
        string name = 2 [(is_required) = true];
        google.protobuf.StringValue email = 3;
        google.protobuf.Int32Value age = 4;
      }"
    `);
  });
});
