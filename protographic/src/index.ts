import { buildSchema, GraphQLSchema } from 'graphql';
import { GRPCMapping } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { GraphQLToProtoVisitor } from './sdl-to-mapping-visitor';
import { GraphQLToProtoTextVisitor } from './sdl-to-proto-visitor';

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
 * @param serviceName Name of the Proto service to generate
 * @param packageName Package name for the Proto file
 * @param goPackage Go package option (defaults to auto-generated from packageName)
 * @returns Protocol Buffer text definition
 */
export function compileGraphQLToProto(
  schemaOrSDL: GraphQLSchema | string,
  serviceName: string = 'DefaultService',
  packageName: string = 'service.v1',
  goPackage?: string,
): string {
  // If a string was provided, build the schema
  const schema =
    typeof schemaOrSDL === 'string'
      ? buildSchema(schemaOrSDL, {
          assumeValid: true, // Don't throw on unknown directives
          assumeValidSDL: true, // Skip SDL validation
        })
      : schemaOrSDL;

  // Create and run the visitor
  const visitor = new GraphQLToProtoTextVisitor(schema, serviceName, packageName, goPackage);
  return visitor.visit();
}

export * from './sdl-to-mapping-visitor';
export * from './sdl-to-proto-visitor';
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
