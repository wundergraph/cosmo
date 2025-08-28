import {
  ArgumentNode,
  ConstValueNode,
  DirectiveNode,
  getNamedType,
  GraphQLEnumType,
  GraphQLEnumValue,
  GraphQLField,
  GraphQLInputField,
  GraphQLInputObjectType,
  GraphQLInterfaceType,
  GraphQLList,
  GraphQLNamedType,
  GraphQLNonNull,
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
  Kind,
  StringValueNode,
} from 'graphql';
import {
  createEntityLookupMethodName,
  createEnumUnspecifiedValue,
  createOperationMethodName,
  createRequestMessageName,
  createResponseMessageName,
  graphqlEnumValueToProtoEnumValue,
  graphqlFieldToProtoField,
} from './naming-conventions.js';
import { camelCase } from 'lodash-es';
import { ProtoLock, ProtoLockManager } from './proto-lock.js';

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
 * Maps GraphQL scalar types to Protocol Buffer wrapper types for nullable fields
 *
 * These wrapper types allow distinguishing between unset fields and zero values
 * in Protocol Buffers, which is important for GraphQL nullable semantics.
 */
const SCALAR_WRAPPER_TYPE_MAP: Record<string, string> = {
  ID: 'google.protobuf.StringValue',
  String: 'google.protobuf.StringValue',
  Int: 'google.protobuf.Int32Value',
  Float: 'google.protobuf.DoubleValue',
  Boolean: 'google.protobuf.BoolValue',
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
  /** Whether to include descriptions/comments from GraphQL schema */
  includeComments?: boolean;
}

/**
 * Data structure for formatting message fields
 */
interface ProtoType {
  typeName: string;
  isRepeated: boolean;
}

/**
 * Data structure for key directive
 */
interface KeyDirective {
  keyString: string;
  resolvable: boolean;
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
 * 5. Comments/descriptions from GraphQL types and fields
 *
 * The visitor uses a queue-based approach to resolve dependencies between
 * types and ensure all referenced types are processed.
 */
export class GraphQLToProtoTextVisitor {
  /** The GraphQL schema being converted */
  private readonly schema: GraphQLSchema;

  /** The name of the Protocol Buffer service */
  private readonly serviceName: string;

  /** The package name for the proto file */
  private readonly packageName: string;

  /** The lock manager for deterministic ordering */
  private readonly lockManager: ProtoLockManager;

  /** Generated proto lock data */
  private generatedLockData: ProtoLock | null = null;

  /** List of import statements */
  private imports: string[] = [];

  /** List of option statements */
  private options: string[] = [];

  /** Accumulates the Protocol Buffer definition text */
  private protoText: string[] = [];

  /** Current indentation level for formatted output */
  private indent = 0;

  /** Whether to include descriptions/comments from GraphQL schema */
  private includeComments: boolean;

  /** Tracks types that have already been processed to avoid duplication */
  private processedTypes = new Set<string>();

  /** Queue of types that need to be converted to Proto messages */
  private messageQueue: GraphQLNamedType[] = [];

  /** Track generated nested list wrapper messages */
  private nestedListWrappers = new Map<string, string>();

  /** Track whether wrapper types are used (for conditional import) */
  private usesWrapperTypes = false;

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
    const {
      serviceName = 'DefaultService',
      packageName = 'service.v1',
      goPackage,
      lockData,
      includeComments = true,
    } = options;

    this.schema = schema;
    this.serviceName = serviceName;
    this.packageName = packageName;
    this.lockManager = new ProtoLockManager(lockData);
    this.includeComments = includeComments;

    // If we have lock data, initialize the field numbers map
    if (lockData) {
      this.initializeFieldNumbersMap(lockData);
    }

    // Initialize options
    if (goPackage && goPackage !== '') {
      // Generate default go_package if not provided
      const defaultGoPackage = `cosmo/pkg/proto/${packageName};${packageName.replace('.', '')}`;
      const goPackageOption = goPackage || defaultGoPackage;
      this.options.push(`option go_package = "${goPackageOption}";`);
    }
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

      // Store field number by field name
      for (const [fieldName, fieldNumber] of Object.entries(messageLock.fields)) {
        this.fieldNumbersMap[messageName][fieldName] = fieldNumber;
      }
    }
  }

  /**
   * Track removed fields for a given message type between schema updates.
   * This ensures that when fields are removed within a single operation,
   * their numbers are properly reserved.
   *
   * @param typeName - The message type name
   * @param originalFieldNames - Original field names from the lock data
   * @param currentFieldNames - Current field names from the schema
   */
  private trackRemovedFields(typeName: string, originalFieldNames: string[], currentFieldNames: string[]): void {
    // Skip if no lock data exists for this type
    if (!this.lockManager.getLockData().messages[typeName]) {
      return;
    }

    const lockData = this.lockManager.getLockData();

    // Find fields that were in the original type but are no longer present
    const removedFields = originalFieldNames.filter((field) => !currentFieldNames.includes(field));

    if (removedFields.length === 0) {
      return;
    }

    // Get the field numbers for removed fields
    const removedFieldNumbers: number[] = [];
    for (const field of removedFields) {
      const fieldNumber = lockData.messages[typeName]?.fields[field];
      if (fieldNumber !== undefined) {
        removedFieldNumbers.push(fieldNumber);
      }
    }

    // Add to existing reserved numbers
    if (removedFieldNumbers.length > 0) {
      const existingReserved = lockData.messages[typeName].reservedNumbers || [];
      lockData.messages[typeName].reservedNumbers = [...new Set([...existingReserved, ...removedFieldNumbers])];
    }
  }

  /**
   * Track removed enum values for a given enum type.
   *
   * @param enumName - The enum type name
   * @param originalValueNames - Original enum value names from the lock data
   * @param currentValueNames - Current enum value names from the schema
   */
  private trackRemovedEnumValues(enumName: string, originalValueNames: string[], currentValueNames: string[]): void {
    // Skip if no lock data exists for this enum
    if (!this.lockManager.getLockData().enums[enumName]) {
      return;
    }

    const lockData = this.lockManager.getLockData();

    // Find values that were in the original enum but are no longer present
    const removedValues = originalValueNames.filter((value) => !currentValueNames.includes(value));

    if (removedValues.length === 0) {
      return;
    }

    // Get the value numbers for removed values
    const removedValueNumbers: number[] = [];
    for (const value of removedValues) {
      const valueNumber = lockData.enums[enumName]?.fields[value];
      if (valueNumber !== undefined) {
        removedValueNumbers.push(valueNumber);
      }
    }

    // Add to existing reserved numbers
    if (removedValueNumbers.length > 0) {
      const existingReserved = lockData.enums[enumName].reservedNumbers || [];
      lockData.enums[enumName].reservedNumbers = [...new Set([...existingReserved, ...removedValueNumbers])];
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
      const fields = lockData.messages[messageName].fields;

      // Check if the field exists in the fields map
      if (fields[fieldName] !== undefined) {
        const fieldNumber = fields[fieldName];
        this.fieldNumbersMap[messageName][fieldName] = fieldNumber;
        if (fieldName !== snakeCaseField) {
          this.fieldNumbersMap[messageName][snakeCaseField] = fieldNumber;
        }
        return fieldNumber;
      }

      // Also check for snake_case version
      if (fieldName !== snakeCaseField && fields[snakeCaseField] !== undefined) {
        const fieldNumber = fields[snakeCaseField];
        this.fieldNumbersMap[messageName][fieldName] = fieldNumber;
        this.fieldNumbersMap[messageName][snakeCaseField] = fieldNumber;
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
   * Add an import statement to the proto file
   */
  private addImport(importPath: string): void {
    if (!this.imports.includes(importPath)) {
      this.imports.push(importPath);
    }
  }

  /**
   * Add an option statement to the proto file
   */
  private addOption(optionStatement: string): void {
    if (!this.options.includes(optionStatement)) {
      this.options.push(optionStatement);
    }
  }

  /**
   * Build the proto file header with syntax, package, imports, and options
   */
  private buildProtoHeader(): string[] {
    const header: string[] = [];

    // Add syntax declaration
    header.push('syntax = "proto3";');

    // Add package declaration
    header.push(`package ${this.packageName};`);
    header.push('');

    // Add options if any (options come before imports)
    if (this.options.length > 0) {
      // Sort options for consistent output
      const sortedOptions = [...this.options].sort();
      for (const option of sortedOptions) {
        header.push(option);
      }
      header.push('');
    }

    // Add imports if any
    if (this.imports.length > 0) {
      // Sort imports for consistent output
      const sortedImports = [...this.imports].sort();
      for (const importPath of sortedImports) {
        header.push(`import "${importPath}";`);
      }
      header.push('');
    }

    return header;
  }

  /**
   * Visit the GraphQL schema to generate Proto buffer definition
   *
   * @returns The complete Protocol Buffer definition as a string
   */
  public visit(): string {
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

    // Process all complex types from the message queue to determine if wrapper types are needed
    this.processMessageQueue();

    // Add wrapper import if needed
    if (this.usesWrapperTypes) {
      this.addImport('google/protobuf/wrappers.proto');
    }

    // Build the complete proto file
    let protoContent: string[] = [];

    // Add the header (syntax, package, imports, options)
    protoContent.push(...this.buildProtoHeader());

    // Add a service description comment
    if (this.includeComments) {
      const serviceComment = `Service definition for ${this.serviceName}`;
      protoContent.push(...this.formatComment(serviceComment, 0)); // Top-level comment, no indent
    }

    // Add service block containing RPC methods
    protoContent.push(`service ${this.serviceName} {`);
    this.indent++;

    // Sort method names deterministically by alphabetical order
    const orderedMethodNames = [...allMethodNames].sort();

    // Add RPC methods in the ordered sequence
    for (const methodName of orderedMethodNames) {
      const methodIndex = allMethodNames.indexOf(methodName);
      if (methodIndex !== -1) {
        // Handle multi-line RPC definitions that include comments
        const rpcMethodText = allRpcMethods[methodIndex];
        if (rpcMethodText.includes('\n')) {
          // For multi-line RPC method definitions (with comments), add each line separately
          const lines = rpcMethodText.split('\n');
          protoContent.push(...lines);
        } else {
          // For simple one-line RPC method definitions (ensure 2-space indentation)
          protoContent.push(`  ${rpcMethodText}`);
        }
      }
    }

    // Close service definition
    this.indent--;
    protoContent.push('}');
    protoContent.push('');

    // Add all wrapper messages first since they might be referenced by other messages
    if (this.nestedListWrappers.size > 0) {
      // Sort the wrappers by name for deterministic output
      const sortedWrapperNames = Array.from(this.nestedListWrappers.keys()).sort();
      for (const wrapperName of sortedWrapperNames) {
        protoContent.push(this.nestedListWrappers.get(wrapperName)!);
      }
    }

    // Add all message definitions
    for (const messageDef of allMessageDefinitions) {
      protoContent.push(messageDef);
    }

    protoContent = this.trimEmptyLines(protoContent);
    this.protoText = this.trimEmptyLines(this.protoText);

    if (this.protoText.length > 0) {
      protoContent.push('');
    }

    // Add all processed types from protoText (populated by processMessageQueue)
    protoContent.push(...this.protoText);

    // Store the generated lock data for retrieval
    this.generatedLockData = this.lockManager.getLockData();

    return protoContent.join('\n');
  }

  /**
   * Trim empty lines from the beginning and end of the array
   */
  private trimEmptyLines(data: string[]): string[] {
    // Find the first non-empty line index
    const firstNonEmpty = data.findIndex((line) => line.trim() !== '');

    // If no non-empty lines found, return empty array
    if (firstNonEmpty === -1) {
      return [];
    }

    // Find the last non-empty line index by searching backwards
    let lastNonEmpty = data.length - 1;
    while (lastNonEmpty >= 0 && data[lastNonEmpty].trim() === '') {
      lastNonEmpty--;
    }

    // Return slice from first to last non-empty line (inclusive)
    return data.slice(firstNonEmpty, lastNonEmpty + 1);
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
        const keyDirectives = this.getKeyDirectives(type);

        if (keyDirectives.length > 0) {
          // Queue this type for message generation (only once)
          this.queueTypeForProcessing(type);

          // Normalize keys by sorting fields alphabetically and deduplicating

          const normalizedKeysSet = new Set<string>();
          for (const keyDirective of keyDirectives) {
            const keyInfo = this.getKeyInfoFromDirective(keyDirective);
            if (!keyInfo) continue;

            const { keyString, resolvable } = keyInfo;
            if (!resolvable) continue;

            const normalizedKey = keyString
              .split(/[,\s]+/)
              .filter((field) => field.length > 0)
              .sort()
              .join(' ');

            normalizedKeysSet.add(normalizedKey);
          }

          // Process each normalized key
          for (const normalizedKeyString of normalizedKeysSet) {
            const methodName = createEntityLookupMethodName(typeName, normalizedKeyString);

            const requestName = createRequestMessageName(methodName);
            const responseName = createResponseMessageName(methodName);

            // Add method name and RPC method with description from the entity type
            result.methodNames.push(methodName);
            const keyFields = normalizedKeyString.split(' ');
            const keyDescription = keyFields.length === 1 ? keyFields[0] : keyFields.join(' and ');
            const description = `Lookup ${typeName} entity by ${keyDescription}${
              type.description ? ': ' + type.description : ''
            }`;
            result.rpcMethods.push(this.createRpcMethod(methodName, requestName, responseName, description));

            // Create request and response messages for this key combination
            result.messageDefinitions.push(
              ...this.createKeyRequestMessage(typeName, requestName, normalizedKeyString, responseName),
            );
            result.messageDefinitions.push(...this.createKeyResponseMessage(typeName, responseName, requestName));
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

    // Get field names and order them using the lock manager
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

      // Add method name and RPC method with the field description
      result.methodNames.push(mappedName);
      result.rpcMethods.push(this.createRpcMethod(mappedName, requestName, responseName, field.description));

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
   * Create an RPC method definition with optional comment
   *
   * @param methodName - The name of the RPC method
   * @param requestName - The request message name
   * @param responseName - The response message name
   * @param description - Optional description for the method
   * @returns The RPC method definition with or without comment
   */
  private createRpcMethod(
    methodName: string,
    requestName: string,
    responseName: string,
    description?: string | null,
  ): string {
    if (!this.includeComments || !description) {
      return `rpc ${methodName}(${requestName}) returns (${responseName}) {}`;
    }

    // RPC method comments should be indented 1 level (2 spaces)
    const commentLines = this.formatComment(description, 1);
    const methodLine = `  rpc ${methodName}(${requestName}) returns (${responseName}) {}`;

    return [...commentLines, methodLine].join('\n');
  }

  /**
   * Creates a request message for entity lookup without adding to protoText
   */
  private createKeyRequestMessage(
    typeName: string,
    requestName: string,
    keyString: string,
    responseName: string,
  ): string[] {
    const messageLines: string[] = [];
    const keyMessageName = `${requestName}Key`;
    const lockData = this.lockManager.getLockData();

    // First create the key message
    if (this.includeComments) {
      const keyMessageComment = `Key message for ${typeName} entity lookup`;
      messageLines.push(...this.formatComment(keyMessageComment, 0)); // Top-level comment, no indent
    }
    messageLines.push(`message ${keyMessageName} {`);

    // Add reserved field numbers if any exist for the key message
    const keyMessageLock = lockData.messages[keyMessageName];
    if (keyMessageLock?.reservedNumbers && keyMessageLock.reservedNumbers.length > 0) {
      messageLines.push(`  reserved ${this.formatReservedNumbers(keyMessageLock.reservedNumbers)};`);
    }

    const keyFields = keyString.split(' ');

    // Check for field removals in the key message
    if (lockData.messages[keyMessageName]) {
      const originalKeyFieldNames = Object.keys(lockData.messages[keyMessageName].fields);
      const currentKeyFieldNames = keyFields.map((field) => graphqlFieldToProtoField(field));
      this.trackRemovedFields(keyMessageName, originalKeyFieldNames, currentKeyFieldNames);
    }

    // Add all key fields to the key message
    const protoKeyFields: string[] = [];
    keyFields.forEach((keyField, index) => {
      const protoKeyField = graphqlFieldToProtoField(keyField);
      protoKeyFields.push(protoKeyField);

      // Get the appropriate field number for this key field
      const keyFieldNumber = this.getFieldNumber(keyMessageName, protoKeyField, index + 1);

      if (this.includeComments) {
        const keyFieldComment = `Key field for ${typeName} entity lookup.`;
        messageLines.push(...this.formatComment(keyFieldComment, 1)); // Field comment, indent 1 level
      }
      messageLines.push(`  string ${protoKeyField} = ${keyFieldNumber};`);
    });

    messageLines.push('}');
    messageLines.push('');

    // Ensure the key message is registered in the lock manager data
    this.lockManager.reconcileMessageFieldOrder(keyMessageName, protoKeyFields);

    // Now create the main request message with a repeated key field
    // Check for field removals in the request message
    if (lockData.messages[requestName]) {
      const originalFieldNames = Object.keys(lockData.messages[requestName].fields);
      const currentFieldNames = ['keys'];
      this.trackRemovedFields(requestName, originalFieldNames, currentFieldNames);
    }

    if (this.includeComments) {
      const requestComment = `Request message for ${typeName} entity lookup.`;
      messageLines.push(...this.formatComment(requestComment, 0)); // Top-level comment, no indent
    }
    messageLines.push(`message ${requestName} {`);

    // Add reserved field numbers if any exist for the request message
    const messageLock = lockData.messages[requestName];
    if (messageLock?.reservedNumbers && messageLock.reservedNumbers.length > 0) {
      messageLines.push(`  reserved ${this.formatReservedNumbers(messageLock.reservedNumbers)};`);
    }

    // Get the appropriate field number for the repeated key field
    const repeatFieldNumber = this.getFieldNumber(requestName, 'keys', 1);

    if (this.includeComments) {
      const keysComment = `List of keys to look up ${typeName} entities.
Order matters - each key maps to one entity in ${responseName}.`;
      messageLines.push(...this.formatComment(keysComment, 1)); // Field comment, indent 1 level
    }
    messageLines.push(`  repeated ${keyMessageName} keys = ${repeatFieldNumber};`);
    messageLines.push('}');
    messageLines.push('');

    // Ensure the request message is registered in the lock manager data
    this.lockManager.reconcileMessageFieldOrder(requestName, ['keys']);

    return messageLines;
  }

  /**
   * Creates a response message for entity lookup without adding to protoText
   */
  private createKeyResponseMessage(typeName: string, responseName: string, requestName: string): string[] {
    const messageLines: string[] = [];
    const lockData = this.lockManager.getLockData();

    // Check for field removals for the response message
    if (lockData.messages[responseName]) {
      const originalFieldNames = Object.keys(lockData.messages[responseName].fields);
      const currentFieldNames = ['result'];
      this.trackRemovedFields(responseName, originalFieldNames, currentFieldNames);
    }

    // Create the response message with repeated entity directly
    if (this.includeComments) {
      const responseComment = `Response message for ${typeName} entity lookup.`;
      messageLines.push(...this.formatComment(responseComment, 0)); // Top-level comment, no indent
    }
    messageLines.push(`message ${responseName} {`);

    // Add reserved field numbers for response message if any exist
    const responseMessageLock = lockData.messages[responseName];
    if (responseMessageLock?.reservedNumbers && responseMessageLock.reservedNumbers.length > 0) {
      messageLines.push(`  reserved ${this.formatReservedNumbers(responseMessageLock.reservedNumbers)};`);
    }

    // Get the appropriate field number from the lock
    const responseFieldNumber = this.getFieldNumber(responseName, 'result', 1);

    if (this.includeComments) {
      const resultComment = `List of ${typeName} entities in the same order as the keys in ${requestName}.
Always return the same number of entities as keys. Use null for entities that cannot be found.

Example:
  LookupUserByIdRequest:
    keys:
      - id: 1
      - id: 2
  LookupUserByIdResponse:
    result:
      - id: 1 # User with id 1 found
      - null  # User with id 2 not found
`;
      messageLines.push(...this.formatComment(resultComment, 1)); // Field comment, indent 1 level
    }
    messageLines.push(`  repeated ${typeName} result = ${responseFieldNumber};`);
    messageLines.push('}');
    messageLines.push('');

    // Ensure the response message is registered in the lock manager data
    this.lockManager.reconcileMessageFieldOrder(responseName, ['result']);

    return messageLines;
  }

  /**
   * Creates a request message for a query/mutation field
   */
  private createFieldRequestMessage(requestName: string, field: GraphQLField<any, any>): string[] {
    const messageLines: string[] = [];

    // Get current field names and check for removals
    const lockData = this.lockManager.getLockData();
    const argNames = field.args.map((arg) => graphqlFieldToProtoField(arg.name));

    this.lockManager.reconcileMessageFieldOrder(requestName, argNames);

    // Add a description comment for the request message
    if (this.includeComments) {
      const description = field.description
        ? `Request message for ${field.name} operation${field.description ? ': ' + field.description : ''}.`
        : `Request message for ${field.name} operation.`;
      messageLines.push(...this.formatComment(description, 0)); // Top-level comment, no indent
    }

    messageLines.push(`message ${requestName} {`);

    // Add reserved field numbers if any exist
    const messageLock = lockData.messages[requestName];
    if (messageLock?.reservedNumbers && messageLock.reservedNumbers.length > 0) {
      messageLines.push(`  reserved ${this.formatReservedNumbers(messageLock.reservedNumbers)};`);
    }

    if (field.args.length > 0) {
      const argNames = field.args.map((arg) => arg.name);

      // Extract operation name from the request name (e.g., GetUsersRequest -> GetUsers)
      const operationName = requestName.replace(/Request$/, '');

      // Use the specific argument ordering for this operation
      const orderedArgNames = this.lockManager.reconcileArgumentOrder(operationName, argNames);

      // Process arguments in the order specified by the lock manager
      for (const argName of orderedArgNames) {
        const arg = field.args.find((a) => a.name === argName);
        if (!arg) continue;

        const argType = this.getProtoTypeFromGraphQL(arg.type);
        const argProtoName = graphqlFieldToProtoField(arg.name);

        const fieldNumber = this.getFieldNumber(
          requestName,
          argProtoName,
          this.getNextAvailableFieldNumber(requestName),
        );

        // Add argument description as comment
        if (arg.description) {
          // Use 1 level indent for field comments
          messageLines.push(...this.formatComment(arg.description, 1));
        }

        // Check if the argument is a list type and add the repeated keyword if needed
        if (argType.isRepeated) {
          messageLines.push(`  repeated ${argType.typeName} ${argProtoName} = ${fieldNumber};`);
        } else {
          messageLines.push(`  ${argType.typeName} ${argProtoName} = ${fieldNumber};`);
        }

        // Add complex input types to the queue for processing
        const namedType = getNamedType(arg.type);
        if (isInputObjectType(namedType) && !this.processedTypes.has(namedType.name)) {
          this.messageQueue.push(namedType);
        }
      }
    }

    messageLines.push('}');

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

    // Check for field removals
    const lockData = this.lockManager.getLockData();
    const protoFieldName = graphqlFieldToProtoField(fieldName);

    if (lockData.messages[responseName]) {
      const originalFieldNames = Object.keys(lockData.messages[responseName].fields);
      this.trackRemovedFields(responseName, originalFieldNames, [protoFieldName]);
    }

    // Add a description comment for the response message
    if (this.includeComments) {
      const description = field.description
        ? `Response message for ${fieldName} operation${field.description ? ': ' + field.description : ''}.`
        : `Response message for ${fieldName} operation.`;
      messageLines.push(...this.formatComment(description, 0)); // Top-level comment, no indent
    }

    messageLines.push(`message ${responseName} {`);

    // Add reserved field numbers if any exist
    const messageLock = lockData.messages[responseName];
    if (messageLock?.reservedNumbers && messageLock.reservedNumbers.length > 0) {
      messageLines.push(`  reserved ${this.formatReservedNumbers(messageLock.reservedNumbers)};`);
    }

    const returnType = this.getProtoTypeFromGraphQL(field.type);
    // Get the appropriate field number, respecting the lock
    const fieldNumber = this.getFieldNumber(responseName, protoFieldName, 1);

    // Add description for the response field based on field description
    if (field.description) {
      // Use 1 level indent for field comments
      messageLines.push(...this.formatComment(field.description, 1));
    }

    if (returnType.isRepeated) {
      messageLines.push(`  repeated ${returnType.typeName} ${protoFieldName} = ${fieldNumber};`);
    } else {
      messageLines.push(`  ${returnType.typeName} ${protoFieldName} = ${fieldNumber};`);
    }

    messageLines.push('}');

    // Ensure this message is registered in the lock manager data
    this.lockManager.reconcileMessageFieldOrder(responseName, [protoFieldName]);

    return messageLines;
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
   * Extract key info from a directive
   *
   * The @key directive specifies which fields form the entity's primary key.
   * We extract these for creating appropriate lookup methods.
   *
   * @param directive - The @key directive from the GraphQL AST
   * @returns An object with the key fields and whether it is resolvable
   */
  private getKeyInfoFromDirective(directive: DirectiveNode): KeyDirective | null {
    const fieldsArgs = directive.arguments?.find((arg: ArgumentNode) => arg.name.value === 'fields');
    const resolvableArg = directive.arguments?.find((arg: ArgumentNode) => arg.name.value === 'resolvable');

    if (!fieldsArgs && !resolvableArg) {
      return null;
    }

    const result: KeyDirective = {
      keyString: '',
      resolvable: true,
    };

    if (fieldsArgs && fieldsArgs.value.kind === 'StringValue') {
      const stringValue = fieldsArgs.value as StringValueNode;
      result.keyString = stringValue.value;
    }

    if (resolvableArg && resolvableArg.value.kind === 'BooleanValue') {
      result.resolvable = resolvableArg.value.value;
    }

    return result;
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
        typeName === 'Mutation' ||
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
        this.processObjectType(type as GraphQLObjectType);
      } else if (isInputObjectType(type)) {
        this.processInputObjectType(type as GraphQLInputObjectType);
      } else if (isInterfaceType(type)) {
        this.processInterfaceType(type as GraphQLInterfaceType);
      } else if (isUnionType(type)) {
        this.processUnionType(type as GraphQLUnionType);
      } else if (isEnumType(type)) {
        this.processEnumType(type as GraphQLEnumType);
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

    // Check for field removals if lock data exists for this type
    const lockData = this.lockManager.getLockData();
    if (lockData.messages[type.name]) {
      const originalFieldNames = Object.keys(lockData.messages[type.name].fields);
      const currentFieldNames = Object.keys(type.getFields());
      this.trackRemovedFields(type.name, originalFieldNames, currentFieldNames);
    }

    this.protoText.push('');

    // Add type description as comment before message definition
    if (type.description) {
      this.protoText.push(...this.formatComment(type.description, 0)); // Top-level comment, no indent
    }

    this.protoText.push(`message ${type.name} {`);
    this.indent++;

    // Add reserved field numbers if any exist
    const messageLock = lockData.messages[type.name];
    if (messageLock?.reservedNumbers && messageLock.reservedNumbers.length > 0) {
      this.protoText.push(`  reserved ${this.formatReservedNumbers(messageLock.reservedNumbers)};`);
    }

    const fields = type.getFields();

    // Get field names and order them using the lock manager
    const fieldNames = Object.keys(fields);
    const orderedFieldNames = this.lockManager.reconcileMessageFieldOrder(type.name, fieldNames);

    for (const fieldName of orderedFieldNames) {
      if (!fields[fieldName]) continue;

      const field = fields[fieldName];
      const fieldType = this.getProtoTypeFromGraphQL(field.type);
      const protoFieldName = graphqlFieldToProtoField(fieldName);
      const deprecationInfo = this.fieldIsDeprecated(field, [...type.getInterfaces()]);

      // Get the appropriate field number, respecting the lock
      const fieldNumber = this.getFieldNumber(type.name, protoFieldName, this.getNextAvailableFieldNumber(type.name));

      // Add field description as comment
      if (field.description) {
        this.protoText.push(...this.formatComment(field.description, 1)); // Field comment, indent 1 level
      }

      if (deprecationInfo.deprecated && deprecationInfo.reason && deprecationInfo.reason.length > 0) {
        this.protoText.push(...this.formatComment(`Deprecation notice: ${deprecationInfo.reason}`, 1));
      }

      const fieldOptions = [];
      if (deprecationInfo.deprecated) {
        fieldOptions.push(` [deprecated = true]`);
      }

      if (fieldType.isRepeated) {
        this.protoText.push(
          `  repeated ${fieldType.typeName} ${protoFieldName} = ${fieldNumber}${fieldOptions.join(' ')};`,
        );
      } else {
        this.protoText.push(`  ${fieldType.typeName} ${protoFieldName} = ${fieldNumber}${fieldOptions.join(' ')};`);
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
   * Resolve deprecation for a field (optionally considering interface fields)
   * Field-level reason takes precedence; otherwise the first interface with a non-empty reason wins.
   * @param field - The GraphQL field to handle directives for
   * @param interfaces - The GraphQL interfaces that the field implements
   * @returns An object with the deprecated flag and the reason for deprecation
   */
  private fieldIsDeprecated(
    field: GraphQLField<any, any> | GraphQLInputField,
    interfaces: GraphQLInterfaceType[],
  ): { deprecated: boolean; reason?: string } {
    const allFieldsRefs = [
      field,
      ...interfaces.map((iface) => iface.getFields()[field.name]).filter((f) => f !== undefined),
    ];

    const deprecatedDirectives = allFieldsRefs
      .map((f) => f.astNode?.directives?.find((d) => d.name.value === 'deprecated'))
      .filter((d) => d !== undefined);

    if (deprecatedDirectives.length === 0) {
      return { deprecated: false };
    }

    const reasons = deprecatedDirectives
      .map((d) => d.arguments?.find((a) => a.name.value === 'reason')?.value)
      .filter((r) => r !== undefined && this.isNonEmptyStringValueNode(r));

    if (reasons.length === 0) {
      return { deprecated: true };
    }

    return { deprecated: true, reason: reasons[0]?.value };
  }

  private enumValueIsDeprecated(value: GraphQLEnumValue): { deprecated: boolean; reason?: string } {
    const deprecatedDirective = value.astNode?.directives?.find((d) => d.name.value === 'deprecated');
    if (!deprecatedDirective) {
      return { deprecated: false };
    }
    const reasonNode = deprecatedDirective.arguments?.find((a) => a.name.value === 'reason')?.value;
    if (this.isNonEmptyStringValueNode(reasonNode)) {
      return { deprecated: true, reason: reasonNode.value.trim() };
    }

    return { deprecated: true };
  }

  /**
   * Check if a node is a non-empty string value node
   * @param node - The node to check
   * @returns True if the node is a non-empty string value node, false otherwise
   */
  private isNonEmptyStringValueNode(node: ConstValueNode | undefined): node is StringValueNode {
    return node?.kind === Kind.STRING && node.value.trim().length > 0;
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
    // Check for field removals if lock data exists for this type
    const lockData = this.lockManager.getLockData();
    if (lockData.messages[type.name]) {
      const originalFieldNames = Object.keys(lockData.messages[type.name].fields);
      const currentFieldNames = Object.keys(type.getFields());
      this.trackRemovedFields(type.name, originalFieldNames, currentFieldNames);
    }

    this.protoText.push('');

    // Add type description as comment before message definition
    if (type.description) {
      this.protoText.push(...this.formatComment(type.description, 0)); // Top-level comment, no indent
    }

    this.protoText.push(`message ${type.name} {`);
    this.indent++;

    // Add reserved field numbers if any exist
    const messageLock = lockData.messages[type.name];
    if (messageLock?.reservedNumbers && messageLock.reservedNumbers.length > 0) {
      this.protoText.push(`  reserved ${this.formatReservedNumbers(messageLock.reservedNumbers)};`);
    }

    const fields = type.getFields();

    // Get field names and order them using the lock manager
    const fieldNames = Object.keys(fields);
    const orderedFieldNames = this.lockManager.reconcileMessageFieldOrder(type.name, fieldNames);

    for (const fieldName of orderedFieldNames) {
      if (!fields[fieldName]) continue;

      const field = fields[fieldName];
      const fieldType = this.getProtoTypeFromGraphQL(field.type);
      const protoFieldName = graphqlFieldToProtoField(fieldName);
      const deprecationInfo = this.fieldIsDeprecated(field, []);

      // Get the appropriate field number, respecting the lock
      const fieldNumber = this.getFieldNumber(type.name, protoFieldName, this.getNextAvailableFieldNumber(type.name));

      // Add field description as comment
      if (field.description) {
        this.protoText.push(...this.formatComment(field.description, 1)); // Field comment, indent 1 level
      }

      if (deprecationInfo.deprecated && deprecationInfo.reason && deprecationInfo.reason.length > 0) {
        this.protoText.push(...this.formatComment(`Deprecation notice: ${deprecationInfo.reason}`, 1));
      }

      const fieldOptions = [];
      if (deprecationInfo.deprecated) {
        fieldOptions.push(` [deprecated = true]`);
      }

      if (fieldType.isRepeated) {
        this.protoText.push(
          `  repeated ${fieldType.typeName} ${protoFieldName} = ${fieldNumber}${fieldOptions.join(' ')};`,
        );
      } else {
        this.protoText.push(`  ${fieldType.typeName} ${protoFieldName} = ${fieldNumber}${fieldOptions.join(' ')};`);
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

    // Add interface description as comment
    if (type.description) {
      this.protoText.push(...this.formatComment(type.description, 0)); // Top-level comment, no indent
    }

    this.protoText.push(`message ${type.name} {`);
    this.indent++;

    // Create a oneof field with all implementing types
    this.protoText.push(`  oneof instance {`);
    this.indent++;

    // Use lock manager to order implementing types
    const typeNames = implementingTypes.map((t) => t.name);
    const orderedTypeNames = this.lockManager.reconcileMessageFieldOrder(`${type.name}Implementations`, typeNames);

    for (let i = 0; i < orderedTypeNames.length; i++) {
      const typeName = orderedTypeNames[i];
      const implType = implementingTypes.find((t) => t.name === typeName);
      if (!implType) continue;

      // Add implementing type description as comment if available
      if (implType.description) {
        this.protoText.push(...this.formatComment(implType.description, 1)); // Field comment, indent 1 level
      }

      this.protoText.push(`  ${implType.name} ${graphqlFieldToProtoField(implType.name)} = ${i + 1};`);

      // Queue implementing types for processing
      if (!this.processedTypes.has(implType.name)) {
        this.messageQueue.push(implType);
      }
    }

    this.indent--;
    this.protoText.push(`  }`);

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

    // Add union description as comment
    if (type.description) {
      this.protoText.push(...this.formatComment(type.description, 0)); // Top-level comment, no indent
    }

    this.protoText.push(`message ${type.name} {`);
    this.indent++;

    // Create a oneof field with all member types
    this.protoText.push(`  oneof value {`);
    this.indent++;

    // Use lock manager to order union member types
    const types = type.getTypes();
    const typeNames = types.map((t) => t.name);
    const orderedTypeNames = this.lockManager.reconcileMessageFieldOrder(`${type.name}Members`, typeNames);

    for (let i = 0; i < orderedTypeNames.length; i++) {
      const typeName = orderedTypeNames[i];
      const memberType = types.find((t) => t.name === typeName);
      if (!memberType) continue;

      // Add member type description as comment if available
      if (memberType.description) {
        this.protoText.push(...this.formatComment(memberType.description, 1)); // Field comment, indent 1 level
      }

      this.protoText.push(`  ${memberType.name} ${graphqlFieldToProtoField(memberType.name)} = ${i + 1};`);

      // Queue member types for processing
      if (!this.processedTypes.has(memberType.name)) {
        this.messageQueue.push(memberType);
      }
    }

    this.indent--;
    this.protoText.push(`  }`);

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
    // Check for enum value removals if lock data exists for this enum
    const lockData = this.lockManager.getLockData();
    if (lockData.enums[type.name]) {
      const originalValueNames = Object.keys(lockData.enums[type.name].fields);
      const currentValueNames = type.getValues().map((v) => v.name);
      this.trackRemovedEnumValues(type.name, originalValueNames, currentValueNames);
    }

    this.protoText.push('');

    // Add enum description as comment
    if (type.description) {
      this.protoText.push(...this.formatComment(type.description, 0)); // Top-level comment, no indent
    }

    this.protoText.push(`enum ${type.name} {`);
    this.indent++;

    // Add reserved enum values first if any exist
    const enumLock = lockData.enums[type.name];
    if (enumLock?.reservedNumbers && enumLock.reservedNumbers.length > 0) {
      this.protoText.push(`  reserved ${this.formatReservedNumbers(enumLock.reservedNumbers)};`);
    }

    // Add unspecified value as first enum value (required in proto3)
    const unspecifiedValue = createEnumUnspecifiedValue(type.name);
    this.protoText.push(`  ${unspecifiedValue} = 0;`);

    // Use lock manager to order enum values
    const values = type.getValues();
    const valueNames = values.map((v) => v.name);
    const orderedValueNames = this.lockManager.reconcileEnumValueOrder(type.name, valueNames);

    for (const valueName of orderedValueNames) {
      const value = values.find((v) => v.name === valueName);
      if (!value) continue;

      const protoEnumValue = graphqlEnumValueToProtoEnumValue(type.name, value.name);

      const deprecationInfo = this.enumValueIsDeprecated(value);

      // Add enum value description as comment
      if (value.description) {
        this.protoText.push(...this.formatComment(value.description, 1)); // Field comment, indent 1 level
      }

      if (deprecationInfo.deprecated && (deprecationInfo.reason?.length ?? 0) > 0) {
        this.protoText.push(...this.formatComment(`Deprecation notice: ${deprecationInfo.reason}`, 1));
      }

      // Get value number from lock data
      const lockData = this.lockManager.getLockData();
      let valueNumber = 0;

      if (lockData.enums[type.name] && lockData.enums[type.name].fields[value.name]) {
        valueNumber = lockData.enums[type.name].fields[value.name];
      } else {
        // This should never happen since we just reconciled, but just in case
        console.warn(`Missing enum value number for ${type.name}.${value.name}`);
        continue;
      }

      const fieldOptions = [];
      if (deprecationInfo.deprecated) {
        fieldOptions.push(` [deprecated = true]`);
      }

      this.protoText.push(`  ${protoEnumValue} = ${valueNumber}${fieldOptions.join(' ')};`);
    }

    this.indent--;
    this.protoText.push('}');
  }

  /**
   * Map GraphQL type to Protocol Buffer type
   *
   * Determines the appropriate Protocol Buffer type for a given GraphQL type,
   * including the use of wrapper types for nullable scalar fields to distinguish
   * between unset fields and zero values.
   *
   * @param graphqlType - The GraphQL type to convert
   * @param ignoreWrapperTypes - If true, do not use wrapper types for nullable scalar fields
   * @returns The corresponding Protocol Buffer type name
   */
  private getProtoTypeFromGraphQL(graphqlType: GraphQLType, ignoreWrapperTypes: boolean = false): ProtoType {
    // Nullable lists need to be handled first, otherwise they will be treated as scalar types
    if (isListType(graphqlType) || (isNonNullType(graphqlType) && isListType(graphqlType.ofType))) {
      return this.handleListType(graphqlType);
    }
    // For nullable scalar types, use wrapper types
    if (isScalarType(graphqlType)) {
      if (ignoreWrapperTypes) {
        return { typeName: SCALAR_TYPE_MAP[graphqlType.name] || 'string', isRepeated: false };
      }
      this.usesWrapperTypes = true; // Track that we're using wrapper types
      return {
        typeName: SCALAR_WRAPPER_TYPE_MAP[graphqlType.name] || 'google.protobuf.StringValue',
        isRepeated: false,
      };
    }

    if (isEnumType(graphqlType)) {
      return { typeName: graphqlType.name, isRepeated: false };
    }

    if (isNonNullType(graphqlType)) {
      // For non-null scalar types, use the base type
      if (isScalarType(graphqlType.ofType)) {
        return { typeName: SCALAR_TYPE_MAP[graphqlType.ofType.name] || 'string', isRepeated: false };
      }

      return this.getProtoTypeFromGraphQL(graphqlType.ofType);
    }
    // Named types (object, interface, union, input)
    const namedType = graphqlType as GraphQLNamedType;
    if (namedType && typeof namedType.name === 'string') {
      return { typeName: namedType.name, isRepeated: false };
    }

    return { typeName: 'string', isRepeated: false }; // Default fallback
  }

  /**
   * Converts GraphQL list types to appropriate Protocol Buffer representations.
   *
   * For non-nullable, single-level lists (e.g., [String!]!), generates simple repeated fields.
   * For nullable lists (e.g., [String]) or nested lists (e.g., [[String]]), creates wrapper
   * messages to properly handle nullability in proto3.
   *
   * Examples:
   * - [String!]! → repeated string field_name = 1;
   * - [String] → ListOfString field_name = 1; (with wrapper message)
   * - [[String!]!]! → ListOfListOfString field_name = 1; (with nested wrapper messages)
   * - [[String]] → ListOfListOfString field_name = 1; (with nested wrapper messages)
   *
   * @param graphqlType - The GraphQL list type to convert
   * @returns ProtoType object containing the type name and whether it should be repeated
   */
  private handleListType(graphqlType: GraphQLList<GraphQLType> | GraphQLNonNull<GraphQLList<GraphQLType>>): ProtoType {
    const listType = this.unwrapNonNullType(graphqlType);
    const isNullableList = !isNonNullType(graphqlType);
    const isNestedList = this.isNestedListType(listType);

    // Simple non-nullable lists can use repeated fields directly
    if (!isNullableList && !isNestedList) {
      return { ...this.getProtoTypeFromGraphQL(getNamedType(listType), true), isRepeated: true };
    }

    // Nullable or nested lists need wrapper messages
    const baseType = getNamedType(listType);
    const nestingLevel = this.calculateNestingLevel(listType);

    // For nested lists, always use full nesting level to preserve inner list nullability
    // For single-level nullable lists, use nesting level 1
    const wrapperNestingLevel = isNestedList ? nestingLevel : 1;

    // Generate all required wrapper messages
    let wrapperName = '';
    for (let i = 1; i <= wrapperNestingLevel; i++) {
      wrapperName = this.createNestedListWrapper(i, baseType);
    }

    // For nested lists, never use repeated at field level to preserve nullability
    return { typeName: wrapperName, isRepeated: false };
  }

  /**
   * Unwraps a GraphQL type from a GraphQLNonNull type
   */
  private unwrapNonNullType<T extends GraphQLType>(graphqlType: T | GraphQLNonNull<T>): T {
    return isNonNullType(graphqlType) ? (graphqlType.ofType as T) : graphqlType;
  }

  /**
   * Checks if a GraphQL list type contains nested lists
   * Type guard that narrows the input type when nested lists are detected
   */
  private isNestedListType(
    listType: GraphQLList<GraphQLType>,
  ): listType is GraphQLList<GraphQLList<GraphQLType> | GraphQLNonNull<GraphQLList<GraphQLType>>> {
    return isListType(listType.ofType) || (isNonNullType(listType.ofType) && isListType(listType.ofType.ofType));
  }

  /**
   * Calculates the nesting level of a GraphQL list type
   */
  private calculateNestingLevel(listType: GraphQLList<GraphQLType>): number {
    let level = 1;
    let currentType: GraphQLType = listType.ofType;

    while (true) {
      if (isNonNullType(currentType)) {
        currentType = currentType.ofType;
      } else if (isListType(currentType)) {
        currentType = currentType.ofType;
        level++;
      } else {
        break;
      }
    }

    return level;
  }

  /**
   * Creates wrapper messages for nullable or nested GraphQL lists.
   *
   * Generates Protocol Buffer message definitions to handle list nullability and nesting.
   * The wrapper messages are stored and later included in the final proto output.
   *
   * For level 1: Creates simple wrapper like:
   *   message ListOfString {
   *     repeated string items = 1;
   *   }
   *
   * For level > 1: Creates nested wrapper structures like:
   *   message ListOfListOfString {
   *     message List {
   *       repeated ListOfString items = 1;
   *     }
   *     List list = 1;
   *   }
   *
   * @param level - The nesting level (1 for simple wrapper, >1 for nested structures)
   * @param baseType - The GraphQL base type being wrapped (e.g., String, User, etc.)
   * @returns The generated wrapper message name (e.g., "ListOfString", "ListOfListOfUser")
   */
  private createNestedListWrapper(level: number, baseType: GraphQLNamedType): string {
    const wrapperName = `${'ListOf'.repeat(level)}${baseType.name}`;

    // Return existing wrapper if already created
    if (this.processedTypes.has(wrapperName) || this.nestedListWrappers.has(wrapperName)) {
      return wrapperName;
    }

    this.processedTypes.add(wrapperName);

    const messageLines = this.buildWrapperMessage(wrapperName, level, baseType);
    this.nestedListWrappers.set(wrapperName, messageLines.join('\n'));

    return wrapperName;
  }

  /**
   * Builds the message lines for a wrapper message
   */
  private buildWrapperMessage(wrapperName: string, level: number, baseType: GraphQLNamedType): string[] {
    const lines: string[] = [];

    // Add comment if enabled
    if (this.includeComments) {
      lines.push(...this.formatComment(`Wrapper message for a list of ${baseType.name}.`, 0));
    }

    const formatIndent = (indent: number, content: string) => {
      return '  '.repeat(indent) + content;
    };

    lines.push(`message ${wrapperName} {`);
    let innerWrapperName = '';
    if (level > 1) {
      innerWrapperName = `${'ListOf'.repeat(level - 1)}${baseType.name}`;
    } else {
      innerWrapperName = this.getProtoTypeFromGraphQL(baseType, true).typeName;
    }

    lines.push(
      formatIndent(1, `message List {`),
      formatIndent(2, `repeated ${innerWrapperName} items = 1;`),
      formatIndent(1, `}`),
      formatIndent(1, `List list = 1;`),
      formatIndent(0, `}`),
    );

    return lines;
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

  /**
   * Format reserved numbers for Proto syntax
   *
   * Formats a list of reserved field numbers for inclusion in a Proto message.
   * This handles both individual numbers and ranges.
   *
   * @param numbers - The field numbers to be reserved
   * @returns A formatted string for the reserved statement
   */
  private formatReservedNumbers(numbers: number[]): string {
    if (numbers.length === 0) return '';

    // Sort numbers for better readability
    const sortedNumbers = [...numbers].sort((a, b) => a - b);

    // Simple case: only one number
    if (sortedNumbers.length === 1) {
      return sortedNumbers[0].toString();
    }

    // Find continuous ranges to compact the representation
    const ranges: Array<[number, number]> = [];
    let rangeStart = sortedNumbers[0];
    let rangeEnd = sortedNumbers[0];

    for (let i = 1; i < sortedNumbers.length; i++) {
      if (sortedNumbers[i] === rangeEnd + 1) {
        // Extend the current range
        rangeEnd = sortedNumbers[i];
      } else {
        // End the current range and start a new one
        ranges.push([rangeStart, rangeEnd]);
        rangeStart = sortedNumbers[i];
        rangeEnd = sortedNumbers[i];
      }
    }

    // Add the last range
    ranges.push([rangeStart, rangeEnd]);

    // Format the ranges
    return ranges
      .map(([start, end]) => {
        if (start === end) {
          return start.toString();
        } else {
          return `${start} to ${end}`;
        }
      })
      .join(', ');
  }

  /**
   * Convert a GraphQL description to Protocol Buffer comment
   * @param description - The GraphQL description text
   * @param indentLevel - The level of indentation for the comment (in number of 2-space blocks)
   * @returns Array of comment lines with proper indentation
   */
  private formatComment(description: string | undefined | null, indentLevel: number = 0): string[] {
    if (!this.includeComments || !description) {
      return [];
    }

    // Use 2-space indentation consistently
    const indent = '  '.repeat(indentLevel);
    const lines = description.trim().split('\n');

    if (lines.length === 1) {
      return [`${indent}// ${lines[0]}`];
    } else {
      return [`${indent}/*`, ...lines.map((line) => `${indent} * ${line}`), `${indent} */`];
    }
  }
}
