import {
  getNamedType,
  GraphQLEnumType,
  GraphQLField,
  GraphQLInputObjectType,
  GraphQLInterfaceType,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLUnionType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
} from 'graphql';
import {
  createEntityLookupMethodName,
  createEntityLookupRequestName,
  createEntityLookupResponseName,
  createEntityLookupResultName,
  createEnumUnspecifiedValue,
  createOperationMethodName,
  createRequestMessageName,
  createResponseMessageName,
  graphqlEnumValueToProtoEnumValue,
  graphqlFieldToProtoField,
} from './naming-conventions';

/**
 * Maps GraphQL scalar types to Protocol Buffer types
 *
 * GraphQL has a smaller set of primitive types compared to Protocol Buffers.
 * This mapping ensures consistent representation between the two type systems.
 */
const SCALAR_TYPE_MAP: Record<string, string> = {
  ID: 'string', // GraphQL IDs map to Proto strings
  String: 'string', // Direct mapping
  Int: 'int32', // GraphQL Int is 32-bit signed
  Float: 'double', // Using double for GraphQL Float gives better precision
  Boolean: 'bool', // Direct mapping
};

/**
 * Generic structure for returning RPC and message definitions
 */
interface CollectionResult {
  rpcMethods: string[];
  messageDefinitions: string[];
}

/**
 * Visitor that converts GraphQL SDL to Protocol Buffer text definition
 *
 * This visitor traverses a GraphQL schema and generates a Protocol Buffer
 * service and message definitions. It handles:
 *
 * 1. GraphQL scalars, objects, interfaces, unions, and enums
 * 2. Federation entity types with @key directives
 * 3. Query and Mutation operations as RPC methods
 * 4. Field and argument mappings with proper naming conventions
 *
 * The visitor uses a queue-based approach to resolve dependencies between
 * types and ensure all referenced types are processed.
 */
export class GraphQLToProtoTextVisitor {
  /** The GraphQL schema being converted */
  private readonly schema: GraphQLSchema;

  /** The name of the Protocol Buffer service */
  private readonly serviceName: string;

  /** Accumulates the Protocol Buffer definition text */
  private protoText: string[] = [];

  /** Current indentation level for formatted output */
  private indent = 0;

  /** Tracks types that have already been processed to avoid duplication */
  private processedTypes = new Set<string>();

  /** Queue of types that need to be converted to Proto messages */
  private messageQueue: GraphQLNamedType[] = [];

  /**
   * Creates a new visitor to convert a GraphQL schema to Protocol Buffers
   *
   * @param schema - The GraphQL schema to convert
   * @param serviceName - Name for the generated service (defaults to "DefaultService")
   * @param packageName - Protocol Buffer package name (defaults to "service.v1")
   * @param goPackage - Go package option (defaults to "wundergraph.com/pb/{packageName};{packageNameNoDelimiters}")
   */
  constructor(
    schema: GraphQLSchema,
    serviceName: string = 'DefaultService',
    packageName: string = 'service.v1',
    goPackage?: string,
  ) {
    this.schema = schema;
    this.serviceName = serviceName;

    // Generate default go_package if not provided
    const defaultGoPackage = `cosmo/pkg/proto/${packageName};${packageName.replace('.', '')}`;
    const goPackageOption = goPackage || defaultGoPackage;

    // Initialize the Proto definition with the standard header
    this.protoText = [
      'syntax = "proto3";',
      `package ${packageName};`,
      '',
      `option go_package = "${goPackageOption}";`,
      '',
    ];
  }

  /**
   * Generate Proto text by walking the GraphQL schema
   *
   * This is the main entry point that orchestrates the conversion process:
   * 1. Creates the service definition with RPC methods only
   * 2. Generates all message definitions separately outside the service block
   *
   * @returns The complete Protocol Buffer definition as a string
   */
  public visit(): string {
    // Clear the protoText array to just contain the header
    const headerText = this.protoText.slice();
    this.protoText = [];

    // Collect RPC methods and message definitions from all sources
    const entityResult = this.collectEntityRpcMethods();
    const queryResult = this.collectQueryRpcMethods();
    const mutationResult = this.collectMutationRpcMethods();

    // Combine all RPC methods and message definitions
    const allRpcMethods = [...entityResult.rpcMethods, ...queryResult.rpcMethods, ...mutationResult.rpcMethods];

    const allMessageDefinitions = [
      ...entityResult.messageDefinitions,
      ...queryResult.messageDefinitions,
      ...mutationResult.messageDefinitions,
    ];

    // Start with the header
    this.protoText = headerText;

    // First: Create service block containing only RPC methods
    this.protoText.push(`service ${this.serviceName} {`);
    this.indent++;

    // Add all RPC methods to service with proper indentation
    for (const rpcMethod of allRpcMethods) {
      this.protoText.push(`${this.getIndent()}${rpcMethod}`);
    }

    // Close service definition
    this.indent--;
    this.protoText.push('}');
    this.protoText.push('');

    // Second: Add all message definitions
    for (const messageDef of allMessageDefinitions) {
      this.protoText.push(messageDef);
    }

    // Third: Process all complex types from the message queue
    this.processMessageQueue();

    return this.protoText.join('\n');
  }

  /**
   * Collects RPC methods for entity types (types with @key directive)
   *
   * This method identifies entity types and creates lookup RPC methods
   * for them without generating the request/response messages yet.
   *
   * @returns Object containing RPC methods and message definitions
   */
  private collectEntityRpcMethods(): CollectionResult {
    const result: CollectionResult = { rpcMethods: [], messageDefinitions: [] };
    const typeMap = this.schema.getTypeMap();

    for (const typeName in typeMap) {
      const type = typeMap[typeName];

      // Skip built-in types and query/mutation/subscription types
      if (
        typeName.startsWith('__') ||
        typeName === this.schema.getQueryType()?.name ||
        typeName === this.schema.getMutationType()?.name ||
        typeName === this.schema.getSubscriptionType()?.name
      ) {
        continue;
      }

      // Check if this is an entity type (has @key directive)
      if (isObjectType(type)) {
        const astNode = type.astNode;
        const keyDirective = astNode?.directives?.find((d) => d.name.value === 'key');

        if (keyDirective) {
          // Queue this type for message generation
          this.queueTypeForProcessing(type);

          const keyFields = this.getKeyFieldsFromDirective(keyDirective);
          if (keyFields.length > 0) {
            const methodName = createEntityLookupMethodName(typeName);
            const requestName = createEntityLookupRequestName(typeName);
            const responseName = createEntityLookupResponseName(typeName);

            // Add RPC method
            result.rpcMethods.push(this.createRpcMethod(methodName, requestName, responseName));

            // Create request and response messages
            result.messageDefinitions.push(...this.createKeyRequestMessage(typeName, requestName, keyFields[0]));
            result.messageDefinitions.push(...this.createKeyResponseMessage(typeName, responseName));
          }
        }
      }
    }

    return result;
  }

  /**
   * Collects RPC methods for query operations
   *
   * @returns Object containing RPC methods and message definitions
   */
  private collectQueryRpcMethods(): CollectionResult {
    return this.collectOperationRpcMethods('Query');
  }

  /**
   * Collects RPC methods for mutation operations
   *
   * @returns Object containing RPC methods and message definitions
   */
  private collectMutationRpcMethods(): CollectionResult {
    return this.collectOperationRpcMethods('Mutation');
  }

  /**
   * Shared method to collect RPC methods for query or mutation operations
   */
  private collectOperationRpcMethods(operationType: 'Query' | 'Mutation'): CollectionResult {
    const result: CollectionResult = { rpcMethods: [], messageDefinitions: [] };

    // Get the root operation type (Query or Mutation)
    const rootType = operationType === 'Query' ? this.schema.getQueryType() : this.schema.getMutationType();

    if (!rootType) return result;

    const fields = rootType.getFields();

    for (const fieldName in fields) {
      // Skip special fields like _entities
      if (fieldName === '_entities') continue;

      const field = fields[fieldName];
      const mappedName = createOperationMethodName(operationType, fieldName);
      const requestName = createRequestMessageName(mappedName);
      const responseName = createResponseMessageName(mappedName);

      // Add RPC method
      result.rpcMethods.push(this.createRpcMethod(mappedName, requestName, responseName));

      // Create request and response messages
      result.messageDefinitions.push(...this.createFieldRequestMessage(requestName, field));
      result.messageDefinitions.push(...this.createFieldResponseMessage(responseName, fieldName, field));

      // Queue the return type for message generation
      this.queueFieldTypeForProcessing(field);
    }

    return result;
  }

  /**
   * Queue a type for processing if not already processed
   */
  private queueTypeForProcessing(type: GraphQLNamedType): void {
    if (!this.processedTypes.has(type.name)) {
      this.messageQueue.push(type);
      this.processedTypes.add(type.name);
    }
  }

  /**
   * Queue a field's return type for processing if it's a complex type
   */
  private queueFieldTypeForProcessing(field: GraphQLField<any, any>): void {
    const returnType = getNamedType(field.type);
    if (!isScalarType(returnType) && !this.processedTypes.has(returnType.name)) {
      this.messageQueue.push(returnType);
      this.processedTypes.add(returnType.name);
    }
  }

  /**
   * Create an RPC method definition
   */
  private createRpcMethod(methodName: string, requestName: string, responseName: string): string {
    return `rpc ${methodName}(${requestName}) returns (${responseName}) {}`;
  }

  /**
   * Creates a request message for entity lookup without adding to protoText
   */
  private createKeyRequestMessage(typeName: string, requestName: string, keyField: string): string[] {
    const messageLines: string[] = [];
    messageLines.push(`message ${requestName} {`);
    messageLines.push(`    string ${graphqlFieldToProtoField(keyField)} = 1;`);
    messageLines.push('}');
    messageLines.push('');
    return messageLines;
  }

  /**
   * Creates a response message for entity lookup without adding to protoText
   */
  private createKeyResponseMessage(typeName: string, responseName: string): string[] {
    const messageLines: string[] = [];
    const resultName = createEntityLookupResultName(typeName);

    // Create the result wrapper message
    messageLines.push(`message ${resultName} {`);
    messageLines.push(`    ${typeName} ${graphqlFieldToProtoField(typeName)} = 1;`);
    messageLines.push('}');
    messageLines.push('');

    // Create the response message with repeated result wrapper
    messageLines.push(`message ${responseName} {`);
    messageLines.push(`    repeated ${resultName} results = 1;`);
    messageLines.push('}');
    messageLines.push('');

    return messageLines;
  }

  /**
   * Creates a request message for a query/mutation field
   */
  private createFieldRequestMessage(requestName: string, field: GraphQLField<any, any>): string[] {
    return this.createRequestMessage(requestName, field.args);
  }

  /**
   * Creates a response message for a query/mutation field
   */
  private createFieldResponseMessage(responseName: string, fieldName: string, field: GraphQLField<any, any>): string[] {
    const messageLines: string[] = [];
    messageLines.push(`message ${responseName} {`);

    const returnType = this.getProtoTypeFromGraphQL(field.type);
    const isRepeated = isListType(field.type) || (isNonNullType(field.type) && isListType(field.type.ofType));

    if (isRepeated) {
      messageLines.push(`    repeated ${returnType} ${graphqlFieldToProtoField(fieldName)} = 1;`);
    } else {
      messageLines.push(`    ${returnType} ${graphqlFieldToProtoField(fieldName)} = 1;`);
    }

    messageLines.push('}');
    return messageLines;
  }

  /**
   * Generic method to create a request message from field arguments
   */
  private createRequestMessage(requestName: string, args: readonly any[]): string[] {
    const messageLines: string[] = [];
    messageLines.push(`message ${requestName} {`);

    if (args.length === 0) {
      // Empty request message - no arguments needed
    } else {
      let fieldIndex = 1;
      for (const arg of args) {
        const argType = this.getProtoTypeFromGraphQL(arg.type);
        const argName = graphqlFieldToProtoField(arg.name);

        messageLines.push(`    ${argType} ${argName} = ${fieldIndex++};`);

        // Add complex input types to the queue for processing
        const namedType = getNamedType(arg.type);
        if (isInputObjectType(namedType) && !this.processedTypes.has(namedType.name)) {
          this.messageQueue.push(namedType);
          this.processedTypes.add(namedType.name);
        }
      }
    }

    messageLines.push('}');
    return messageLines;
  }

  /**
   * Extract key fields from a directive
   *
   * The @key directive specifies which fields form the entity's primary key.
   * We extract these for creating appropriate lookup methods.
   *
   * @param directive - The @key directive from the GraphQL AST
   * @returns Array of field names that form the key
   */
  private getKeyFieldsFromDirective(directive: any): string[] {
    const fieldsArg = directive.arguments?.find((arg: any) => arg.name.value === 'fields');
    if (fieldsArg && fieldsArg.value.kind === 'StringValue') {
      return fieldsArg.value.value.split(' ');
    }
    return [];
  }

  /**
   * Process all queued complex types for message generation
   *
   * This is a key method that processes the message queue to generate
   * Protocol Buffer messages for all complex types. The queue approach ensures:
   *
   * 1. All referenced types are eventually processed
   * 2. Types are only processed once (avoids duplication)
   * 3. Circular references are handled properly
   * 4. Dependencies between types are resolved correctly
   */
  private processMessageQueue(): void {
    // Process queued types in a single pass
    const processedTypeIds = new Set<string>();

    while (this.messageQueue.length > 0) {
      const type = this.messageQueue.shift()!;

      // Skip already processed types (from this pass), Query type, and _Entity
      if (processedTypeIds.has(type.name) || type.name === 'Query' || type.name === '_Entity') {
        if (type.name === 'Query' || type.name === '_Entity') {
          this.processedTypes.add(type.name);
        }
        continue;
      }

      // Process the type based on its kind
      if (isObjectType(type)) {
        this.processObjectType(type);
      } else if (isInputObjectType(type)) {
        this.processInputObjectType(type);
      } else if (isInterfaceType(type)) {
        this.processInterfaceType(type);
      } else if (isUnionType(type)) {
        this.processUnionType(type);
      } else if (isEnumType(type)) {
        this.processEnumType(type);
      }

      // Mark as processed in this pass
      processedTypeIds.add(type.name);
    }

    // Add built-in types from schema that weren't explicitly referenced
    this.addUnprocessedSchemaTypes();
  }

  /**
   * Add types from the schema that weren't processed via references
   *
   * This ensures that even types not explicitly referenced in operations
   * are still included in the output.
   */
  private addUnprocessedSchemaTypes(): void {
    const typeMap = this.schema.getTypeMap();

    for (const typeName in typeMap) {
      const type = typeMap[typeName];

      // Skip built-in types, Query type, _Entity, and already processed types
      if (
        typeName.startsWith('__') ||
        typeName === 'Query' ||
        typeName === '_Entity' ||
        this.processedTypes.has(typeName)
      ) {
        continue;
      }

      // Process remaining type based on its kind
      if (isObjectType(type)) {
        this.processObjectType(type);
      } else if (isInputObjectType(type)) {
        this.processInputObjectType(type);
      } else if (isInterfaceType(type)) {
        this.processInterfaceType(type);
      } else if (isUnionType(type)) {
        this.processUnionType(type);
      } else if (isEnumType(type)) {
        this.processEnumType(type);
      }

      // Mark as processed
      this.processedTypes.add(typeName);
    }
  }

  /**
   * Process a GraphQL object type to a Proto message
   *
   * Converts a GraphQL object type to a Protocol Buffer message with
   * fields corresponding to the GraphQL object fields.
   *
   * @param type - The GraphQL object type
   */
  private processObjectType(type: GraphQLObjectType): void {
    // Skip creating a message for Query type or _Entity
    if (type.name === 'Query' || type.name === '_Entity') {
      this.processedTypes.add(type.name);
      return;
    }

    this.protoText.push('');
    this.protoText.push(`message ${type.name} {`);
    this.indent++;

    const fields = type.getFields();
    let fieldIndex = 1;

    for (const fieldName in fields) {
      const field = fields[fieldName];
      const fieldType = this.getProtoTypeFromGraphQL(field.type);
      const isRepeated = isListType(field.type) || (isNonNullType(field.type) && isListType(field.type.ofType));

      if (isRepeated) {
        this.protoText.push(
          `${this.getIndent()}repeated ${fieldType} ${graphqlFieldToProtoField(fieldName)} = ${fieldIndex++};`,
        );
      } else {
        this.protoText.push(
          `${this.getIndent()}${fieldType} ${graphqlFieldToProtoField(fieldName)} = ${fieldIndex++};`,
        );
      }

      // Queue complex field types for processing
      const namedType = getNamedType(field.type);
      if (!isScalarType(namedType) && !this.processedTypes.has(namedType.name)) {
        this.messageQueue.push(namedType);
        this.processedTypes.add(namedType.name);
      }
    }

    this.indent--;
    this.protoText.push('}');
  }

  /**
   * Process a GraphQL input object type to a Proto message
   *
   * Converts a GraphQL input object type to a Protocol Buffer message
   * with fields corresponding to the GraphQL input object fields.
   *
   * @param type - The GraphQL input object type
   */
  private processInputObjectType(type: GraphQLInputObjectType): void {
    this.protoText.push('');
    this.protoText.push(`message ${type.name} {`);
    this.indent++;

    const fields = type.getFields();
    let fieldIndex = 1;

    for (const fieldName in fields) {
      const field = fields[fieldName];
      const fieldType = this.getProtoTypeFromGraphQL(field.type);
      const isRepeated = isListType(field.type) || (isNonNullType(field.type) && isListType(field.type.ofType));

      if (isRepeated) {
        this.protoText.push(
          `${this.getIndent()}repeated ${fieldType} ${graphqlFieldToProtoField(fieldName)} = ${fieldIndex++};`,
        );
      } else {
        this.protoText.push(
          `${this.getIndent()}${fieldType} ${graphqlFieldToProtoField(fieldName)} = ${fieldIndex++};`,
        );
      }

      // Queue complex field types for processing
      const namedType = getNamedType(field.type);
      if (!isScalarType(namedType) && !this.processedTypes.has(namedType.name)) {
        this.messageQueue.push(namedType);
        this.processedTypes.add(namedType.name);
      }
    }

    this.indent--;
    this.protoText.push('}');
  }

  /**
   * Process a GraphQL interface type
   *
   * In Protocol Buffers, we handle interfaces using the 'oneof' feature
   * with all implementing types as options. This allows for polymorphic
   * behavior similar to GraphQL interfaces.
   *
   * @param type - The GraphQL interface type
   */
  private processInterfaceType(type: GraphQLInterfaceType): void {
    // Mark the interface as processed to avoid infinite recursion
    this.processedTypes.add(type.name);

    const implementingTypes = Object.values(this.schema.getTypeMap())
      .filter(isObjectType)
      .filter((t) => t.getInterfaces().some((i) => i.name === type.name));

    if (implementingTypes.length === 0) {
      // No implementing types, just create a regular message
      this.processObjectType(type as unknown as GraphQLObjectType);
      return;
    }

    this.protoText.push('');
    this.protoText.push(`message ${type.name} {`);
    this.indent++;

    // Create a oneof field with all implementing types
    this.protoText.push(`${this.getIndent()}oneof instance {`);
    this.indent++;

    for (let i = 0; i < implementingTypes.length; i++) {
      const implType = implementingTypes[i];
      this.protoText.push(`${this.getIndent()}${implType.name} ${graphqlFieldToProtoField(implType.name)} = ${i + 1};`);

      // Queue implementing types for processing
      if (!this.processedTypes.has(implType.name)) {
        this.messageQueue.push(implType);
        this.processedTypes.add(implType.name);
      }
    }

    this.indent--;
    this.protoText.push(`${this.getIndent()}}`);

    this.indent--;
    this.protoText.push('}');
  }

  /**
   * Process a GraphQL union type
   *
   * Similar to interfaces, we handle GraphQL unions using Protocol Buffer's
   * 'oneof' feature with all member types as options.
   *
   * @param type - The GraphQL union type
   */
  private processUnionType(type: GraphQLUnionType): void {
    // Skip processing _Entity union type
    if (type.name === '_Entity') {
      this.processedTypes.add(type.name);
      return;
    }

    this.protoText.push('');
    this.protoText.push(`message ${type.name} {`);
    this.indent++;

    // Create a oneof field with all member types
    this.protoText.push(`${this.getIndent()}oneof value {`);
    this.indent++;

    const types = type.getTypes();
    for (let i = 0; i < types.length; i++) {
      const memberType = types[i];
      this.protoText.push(
        `${this.getIndent()}${memberType.name} ${graphqlFieldToProtoField(memberType.name)} = ${i + 1};`,
      );

      // Queue member types for processing
      if (!this.processedTypes.has(memberType.name)) {
        this.messageQueue.push(memberType);
        this.processedTypes.add(memberType.name);
      }
    }

    this.indent--;
    this.protoText.push(`${this.getIndent()}}`);

    this.indent--;
    this.protoText.push('}');
  }

  /**
   * Process a GraphQL enum type to a Proto enum
   *
   * Converts a GraphQL enum to a Protocol Buffer enum. Note that Proto3
   * requires the first enum value to be zero, so we add an UNSPECIFIED value.
   *
   * @param type - The GraphQL enum type
   */
  private processEnumType(type: GraphQLEnumType): void {
    this.protoText.push('');
    this.protoText.push(`enum ${type.name} {`);
    this.indent++;

    // Add unspecified value as first enum value (required in proto3)
    this.protoText.push(`${this.getIndent()}${createEnumUnspecifiedValue(type.name)} = 0;`);

    const values = type.getValues();
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      this.protoText.push(`${this.getIndent()}${graphqlEnumValueToProtoEnumValue(type.name, value.name)} = ${i + 1};`);
    }

    this.indent--;
    this.protoText.push('}');
  }

  /**
   * Map GraphQL type to Protocol Buffer type
   *
   * Determines the appropriate Protocol Buffer type for a given GraphQL type,
   * handling all GraphQL type wrappers (NonNull, List) correctly.
   *
   * @param graphqlType - The GraphQL type to convert
   * @returns The corresponding Protocol Buffer type name
   */
  private getProtoTypeFromGraphQL(graphqlType: any): string {
    if (isScalarType(graphqlType)) {
      return SCALAR_TYPE_MAP[graphqlType.name] || 'string';
    }

    if (isEnumType(graphqlType)) {
      return graphqlType.name;
    }

    if (isNonNullType(graphqlType)) {
      return this.getProtoTypeFromGraphQL(graphqlType.ofType);
    }

    if (isListType(graphqlType)) {
      return this.getProtoTypeFromGraphQL(graphqlType.ofType);
    }

    // Named types (object, interface, union, input)
    // Handle the case where getNamedType might not return a valid object
    if (graphqlType && typeof graphqlType.toString === 'function') {
      const typeName = graphqlType.toString().replace(/[^a-zA-Z0-9_]/g, '');
      return typeName || 'string'; // Fallback to string if no valid name is found
    }

    return 'string'; // Default fallback
  }

  /**
   * Get indentation based on current level
   *
   * Helper method to maintain consistent indentation in the output.
   *
   * @returns String with spaces for the current indentation level
   */
  private getIndent(): string {
    return '  '.repeat(this.indent);
  }
}
