import { describe, expect, it } from 'vitest';
import { compileGraphQLToProto } from '../../src';
import { expectValidProto } from '../util';

describe('SDL to Proto Options', () => {
  const simpleSDL = `
    type Query {
      hello: String
    }
  `;

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
      protoOptions: [
        {
          name: 'go_package',
          constant: `"github.com/wundergraph/cosmo/protographic"`,
        },
      ],
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

  it('should generate proto with java_package option', () => {
    const { proto: protoText } = compileGraphQLToProto(simpleSDL, {
      javaPackage: 'com.example.myservice',
    });

    expectValidProto(protoText);
    expect(protoText).toContain('option java_package = "com.example.myservice";');
  });

  it('should generate proto with java_outer_classname option', () => {
    const { proto: protoText } = compileGraphQLToProto(simpleSDL, {
      javaOuterClassname: 'MyServiceProto',
    });

    expectValidProto(protoText);
    expect(protoText).toContain('option java_outer_classname = "MyServiceProto";');
  });

  it('should generate proto with java_multiple_files option', () => {
    const { proto: protoText } = compileGraphQLToProto(simpleSDL, {
      javaMultipleFiles: true,
    });

    expectValidProto(protoText);
    expect(protoText).toContain('option java_multiple_files = true;');
  });

  it('should generate proto with all Java options', () => {
    const { proto: protoText } = compileGraphQLToProto(simpleSDL, {
      javaPackage: 'com.example.myservice',
      javaOuterClassname: 'MyServiceProto',
      javaMultipleFiles: true,
    });

    expectValidProto(protoText);
    expect(protoText).toContain('option java_package = "com.example.myservice";');
    expect(protoText).toContain('option java_outer_classname = "MyServiceProto";');
    expect(protoText).toContain('option java_multiple_files = true;');
  });

  it('should generate proto with csharp_namespace option', () => {
    const { proto: protoText } = compileGraphQLToProto(simpleSDL, {
      csharpNamespace: 'Example.MyService',
    });

    expectValidProto(protoText);
    expect(protoText).toContain('option csharp_namespace = "Example.MyService";');
  });

  it('should generate proto with ruby_package option', () => {
    const { proto: protoText } = compileGraphQLToProto(simpleSDL, {
      rubyPackage: 'MyService::Proto',
    });

    expectValidProto(protoText);
    expect(protoText).toContain('option ruby_package = "MyService::Proto";');
  });

  it('should generate proto with php_namespace option', () => {
    const { proto: protoText } = compileGraphQLToProto(simpleSDL, {
      phpNamespace: 'Example\\MyService',
    });

    expectValidProto(protoText);
    expect(protoText).toContain('option php_namespace = "Example\\MyService";');
  });

  it('should generate proto with php_metadata_namespace option', () => {
    const { proto: protoText } = compileGraphQLToProto(simpleSDL, {
      phpMetadataNamespace: 'Example\\MyService\\Metadata',
    });

    expectValidProto(protoText);
    expect(protoText).toContain('option php_metadata_namespace = "Example\\MyService\\Metadata";');
  });

  it('should generate proto with objc_class_prefix option', () => {
    const { proto: protoText } = compileGraphQLToProto(simpleSDL, {
      objcClassPrefix: 'MS',
    });

    expectValidProto(protoText);
    expect(protoText).toContain('option objc_class_prefix = "MS";');
  });

  it('should generate proto with swift_prefix option', () => {
    const { proto: protoText } = compileGraphQLToProto(simpleSDL, {
      swiftPrefix: 'MyService',
    });

    expectValidProto(protoText);
    expect(protoText).toContain('option swift_prefix = "MyService";');
  });

  it('should generate proto with multiple language options', () => {
    const { proto: protoText } = compileGraphQLToProto(simpleSDL, {
      goPackage: 'github.com/example/myservice',
      javaPackage: 'com.example.myservice',
      javaOuterClassname: 'MyServiceProto',
      javaMultipleFiles: true,
      csharpNamespace: 'Example.MyService',
      rubyPackage: 'MyService::Proto',
      phpNamespace: 'Example\\MyService',
      swiftPrefix: 'MS',
    });

    expectValidProto(protoText);

    // Verify all options are present
    expect(protoText).toContain('option go_package = "github.com/example/myservice";');
    expect(protoText).toContain('option java_package = "com.example.myservice";');
    expect(protoText).toContain('option java_outer_classname = "MyServiceProto";');
    expect(protoText).toContain('option java_multiple_files = true;');
    expect(protoText).toContain('option csharp_namespace = "Example.MyService";');
    expect(protoText).toContain('option ruby_package = "MyService::Proto";');
    expect(protoText).toContain('option php_namespace = "Example\\MyService";');
    expect(protoText).toContain('option swift_prefix = "MS";');
  });

  it('should generate proto with options in sorted order', () => {
    const { proto: protoText } = compileGraphQLToProto(simpleSDL, {
      swiftPrefix: 'MS',
      goPackage: 'github.com/example/myservice',
      javaPackage: 'com.example.myservice',
    });

    expectValidProto(protoText);

    // Extract the options section
    const lines = protoText.split('\n');
    const optionLines = lines.filter((line) => line.trim().startsWith('option '));

    // Verify options are sorted alphabetically
    expect(optionLines.length).toBeGreaterThan(0);
    const sortedOptions = [...optionLines].sort();
    expect(optionLines).toEqual(sortedOptions);
  });
});
