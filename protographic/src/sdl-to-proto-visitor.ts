import {
  ArgumentNode,
  DirectiveNode,
  getNamedType,
  GraphQLArgument,
  GraphQLEnumType,
  GraphQLField,
  GraphQLInputObjectType,
  GraphQLInterfaceType,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLType,
  GraphQLUnionType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
  StringValueNode,
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
import { camelCase } from 'lodash-es';
import { ProtoLock, ProtoLockManager } from './proto-lock';

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
  methodNames: string[];
  messageDefinitions: string[];
}

/**
 * Options for GraphQLToProtoTextVisitor
 */
export interface GraphQLToProtoTextVisitorOptions {
  serviceName?: string;
  packageName?: string;
  goPackage?: string;
  lockData?: ProtoLock;
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

  /** The lock manager for deterministic ordering */
  private readonly lockManager: ProtoLockManager;

  /** Generated proto lock data */
  private generatedLockData: ProtoLock | null = null;

  /** Accumulates the Protocol Buffer definition text */
  private protoText: string[] = [];

  /** Current indentation level for formatted output */
  private indent = 0;

  /** Tracks types that have already been processed to avoid duplication */
  private processedTypes = new Set<string>();

  /** Queue of types that need to be converted to Proto messages */
  private messageQueue: GraphQLNamedType[] = [];

  /**
   * Map of message names to their field numbers for tracking deleted fields
   * This maintains field numbers even when fields are removed from the schema
   */
  private fieldNumbersMap: Record<string, Record<string, number>> = {};

  /**
   * Creates a new visitor to convert a GraphQL schema to Protocol Buffers
   *
   * @param schema - The GraphQL schema to convert
   * @param options - Configuration options for the visitor
   */
  constructor(schema: GraphQLSchema, options: GraphQLToProtoTextVisitorOptions = {}) {
    const { serviceName = 'DefaultService', packageName = 'service.v1', goPackage, lockData } = options;

    this.schema = schema;
    this.serviceName = serviceName;
    this.lockManager = new ProtoLockManager(lockData);

    // If we have lock data, initialize the field numbers map
    if (lockData) {
      this.initializeFieldNumbersMap(lockData);
    }

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
   * Initialize the field numbers map from the lock data to preserve field numbers
   * even when fields are removed and later re-added
   */
  private initializeFieldNumbersMap(lockData: ProtoLock): void {
    this.fieldNumbersMap = {};

    // For each message in the lock data, create a mapping of field name to field number
    for (const [messageName, messageLock] of Object.entries(lockData.messages)) {
      if (!this.fieldNumbersMap[messageName]) {
        this.fieldNumbersMap[messageName] = {};
      }

      // Process fields in their original order to maintain proper field numbers
      messageLock.fields.forEach((fieldName, index) => {
        // Store field number by field name (field number starts from 1)
        this.fieldNumbersMap[messageName][fieldName] = index + 1;
      });
    }
  }

  /**
   * Get the proper field number for a field in a message, respecting the lock.
   * This preserves field numbers for fields that were removed and later re-added.
   */
  private getFieldNumber(messageName: string, fieldName: string, defaultNumber: number): number {
    // Initialize message entry if it doesn't exist
    if (!this.fieldNumbersMap[messageName]) {
      this.fieldNumbersMap[messageName] = {};
    }

    // Direct check if field exists as provided
    if (this.fieldNumbersMap[messageName][fieldName] !== undefined) {
      return this.fieldNumbersMap[messageName][fieldName];
    }

    // Always convert to snake_case for Protocol Buffer field names
    const snakeCaseField = graphqlFieldToProtoField(fieldName);

    // Try the camelCase version for fields that might be stored that way
    const camelCaseField = camelCase(fieldName);
    if (fieldName !== camelCaseField && this.fieldNumbersMap[messageName][camelCaseField] !== undefined) {
      const number = this.fieldNumbersMap[messageName][camelCaseField];
      this.fieldNumbersMap[messageName][fieldName] = number;
      this.fieldNumbersMap[messageName][snakeCaseField] = number; // Also store in snake_case
      return number;
    }

    // Check if this field existed in the lock data
    const lockData = this.lockManager.getLockData();
    if (lockData.messages[messageName]) {
      const lockedFields = lockData.messages[messageName].fields;

      // Check for the field by name or snake_case in the lock
      const lockIndex = lockedFields.indexOf(fieldName);
      if (lockIndex !== -1) {
        const fieldNumber = lockIndex + 1;
        this.fieldNumbersMap[messageName][fieldName] = fieldNumber;
        if (fieldName !== snakeCaseField) {
          this.fieldNumbersMap[messageName][snakeCaseField] = fieldNumber;
        }
        return fieldNumber;
      }
    }

    // Assign the next available number if the field wasn't found in any previous step
    const nextNumber = this.getNextAvailableFieldNumber(messageName);

    // Store with both the original field name and snake_case for consistency
    this.fieldNumbersMap[messageName][fieldName] = nextNumber;
    if (fieldName !== snakeCaseField) {
      this.fieldNumbersMap[messageName][snakeCaseField] = nextNumber;
    }

    return nextNumber;
  }

  /**
   * Get the next available field number for a message, taking care to avoid
   * collisions with existing field numbers, including for fields that were
   * removed from the schema but may be re-added in the future.
   */
  private getNextAvailableFieldNumber(messageName: string): number {
    if (!this.fieldNumbersMap[messageName]) {
      return 1;
    }

    // Get all assigned field numbers for this message
    const usedNumbers = Object.values(this.fieldNumbersMap[messageName]);
    if (usedNumbers.length === 0) {
      return 1;
    }

    // Find the maximum field number and add 1
    return Math.max(...usedNumbers) + 1;
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
    const allMethodNames = [...entityResult.methodNames, ...queryResult.methodNames, ...mutationResult.methodNames];

    const allMessageDefinitions = [
      ...entityResult.messageDefinitions,
      ...queryResult.messageDefinitions,
      ...mutationResult.messageDefinitions,
    ];

    // Add all types from the schema to the queue that weren't already queued
    this.queueAllSchemaTypes();

    // Start with the header
    this.protoText = headerText;

    // First: Create service block containing only RPC methods
    this.protoText.push(`service ${this.serviceName} {`);
    this.indent++;

    // Order RPC methods using the lock manager
    const orderedMethodNames = this.lockManager.reconcileServiceMethodOrder(this.serviceName, allMethodNames);

    // Add RPC methods in the ordered sequence
    for (const methodName of orderedMethodNames) {
      const methodIndex = allMethodNames.indexOf(methodName);
      if (methodIndex !== -1) {
        this.protoText.push(`${this.getIndent()}${allRpcMethods[methodIndex]}`);
      }
    }

    // Close service definition
    this.indent--;
    this.protoText.push('}');
    this.protoText.push('');

    // Second: Add all message definitions
    for (const messageDef of allMessageDefinitions) {
      this.protoText.push(messageDef);
    }

    // Third: Process all complex types from the message queue in a single pass
    this.processMessageQueue();

    // Store the generated lock data for retrieval
    this.generatedLockData = this.lockManager.getLockData();

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
    const result: CollectionResult = { rpcMethods: [], methodNames: [], messageDefinitions: [] };
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

            // Add method name and RPC method
            result.methodNames.push(methodName);
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
    const result: CollectionResult = { rpcMethods: [], methodNames: [], messageDefinitions: [] };

    // Get the root operation type (Query or Mutation)
    const rootType = operationType === 'Query' ? this.schema.getQueryType() : this.schema.getMutationType();

    if (!rootType) return result;

    const fields = rootType.getFields();

    // Use lock manager to order fields
    const fieldNames = Object.keys(fields);
    const orderedFieldNames = this.lockManager.reconcileMessageFieldOrder(operationType, fieldNames);

    for (const fieldName of orderedFieldNames) {
      // Skip special fields like _entities
      if (fieldName === '_entities') continue;

      if (!fields[fieldName]) continue;

      const field = fields[fieldName];
      const mappedName = createOperationMethodName(operationType, fieldName);
      const requestName = createRequestMessageName(mappedName);
      const responseName = createResponseMessageName(mappedName);

      // Add method name and RPC method
      result.methodNames.push(mappedName);
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
    }
  }

  /**
   * Queue a field's return type for processing if it's a complex type
   */
  private queueFieldTypeForProcessing(field: GraphQLField<any, any>): void {
    const returnType = getNamedType(field.type);
    if (!isScalarType(returnType) && !this.processedTypes.has(returnType.name)) {
      this.messageQueue.push(returnType);
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

    const protoKeyField = graphqlFieldToProtoField(keyField);

    // Get the appropriate field number from the lock
    const fieldNumber = this.getFieldNumber(requestName, protoKeyField, 1);

    messageLines.push(`    string ${protoKeyField} = ${fieldNumber};`);
    messageLines.push('}');
    messageLines.push('');

    // Ensure this message is registered in the lock manager data
    this.lockManager.reconcileMessageFieldOrder(requestName, [protoKeyField]);

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
    const protoTypeName = graphqlFieldToProtoField(typeName);

    // Get the appropriate field number from the lock
    const resultFieldNumber = this.getFieldNumber(resultName, protoTypeName, 1);

    messageLines.push(`    ${typeName} ${protoTypeName} = ${resultFieldNumber};`);
    messageLines.push('}');
    messageLines.push('');

    // Ensure the result message is registered in the lock manager data
    this.lockManager.reconcileMessageFieldOrder(resultName, [protoTypeName]);

    // Create the response message with repeated result wrapper
    messageLines.push(`message ${responseName} {`);

    // Get the appropriate field number from the lock
    const responseFieldNumber = this.getFieldNumber(responseName, 'results', 1);

    messageLines.push(`    repeated ${resultName} results = ${responseFieldNumber};`);
    messageLines.push('}');
    messageLines.push('');

    // Ensure the response message is registered in the lock manager data
    this.lockManager.reconcileMessageFieldOrder(responseName, ['results']);

    return messageLines;
  }

  /**
   * Creates a request message for a query/mutation field
   */
  private createFieldRequestMessage(requestName: string, field: GraphQLField<any, any>): string[] {
    const messageLines = this.createRequestMessage(requestName, field.args);

    // Ensure this message is registered in the lock manager data
    if (field.args.length > 0) {
      const fieldNames = field.args.map((arg) => graphqlFieldToProtoField(arg.name));
      this.lockManager.reconcileMessageFieldOrder(requestName, fieldNames);
    }

    return messageLines;
  }

  /**
   * Creates a response message for a query/mutation field
   */
  private createFieldResponseMessage(responseName: string, fieldName: string, field: GraphQLField<any, any>): string[] {
    const messageLines: string[] = [];
    messageLines.push(`message ${responseName} {`);

    const returnType = this.getProtoTypeFromGraphQL(field.type);
    const isRepeated = isListType(field.type) || (isNonNullType(field.type) && isListType(field.type.ofType));
    const protoFieldName = graphqlFieldToProtoField(fieldName);

    // Get the appropriate field number, respecting the lock
    const fieldNumber = this.getFieldNumber(responseName, protoFieldName, 1);

    if (isRepeated) {
      messageLines.push(`    repeated ${returnType} ${protoFieldName} = ${fieldNumber};`);
    } else {
      messageLines.push(`    ${returnType} ${protoFieldName} = ${fieldNumber};`);
    }

    messageLines.push('}');

    // Ensure this message is registered in the lock manager data
    this.lockManager.reconcileMessageFieldOrder(responseName, [protoFieldName]);

    return messageLines;
  }

  /**
   * Generic method to create a request message from field arguments
   */
  private createRequestMessage(requestName: string, args: readonly GraphQLArgument[]): string[] {
    const messageLines: string[] = [];
    messageLines.push(`message ${requestName} {`);

    if (args.length > 0) {
      const argNames = args.map((arg) => arg.name);

      // Extract operation name from the request name (e.g., GetUsersRequest -> GetUsers)
      const operationName = requestName.replace(/Request$/, '');

      // Use the specific argument ordering for this operation
      const orderedArgNames = this.lockManager.reconcileArgumentOrder(operationName, argNames);

      // Process arguments in the order specified by the lock manager
      for (const argName of orderedArgNames) {
        const arg = args.find((a) => a.name === argName);
        if (!arg) continue;

        const argType = this.getProtoTypeFromGraphQL(arg.type);
        const argProtoName = graphqlFieldToProtoField(arg.name);

        // Get the appropriate field number, respecting the lock
        const fieldNumber = this.getFieldNumber(
          requestName,
          argProtoName,
          this.getNextAvailableFieldNumber(requestName),
        );

        messageLines.push(`    ${argType} ${argProtoName} = ${fieldNumber};`);

        // Add complex input types to the queue for processing
        const namedType = getNamedType(arg.type);
        if (isInputObjectType(namedType) && !this.processedTypes.has(namedType.name)) {
          this.messageQueue.push(namedType);
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
  private getKeyFieldsFromDirective(directive: DirectiveNode): string[] {
    const fieldsArg = directive.arguments?.find((arg: ArgumentNode) => arg.name.value === 'fields');
    if (fieldsArg && fieldsArg.value.kind === 'StringValue') {
      const stringValue = fieldsArg.value as StringValueNode;
      return stringValue.value.split(' ');
    }
    return [];
  }

  /**
   * Queue all types from the schema that need processing
   */
  private queueAllSchemaTypes(): void {
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

      // Queue type for processing if it's a complex type
      if (
        isObjectType(type) ||
        isInputObjectType(type) ||
        isInterfaceType(type) ||
        isUnionType(type) ||
        isEnumType(type)
      ) {
        this.messageQueue.push(type);
      }
    }
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
    while (this.messageQueue.length > 0) {
      const type = this.messageQueue.shift()!;

      // Skip already processed types and special internal types
      if (this.processedTypes.has(type.name) || type.name === '_Entity') {
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

      // Mark as processed
      this.processedTypes.add(type.name);
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
    // Skip creating a message for special entity type
    if (type.name === '_Entity') {
      this.processedTypes.add(type.name);
      return;
    }

    this.protoText.push('');
    this.protoText.push(`message ${type.name} {`);
    this.indent++;

    const fields = type.getFields();

    // Get field names and order them using the lock manager
    const fieldNames = Object.keys(fields);
    const orderedFieldNames = this.lockManager.reconcileMessageFieldOrder(type.name, fieldNames);

    for (const fieldName of orderedFieldNames) {
      if (!fields[fieldName]) continue;

      const field = fields[fieldName];
      const fieldType = this.getProtoTypeFromGraphQL(field.type);
      const isRepeated = isListType(field.type) || (isNonNullType(field.type) && isListType(field.type.ofType));
      const protoFieldName = graphqlFieldToProtoField(fieldName);

      // Get the appropriate field number, respecting the lock
      const fieldNumber = this.getFieldNumber(type.name, protoFieldName, this.getNextAvailableFieldNumber(type.name));

      if (isRepeated) {
        this.protoText.push(`${this.getIndent()}repeated ${fieldType} ${protoFieldName} = ${fieldNumber};`);
      } else {
        this.protoText.push(`${this.getIndent()}${fieldType} ${protoFieldName} = ${fieldNumber};`);
      }

      // Queue complex field types for processing
      const namedType = getNamedType(field.type);
      if (!isScalarType(namedType) && !this.processedTypes.has(namedType.name)) {
        this.messageQueue.push(namedType);
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

    // Get field names and order them using the lock manager
    const fieldNames = Object.keys(fields);
    const orderedFieldNames = this.lockManager.reconcileMessageFieldOrder(type.name, fieldNames);

    for (const fieldName of orderedFieldNames) {
      if (!fields[fieldName]) continue;

      const field = fields[fieldName];
      const fieldType = this.getProtoTypeFromGraphQL(field.type);
      const isRepeated = isListType(field.type) || (isNonNullType(field.type) && isListType(field.type.ofType));
      const protoFieldName = graphqlFieldToProtoField(fieldName);

      // Get the appropriate field number, respecting the lock
      const fieldNumber = this.getFieldNumber(type.name, protoFieldName, this.getNextAvailableFieldNumber(type.name));

      if (isRepeated) {
        this.protoText.push(`${this.getIndent()}repeated ${fieldType} ${protoFieldName} = ${fieldNumber};`);
      } else {
        this.protoText.push(`${this.getIndent()}${fieldType} ${protoFieldName} = ${fieldNumber};`);
      }

      // Queue complex field types for processing
      const namedType = getNamedType(field.type);
      if (!isScalarType(namedType) && !this.processedTypes.has(namedType.name)) {
        this.messageQueue.push(namedType);
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

    // Use lock manager to order implementing types
    const typeNames = implementingTypes.map((t) => t.name);
    const orderedTypeNames = this.lockManager.reconcileMessageFieldOrder(`${type.name}Implementations`, typeNames);

    for (let i = 0; i < orderedTypeNames.length; i++) {
      const typeName = orderedTypeNames[i];
      const implType = implementingTypes.find((t) => t.name === typeName);
      if (!implType) continue;

      this.protoText.push(`${this.getIndent()}${implType.name} ${graphqlFieldToProtoField(implType.name)} = ${i + 1};`);

      // Queue implementing types for processing
      if (!this.processedTypes.has(implType.name)) {
        this.messageQueue.push(implType);
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

    // Use lock manager to order union member types
    const types = type.getTypes();
    const typeNames = types.map((t) => t.name);
    const orderedTypeNames = this.lockManager.reconcileMessageFieldOrder(`${type.name}Members`, typeNames);

    for (let i = 0; i < orderedTypeNames.length; i++) {
      const typeName = orderedTypeNames[i];
      const memberType = types.find((t) => t.name === typeName);
      if (!memberType) continue;

      this.protoText.push(
        `${this.getIndent()}${memberType.name} ${graphqlFieldToProtoField(memberType.name)} = ${i + 1};`,
      );

      // Queue member types for processing
      if (!this.processedTypes.has(memberType.name)) {
        this.messageQueue.push(memberType);
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
    const unspecifiedValue = createEnumUnspecifiedValue(type.name);
    this.protoText.push(`${this.getIndent()}${unspecifiedValue} = 0;`);

    // Use lock manager to order enum values
    const values = type.getValues();
    const valueNames = values.map((v) => v.name);
    const orderedValueNames = this.lockManager.reconcileEnumValueOrder(type.name, valueNames);

    // Create a map to track enum value numbers
    const enumValueNumbers: Record<string, number> = {};

    // If we have existing lock data for this enum, extract the value numbers
    const lockData = this.lockManager.getLockData();
    if (lockData.enums[type.name]) {
      // Assign numbers based on locked position
      lockData.enums[type.name].values.forEach((valueName, index) => {
        const protoEnumValue = graphqlEnumValueToProtoEnumValue(type.name, valueName);
        enumValueNumbers[protoEnumValue] = index + 1; // +1 because 0 is reserved for UNSPECIFIED
      });
    }

    for (const valueName of orderedValueNames) {
      const value = values.find((v) => v.name === valueName);
      if (!value) continue;

      const protoEnumValue = graphqlEnumValueToProtoEnumValue(type.name, value.name);

      // Get or assign enum value number
      let valueNumber = enumValueNumbers[protoEnumValue];
      if (!valueNumber) {
        // If no number assigned yet, use the next available number
        const maxNumber = Object.values(enumValueNumbers).length > 0 ? Math.max(...Object.values(enumValueNumbers)) : 0;
        valueNumber = maxNumber + 1;
        enumValueNumbers[protoEnumValue] = valueNumber;
      }

      this.protoText.push(`${this.getIndent()}${protoEnumValue} = ${valueNumber};`);
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
  private getProtoTypeFromGraphQL(graphqlType: GraphQLType): string {
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
    const namedType = graphqlType as GraphQLNamedType;
    if (namedType && typeof namedType.name === 'string') {
      return namedType.name;
    }

    return 'string'; // Default fallback
  }

  /**
   * Get indentation based on the current level
   *
   * Helper method to maintain consistent indentation in the output.
   *
   * @returns String with spaces for the current indentation level
   */
  private getIndent(): string {
    return '  '.repeat(this.indent);
  }

  /**
   * Get the generated lock data after visiting
   *
   * @returns The generated ProtoLock data, or null if visit() hasn't been called
   */
  public getGeneratedLockData(): ProtoLock | null {
    return this.generatedLockData;
  }
}
