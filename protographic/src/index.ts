import { buildSchema, GraphQLSchema } from 'graphql';
import { GRPCMapping } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { GraphQLToProtoVisitor } from './sdl-to-mapping-visitor.js';
import type { GraphQLToProtoTextVisitorOptions } from './sdl-to-proto-visitor.js';
import { GraphQLToProtoTextVisitor } from './sdl-to-proto-visitor.js';
import type { ProtoLock } from './proto-lock.js';

/**
 * Compiles a GraphQL schema to a mapping structure
 *
 * @param schemaOrSDL GraphQL Schema object or SDL string
 * @param serviceName Name of the Proto service to generate
 * @returns Mapping structure
 */
export function compileGraphQLToMapping(
  schemaOrSDL: GraphQLSchema | string,
  serviceName: string = 'DefaultService',
): GRPCMapping {
  // If a string was provided, build the schema
  const schema =
    typeof schemaOrSDL === 'string'
      ? buildSchema(schemaOrSDL, {
          assumeValid: true, // Don't throw on unknown directives
          assumeValidSDL: true, // Skip SDL validation
        })
      : schemaOrSDL;

  // Create and run the visitor
  const visitor = new GraphQLToProtoVisitor(schema, serviceName);
  return visitor.visit();
}

/**
 * Compiles a GraphQL schema directly to Protocol Buffer text definition
 *
 * @param schemaOrSDL GraphQL Schema object or SDL string
 * @param options Optional configuration options
 * @returns Protocol Buffer text definition and generated lock data
 */
export interface CompileGraphQLToProtoResult {
  proto: string;
  lockData: ProtoLock | null;
}

/**
 * Compiles a GraphQL schema directly to Protocol Buffer text definition
 *
 * @param schemaOrSDL GraphQL Schema object or SDL string
 * @param options Optional configuration options
 * @returns Protocol Buffer text definition and lock data
 */
export function compileGraphQLToProto(
  schemaOrSDL: GraphQLSchema | string,
  options?: GraphQLToProtoTextVisitorOptions,
): CompileGraphQLToProtoResult {
  // If a string was provided, build the schema
  const schema =
    typeof schemaOrSDL === 'string'
      ? buildSchema(schemaOrSDL, {
          assumeValid: true, // Don't throw on unknown directives
          assumeValidSDL: true, // Skip SDL validation
        })
      : schemaOrSDL;

  // Create and run the visitor with lock data if available
  const visitor = new GraphQLToProtoTextVisitor(schema, options);

  const proto = visitor.visit();

  // Get the generated lock data
  const generatedLockData = visitor.getGeneratedLockData();

  // Always return the object with both proto and lockData
  return {
    proto,
    lockData: generatedLockData,
  };
}

export * from './sdl-to-mapping-visitor.js';
export { GraphQLToProtoTextVisitor } from './sdl-to-proto-visitor.js';
export { ProtoLockManager } from './proto-lock.js';

export type { GraphQLToProtoTextVisitorOptions } from './sdl-to-proto-visitor.js';
export type { ProtoLock } from './proto-lock.js';
export {
  GRPCMapping,
  OperationMapping,
  EntityMapping,
  TypeFieldMapping,
  FieldMapping,
  ArgumentMapping,
  EnumMapping,
  EnumValueMapping,
  OperationType,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
