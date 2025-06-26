import {
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
  parse,
} from 'graphql';
import {
  createEntityLookupMethodName,
  createEntityLookupRequestName,
  createEntityLookupResponseName,
  createOperationMethodName,
  createRequestMessageName,
  createResponseMessageName,
  graphqlArgumentToProtoField,
  graphqlEnumValueToProtoEnumValue,
  graphqlFieldToProtoField,
  OperationTypeName,
} from './naming-conventions.js';
import {
  ArgumentMapping,
  EntityMapping,
  EnumMapping,
  EnumValueMapping,
  FieldMapping,
  GRPCMapping,
  OperationMapping,
  OperationType,
  TypeFieldMapping,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { Maybe } from 'graphql/jsutils/Maybe.js';

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
export class GraphQLToProtoVisitor {
  private readonly mapping: GRPCMapping;
  private readonly schema: GraphQLSchema;
  private readonly queries?: string[];

  /**
   * Creates a new visitor for generating gRPC mappings from a GraphQL schema
   *
   * @param schema - The GraphQL schema to process
   * @param serviceName - Name for the generated service (defaults to "DefaultService")
   * @param queries - Optional array of GraphQL query strings to generate specific operation mappings
   */
  constructor(schema: GraphQLSchema, serviceName: string = 'DefaultService', queries?: string[]) {
    this.schema = schema;
    this.queries = queries;
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

    if (this.queries && this.queries.length > 0) {
      // Process custom queries if provided
      this.processCustomQueries();
    } else {
      // Process query type
      this.processQueryType();

      // Process mutation type
      this.processMutationType();

      // Process subscription type
      this.processSubscriptionType();
    }

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

    for (const typeName in typeMap) {
      const type = typeMap[typeName];

      // Skip built-in types and query/mutation/subscription types
      if (this.shouldSkipRootType(type)) continue;

      // Check if this is an entity type (has @key directive)
      if (isObjectType(type)) {
        const keyDirective = this.getKeyDirective(type);
        if (!keyDirective) continue;

        const keyFields = this.getKeyFieldsFromDirective(keyDirective);
        if (keyFields.length > 0) {
          // Create entity mapping using the first key field
          this.createEntityMapping(typeName, keyFields[0]);
        }
      }
    }
  }

  /**
   * Extract the key directive from a GraphQL object type
   *
   * @param type - The GraphQL object type to check for key directive
   * @returns The key directive if found, undefined otherwise
   */
  private getKeyDirective(type: GraphQLObjectType): DirectiveNode | undefined {
    return type.astNode?.directives?.find((d) => d.name.value === 'key');
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
    const entityMapping = new EntityMapping({
      typeName,
      kind: 'entity',
      key: keyField,
      rpc: createEntityLookupMethodName(typeName, keyField),
      request: createEntityLookupRequestName(typeName, keyField),
      response: createEntityLookupResponseName(typeName, keyField),
    });

    this.mapping.entityMappings.push(entityMapping);
  }

  /**
   * Extract key fields from a @key directive
   *
   * The @key directive specifies which fields form the entity's primary key
   * in Federation. This method extracts those field names.
   *
   * @param directive - The @key directive from the GraphQL AST
   * @returns Array of field names that form the key
   */
  private getKeyFieldsFromDirective(directive: DirectiveNode): string[] {
    // Extract fields argument from the key directive
    const fieldsArg = directive.arguments?.find((arg) => arg.name.value === 'fields');
    if (fieldsArg && fieldsArg.value.kind === Kind.STRING) {
      return fieldsArg.value.value.split(' ');
    }
    return [];
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
   * Process custom GraphQL queries to generate operation mappings
   *
   * This method parses the provided query strings and generates mappings
   * where the original field contains the full query string.
   */
  private processCustomQueries(): void {
    if (!this.queries) return;

    for (const queryString of this.queries) {
      try {
        const document = parse(queryString);
        
        for (const definition of document.definitions) {
          if (definition.kind === Kind.OPERATION_DEFINITION) {
            const operationName = definition.name?.value;
            if (!operationName) continue;

            // Extract the selection set as string (simplified version)
            const selectionString = this.extractSelectionString(queryString, definition);
            
            let operationType: OperationType;
            switch (definition.operation) {
              case 'query':
                operationType = OperationType.QUERY;
                break;
              case 'mutation':
                operationType = OperationType.MUTATION;
                break;
              case 'subscription':
                operationType = OperationType.SUBSCRIPTION;
                break;
              default:
                operationType = OperationType.QUERY;
            }

            // Create operation mapping with the operation name as the mapped name
            const mappedName = `${definition.operation === 'query' ? 'Query' : 
                               definition.operation === 'mutation' ? 'Mutation' : 
                               'Subscription'}${operationName}`;

            const operationMapping = new OperationMapping({
              type: operationType,
              original: selectionString,
              mapped: mappedName,
              request: createRequestMessageName(mappedName),
              response: createResponseMessageName(mappedName),
            });

            this.mapping.operationMappings.push(operationMapping);
          }
        }
      } catch (error) {
        // Skip invalid queries
        console.warn(`Failed to parse query: ${queryString}`, error);
      }
    }
  }

  /**
   * Extract the selection string from a GraphQL query
   * This is a simplified extraction that gets the main field selection
   */
  private extractSelectionString(queryString: string, definition: any): string {
    // For now, we'll extract the first selection as a simplified approach
    // This could be enhanced for more complex queries
    if (definition.selectionSet && definition.selectionSet.selections.length > 0) {
      const firstSelection = definition.selectionSet.selections[0];
      if (firstSelection.kind === Kind.FIELD) {
        // Extract the field and its arguments/selections from the original query string
        const lines = queryString.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.includes(firstSelection.name.value + '(') || line.includes(firstSelection.name.value + ' {')) {
            // Found the line with our field, now extract the full selection
            return this.extractFieldSelection(queryString, firstSelection);
          }
        }
      }
    }
    return '';
  }

  /**
   * Extract a field selection with its arguments and sub-selections
   */
  private extractFieldSelection(queryString: string, fieldSelection: any): string {
    const fieldName = fieldSelection.name.value;
    
    // Try to extract the complete field selection including nested braces
    // This handles cases like: user(id: "1") { id name details { age } }
    const startIndex = queryString.indexOf(fieldName);
    if (startIndex === -1) return fieldName;
    
    // Find the opening brace after the field name (and potential arguments)
    let currentIndex = startIndex;
    let braceCount = 0;
    let inString = false;
    let stringChar = '';
    let foundFirstBrace = false;
    let selectionStart = -1;
    
    while (currentIndex < queryString.length) {
      const char = queryString[currentIndex];
      
      if (!inString && (char === '"' || char === "'")) {
        inString = true;
        stringChar = char;
      } else if (inString && char === stringChar) {
        inString = false;
        stringChar = '';
      } else if (!inString) {
        if (char === '{') {
          if (!foundFirstBrace) {
            foundFirstBrace = true;
            selectionStart = startIndex;
          }
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0 && foundFirstBrace) {
            // Found the complete selection
            const selection = queryString.substring(selectionStart, currentIndex + 1);
            return selection.replace(/\s+/g, ' ').trim();
          }
        }
      }
      currentIndex++;
    }
    
    // Fallback - just return the field name with arguments if we can't extract the full selection 
    if (fieldSelection.arguments && fieldSelection.arguments.length > 0) {
      const args = fieldSelection.arguments.map((arg: any) => {
        const value = arg.value.kind === Kind.STRING ? `"${arg.value.value}"` : arg.value.value;
        return `${arg.name.value}: ${value}`;
      }).join(', ');
      return `${fieldName}(${args})`;
    }
    
    return fieldName;
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
    if (!graphqlType) return;

    const typeFieldMapping = new TypeFieldMapping({
      type: operationTypeName,
      fieldMappings: [],
    });

    const fields = graphqlType.getFields();

    for (const fieldName in fields) {
      // Skip special federation fields
      if (fieldName === '_entities') continue;

      const field = fields[fieldName];
      const mappedName = createOperationMethodName(operationTypeName, fieldName);
      this.createOperationMapping(operationType, fieldName, mappedName);

      const fieldMapping = this.createFieldMapping(operationTypeName, field);
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

      if (this.shouldSkipRootType(type)) continue;

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
      const fieldMapping = this.createFieldMapping(type.name, field);
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
  private createFieldMapping(type: string, field: GraphQLField<any, any>): FieldMapping {
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
