import {
  ArgumentNode,
  DirectiveNode,
  GraphQLEnumType,
  GraphQLField,
  GraphQLInputObjectType,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLSchema,
  isEnumType,
  isInputObjectType,
  isObjectType,
  Kind,
} from 'graphql';
import {
  ArgumentMapping,
  EntityMapping,
  EnumMapping,
  EnumValueMapping,
  FieldMapping,
  GRPCMapping,
  LookupFieldMapping,
  LookupMapping,
  LookupType,
  OperationMapping,
  OperationType,
  RequiredFieldMapping,
  TypeFieldMapping,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { Maybe } from 'graphql/jsutils/Maybe.js';
import {
  createEntityLookupMethodName,
  createOperationMethodName,
  createRequestMessageName,
  createResolverMethodName,
  createResponseMessageName,
  graphqlArgumentToProtoField,
  graphqlEnumValueToProtoEnumValue,
  graphqlFieldToProtoField,
  formatKeyElements,
  OperationTypeName,
} from './naming-conventions.js';
import { REQUIRES_DIRECTIVE_NAME } from './string-constants.js';
import { RequiredFieldsVisitor } from './required-fields-visitor.js';
/**
 * Visitor that converts a GraphQL schema to gRPC mapping definitions
 *
 * This visitor traverses a GraphQL schema and generates mappings between:
 * - GraphQL operations and gRPC RPC methods
 * - GraphQL entity types (with @key directive) and corresponding lookup methods
 * - GraphQL types/fields and Protocol Buffer message types/fields
 * - GraphQL enums and Protocol Buffer enums
 *
 * The generated mappings are used to translate between GraphQL and Protocol Buffer
 * representations in a consistent manner.
 */
export class GraphQLToMappingVisitor {
  private readonly mapping: GRPCMapping;
  private readonly schema: GraphQLSchema;

  /**
   * Creates a new visitor for generating gRPC mappings from a GraphQL schema
   *
   * @param schema - The GraphQL schema to process
   * @param serviceName - Name for the generated service (defaults to "DefaultService")
   */
  constructor(schema: GraphQLSchema, serviceName = 'DefaultService') {
    this.schema = schema;
    this.mapping = new GRPCMapping({
      version: 1,
      service: serviceName,
      operationMappings: [],
      entityMappings: [],
      typeFieldMappings: [],
      enumMappings: [],
    });
  }

  /**
   * Process the GraphQL schema and generate all necessary mappings
   *
   * The processing order is important:
   * 1. First entity types (with @key directives) are processed to identify federated entities
   * 2. Then Query operations are processed to map GraphQL queries to RPC methods
   * 3. Finally all remaining types are processed to ensure complete mapping coverage
   *
   * @returns The completed gRPC mapping definitions
   */
  public visit(): GRPCMapping {
    // Process entity types first (types with @key directive)
    this.processEntityTypes();

    // Process query type
    this.processQueryType();

    // Process mutation type
    this.processMutationType();

    // Process subscription type
    this.processSubscriptionType();

    // Process resolvable fields
    this.processResolvableFields();

    // Process all other types for field mappings
    this.processAllTypes();

    return this.mapping;
  }

  /**
   * Processes entity types (GraphQL types with @key directive)
   *
   * Federation entities require special handling to generate appropriate
   * lookup RPC methods and entity mappings.
   */
  private processEntityTypes(): void {
    const typeMap = this.schema.getTypeMap();

    for (const [typeName, type] of Object.entries(typeMap)) {
      // Skip built-in types and query/mutation/subscription types
      if (this.shouldSkipRootType(type)) {
        continue;
      }

      // Check if this is an entity type (has @key directive)
      if (isObjectType(type)) {
        const keyDirectives = this.getKeyDirectives(type);
        if (keyDirectives.length === 0) {
          continue;
        }

        // Process each @key directive separately
        for (const keyDirective of keyDirectives) {
          const key = this.getKeyFromDirective(keyDirective);
          if (key) {
            // Create entity mapping for each key combination
            this.createEntityMapping(typeName, key);
          }
        }

        this.createRequiredFieldsMapping(type);
      }
    }
  }

  private createRequiredFieldsMapping(type: GraphQLObjectType): void {
    const fields = Object.values(type.getFields()).filter((field) =>
      field.astNode?.directives?.some((d) => d.name.value === REQUIRES_DIRECTIVE_NAME),
    );
    if (fields.length === 0) {
      return;
    }

    for (const field of fields) {
      const visitor = new RequiredFieldsVisitor(this.schema, type, field, this.getRequiredFieldSet(field));
      visitor.visit();
      const mapping = visitor.getMapping();

      const seenKeys = new Set<string>();

      for (const [key, value] of Object.entries(mapping)) {
        const normalizedKey = formatKeyElements(key).join(' ');

        if (seenKeys.has(normalizedKey)) {
          continue;
        }

        seenKeys.add(normalizedKey);

        // Compare normalized versions of both keys to handle different formatting
        const em = this.mapping.entityMappings.find(
          (em) => em.typeName === type.name && formatKeyElements(em.key).join(' ') === normalizedKey,
        );
        if (!em) {
          throw new Error(`Entity mapping not found for type ${type.name} and key ${key}`);
        }

        if (!value.rpc) {
          throw new Error(`RPC method not found for required field ${value.requiredFieldMapping?.original}`);
        }

        em.requiredFieldMappings.push(
          new RequiredFieldMapping({
            fieldMapping: value.requiredFieldMapping,
            request: value.rpc.request,
            response: value.rpc.response,
            rpc: value.rpc.name,
          }),
        );
      }
    }
  }

  /**
   * Extracts the required field set from a field's requires directive
   * @param field - The GraphQL field to get the required field set from
   * @returns The required field set string
   * @throws Error if the required field set is not found or is not a string
   */
  private getRequiredFieldSet(field: GraphQLField<any, any>): string {
    const arg = field.astNode?.directives
      ?.find((d) => d.name.value === REQUIRES_DIRECTIVE_NAME)
      ?.arguments?.find((arg) => arg.name.value === 'fields');
    if (!arg || arg.value.kind !== Kind.STRING) {
      throw new Error(`Required field set not found for field ${field.name}`);
    }

    return arg.value.value;
  }

  /**
   * Extract all key directives from a GraphQL object type
   *
   * @param type - The GraphQL object type to check for key directives
   * @returns Array of all key directives found
   */
  private getKeyDirectives(type: GraphQLObjectType): DirectiveNode[] {
    return type.astNode?.directives?.filter((d) => d.name.value === 'key') || [];
  }

  /**
   * Creates an entity mapping for a federated entity type
   *
   * This defines how a GraphQL federated entity maps to a gRPC lookup method
   * and its corresponding request/response messages.
   *
   * @param typeName - The name of the GraphQL entity type
   * @param keyField - The field that serves as the entity's key
   */
  private createEntityMapping(typeName: string, keyField: string): void {
    const rpc = createEntityLookupMethodName(typeName, keyField);

    const entityMapping = new EntityMapping({
      typeName,
      kind: 'entity',
      key: keyField,
      rpc,
      request: createRequestMessageName(rpc),
      response: createResponseMessageName(rpc),
      requiredFieldMappings: [],
    });

    this.mapping.entityMappings.push(entityMapping);
  }

  /**
   * Extract key fields from a @key directive
   *
   * The @key directive specifies which fields form the entity's primary key
   * in Federation. This method extracts the key string as-is.
   *
   * @param directive - The @key directive from the GraphQL AST
   * @returns The key string (e.g. "id" or "id upc")
   */
  private getKeyFromDirective(directive: DirectiveNode): string | null {
    // Extract fields argument from the key directive
    const fieldsArg = directive.arguments?.find((arg) => arg.name.value === 'fields');
    if (fieldsArg && fieldsArg.value.kind === Kind.STRING) {
      return fieldsArg.value.value;
    }
    return null;
  }

  /**
   * Process the GraphQL Query type to generate query operation mappings
   *
   * Each field on the Query type represents a GraphQL query operation that
   * needs to be mapped to a corresponding gRPC RPC method.
   */
  private processQueryType(): void {
    this.processType('Query', OperationType.QUERY, this.schema.getQueryType());
  }

  /**
   * Process the GraphQL Mutation type to generate mutation operation mappings
   *
   * Each field on the Mutation type represents a GraphQL mutation operation that
   * needs to be mapped to a corresponding gRPC RPC method.
   */
  private processMutationType(): void {
    this.processType('Mutation', OperationType.MUTATION, this.schema.getMutationType());
  }

  /**
   * Process the GraphQL Subscription type to generate subscription operation mappings
   *
   * Each field on the Subscription type represents a GraphQL subscription operation that
   * needs to be mapped to a corresponding gRPC RPC method.
   */
  private processSubscriptionType(): void {
    this.processType('Subscription', OperationType.SUBSCRIPTION, this.schema.getSubscriptionType());
  }

  /**
   * Process the resolvable fields to generate lookup mappings
   *
   * Each field with arguments that is marked with @connect__fieldResolver is a resolvable field.
   */
  private processResolvableFields(): void {
    const typeMap = this.schema.getTypeMap();

    for (const typeName in typeMap) {
      const type = typeMap[typeName];
      if (this.shouldSkipRootType(type)) {
        continue;
      }

      if (!isObjectType(type)) {
        continue;
      }

      const fields = type.getFields();

      for (const field of Object.values(fields)) {
        if (field.args.length === 0) {
          continue;
        }

        this.createLookupMapping(LookupType.RESOLVE, type.name, field);
      }
    }
  }

  /**
   * Process a GraphQL type to generate operation mappings
   *
   * This method processes a specific GraphQL type (e.g., Query, Mutation, Subscription)
   * and generates mappings for its fields to corresponding gRPC RPC methods.
   *
   * @param operationTypeName - The name of the GraphQL type (Query, Mutation, Subscription)
   * @param operationType - The type of operation (Query, Mutation, Subscription)
   * @param graphqlType - The GraphQL type to process
   */
  private processType(
    operationTypeName: OperationTypeName,
    operationType: OperationType,
    graphqlType: Maybe<GraphQLObjectType>,
  ): void {
    if (!graphqlType) {
      return;
    }

    const typeFieldMapping = new TypeFieldMapping({
      type: operationTypeName,
      fieldMappings: [],
    });

    const fields = graphqlType.getFields();

    for (const fieldName in fields) {
      // Skip special federation fields
      if (fieldName === '_entities' || fieldName === '_service') {
        continue;
      }

      const field = fields[fieldName];
      const mappedName = createOperationMethodName(operationTypeName, fieldName);
      this.createOperationMapping(operationType, fieldName, mappedName);

      const fieldMapping = this.createFieldMapping(field);
      typeFieldMapping.fieldMappings.push(fieldMapping);
    }

    this.mapping.typeFieldMappings.push(typeFieldMapping);
  }

  /**
   * Create an operation mapping between a GraphQL query and gRPC method
   *
   * @param operationType - The type of operation (Query, Mutation, Subscription)
   * @param fieldName - Original GraphQL field name
   * @param mappedName - Transformed name for use in gRPC context
   */
  private createOperationMapping(operationType: OperationType, fieldName: string, mappedName: string): void {
    const operationMapping = new OperationMapping({
      type: operationType,
      original: fieldName,
      mapped: mappedName,
      request: createRequestMessageName(mappedName),
      response: createResponseMessageName(mappedName),
    });

    this.mapping.operationMappings.push(operationMapping);
  }

  private createLookupMapping(type: LookupType, typeName: string, field: GraphQLField<any, any>): void {
    const methodName = createResolverMethodName(typeName, field.name);

    const lookupMapping = new LookupMapping({
      type,
      lookupMapping: this.createLookupFieldMapping(typeName, field),
      rpc: methodName,
      request: createRequestMessageName(methodName),
      response: createResponseMessageName(methodName),
    });

    this.mapping.resolveMappings.push(lookupMapping);
  }

  /**
   * Process all remaining GraphQL types to generate complete mappings
   *
   * This ensures that all object types, input types, and enums in the schema
   * have appropriate mappings for their fields and values.
   */
  private processAllTypes(): void {
    const typeMap = this.schema.getTypeMap();

    for (const typeName in typeMap) {
      const type = typeMap[typeName];

      if (this.shouldSkipRootType(type)) {
        continue;
      }

      // Process each type according to its kind
      if (isObjectType(type)) {
        this.processObjectType(type);
      } else if (isInputObjectType(type)) {
        this.processInputObjectType(type);
      } else if (isEnumType(type)) {
        this.processEnumType(type);
      }
      // Note: Union types don't need field mappings in our implementation
    }
  }

  /**
   * Determines if a type should be skipped during processing
   *
   * We skip:
   * - Built-in GraphQL types (prefixed with __)
   * - Root operation types (Query, Mutation, Subscription)
   *
   * @param type - The GraphQL type to check
   * @returns True if the type should be skipped, false otherwise
   */
  private shouldSkipRootType(type: GraphQLNamedType): boolean {
    const typeName = type.name;
    return (
      typeName.startsWith('__') ||
      typeName === this.schema.getQueryType()?.name ||
      typeName === this.schema.getMutationType()?.name ||
      typeName === this.schema.getSubscriptionType()?.name
    );
  }

  /**
   * Process a GraphQL object type to generate field mappings
   *
   * @param type - The GraphQL object type to process
   */
  private processObjectType(type: GraphQLObjectType): void {
    const typeFieldMapping = new TypeFieldMapping({
      type: type.name,
      fieldMappings: [],
    });

    const fields = type.getFields();

    for (const fieldName in fields) {
      const field = fields[fieldName];

      const fieldMapping = this.createFieldMapping(field);
      typeFieldMapping.fieldMappings.push(fieldMapping);
    }

    // Only add to mappings if there are fields to map
    if (typeFieldMapping.fieldMappings.length > 0) {
      this.mapping.typeFieldMappings.push(typeFieldMapping);
    }
  }

  /**
   * Process a GraphQL input object type to generate field mappings
   *
   * Input objects are handled separately because they have different
   * field structures than regular object types.
   *
   * @param type - The GraphQL input object type to process
   */
  private processInputObjectType(type: GraphQLInputObjectType): void {
    const typeFieldMapping = new TypeFieldMapping({
      type: type.name,
      fieldMappings: [],
    });

    const fields = type.getFields();

    for (const fieldName in fields) {
      const field = fields[fieldName];
      // Input fields don't have args, so we create a simpler field mapping
      const fieldMapping = new FieldMapping({
        original: field.name,
        mapped: graphqlFieldToProtoField(field.name),
        argumentMappings: [],
      });
      typeFieldMapping.fieldMappings.push(fieldMapping);
    }

    // Only add to mappings if there are fields to map
    if (typeFieldMapping.fieldMappings.length > 0) {
      this.mapping.typeFieldMappings.push(typeFieldMapping);
    }
  }

  /**
   * Process a GraphQL enum type to generate value mappings
   *
   * GraphQL enums are mapped to Protocol Buffer enums with appropriate
   * naming conventions for the enum values.
   *
   * @param type - The GraphQL enum type to process
   */
  private processEnumType(type: GraphQLEnumType): void {
    const enumMapping = new EnumMapping({
      type: type.name,
      values: [],
    });

    const enumValues = type.getValues();

    // Map each enum value to its Protocol Buffer representation
    for (const enumValue of enumValues) {
      enumMapping.values.push(
        new EnumValueMapping({
          original: enumValue.name,
          // Convert to UPPER_SNAKE_CASE with type name prefix for Proto enums
          mapped: graphqlEnumValueToProtoEnumValue(type.name, enumValue.name),
        }),
      );
    }

    this.mapping.enumMappings.push(enumMapping);
  }

  /**
   * Create a field mapping between a GraphQL field and Protocol Buffer field
   *
   * This includes mapping the field name and any arguments the field may have.
   *
   * @param type - The name of the containing GraphQL type
   * @param field - The GraphQL field to create a mapping for
   * @returns The created field mapping
   */
  private createFieldMapping(field: GraphQLField<any, any>): FieldMapping {
    const fieldName = field.name;
    // Convert field names to snake_case for Protocol Buffers
    const mappedFieldName = graphqlFieldToProtoField(fieldName);
    const argumentMappings: ArgumentMapping[] = this.createArgumentMappings(field);

    return new FieldMapping({
      original: fieldName,
      mapped: mappedFieldName,
      argumentMappings,
    });
  }

  /**
   * Create a lookup field mapping between a GraphQL type and Protocol Buffer type
   *
   * This includes mapping the type name and any fields the type may have.
   *
   * @param type - The name of the containing GraphQL type
   * @param field - The GraphQL field to create a mapping for
   * @returns The created lookup field mapping
   */
  private createLookupFieldMapping(type: string, field: GraphQLField<any, any>): LookupFieldMapping {
    return new LookupFieldMapping({
      type,
      fieldMapping: this.createFieldMapping(field),
    });
  }

  /**
   * Create argument mappings for a GraphQL field
   *
   * Maps each argument to its Protocol Buffer representation with
   * appropriate naming conventions.
   *
   * @param field - The GraphQL field containing arguments
   * @returns Array of argument mappings
   */
  private createArgumentMappings(field: GraphQLField<any, any>): ArgumentMapping[] {
    const argumentMappings: ArgumentMapping[] = [];

    if (field.args && field.args.length > 0) {
      for (const arg of field.args) {
        argumentMappings.push(
          new ArgumentMapping({
            original: arg.name,
            // Convert argument names to snake_case for Protocol Buffers
            mapped: graphqlArgumentToProtoField(arg.name),
          }),
        );
      }
    }

    return argumentMappings;
  }
}
