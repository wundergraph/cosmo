import protobuf from 'protobufjs';
import {
  buildSchema,
  DocumentNode,
  GraphQLObjectType,
  GraphQLSchema,
  OperationDefinitionNode,
  OperationTypeNode,
  parse,
  TypeInfo,
  visit,
  visitWithTypeInfo,
  getNamedType,
  isInputObjectType,
  isEnumType,
  GraphQLInputObjectType,
  GraphQLEnumType,
  FragmentDefinitionNode,
  TypeNode,
  NonNullTypeNode,
  ListTypeNode,
  NamedTypeNode,
  Kind,
  validate,
  specifiedRules,
  KnownDirectivesRule,
} from 'graphql';
import { createFieldNumberManager } from './operations/field-numbering.js';
import { buildMessageFromSelectionSet } from './operations/message-builder.js';
import { buildRequestMessage, buildInputObjectMessage, buildEnumType } from './operations/request-builder.js';
import { rootToProtoText } from './operations/proto-text-generator.js';
import { mapGraphQLTypeToProto } from './operations/type-mapper.js';
import {
  createRequestMessageName,
  createResponseMessageName,
  createOperationMethodName,
} from './naming-conventions.js';
import { upperFirst, camelCase } from 'lodash-es';
import { ProtoLock, ProtoLockManager } from './proto-lock.js';
import { IdempotencyLevel, MethodWithIdempotency } from './types.js';

/**
 * Options for converting operations to proto
 */
export interface OperationsToProtoOptions {
  serviceName?: string;
  packageName?: string;
  goPackage?: string;
  javaPackage?: string;
  javaOuterClassname?: string;
  javaMultipleFiles?: boolean;
  csharpNamespace?: string;
  rubyPackage?: string;
  phpNamespace?: string;
  phpMetadataNamespace?: string;
  objcClassPrefix?: string;
  swiftPrefix?: string;
  includeComments?: boolean;
  queryIdempotency?: IdempotencyLevel;
  /** Lock data from previous compilation for field number stability */
  lockData?: ProtoLock;
  /** Custom scalar type mappings (scalar name -> proto type) */
  customScalarMappings?: Record<string, string>;
  /** Maximum recursion depth to prevent stack overflow (default: 50) */
  maxDepth?: number;
  /** Prefix RPC method names with operation type (e.g., QueryGetUser, MutationCreateUser) */
  prefixOperationType?: boolean;
}

/**
 * Result of compiling operations to proto
 */
export interface CompileOperationsToProtoResult {
  proto: string;
  root: protobuf.Root;
  /** Lock data for field number stability across compilations */
  lockData: ProtoLock;
}

/**
 * Compiles a collection of GraphQL operations to protocol buffer definition
 * @param operationSource - GraphQL operations as a string or DocumentNode
 * @param schemaOrSDL - GraphQL schema or SDL string
 * @param options - Configuration options for the compilation
 * @returns Proto text and protobufjs root object
 */
export function compileOperationsToProto(
  operationSource: string | DocumentNode,
  schemaOrSDL: GraphQLSchema | string,
  options?: OperationsToProtoOptions,
): CompileOperationsToProtoResult {
  const document: DocumentNode = typeof operationSource === 'string' ? parse(operationSource) : operationSource;

  // Validate that only a single named operation is present
  const namedOperations = document.definitions.filter((def) => def.kind === 'OperationDefinition' && def.name);

  if (namedOperations.length === 0) {
    throw new Error(
      'No named operations found in document. ' + 'At least one named operation is required for proto compilation.',
    );
  }

  if (namedOperations.length > 1) {
    const operationNames = namedOperations.map((op) => (op as OperationDefinitionNode).name!.value).join(', ');
    throw new Error(
      `Multiple operations found in document: ${operationNames}. ` +
        'Only a single named operation per document is supported for proto reversibility. ' +
        'Please compile each operation separately.',
    );
  }

  const schema =
    typeof schemaOrSDL === 'string'
      ? buildSchema(schemaOrSDL, {
          assumeValid: true,
          assumeValidSDL: true,
        })
      : schemaOrSDL;

  // Validate the GraphQL operation document against the schema
  // This catches invalid operations including circular fragment references (NoFragmentCyclesRule)
  // Filter out KnownDirectivesRule to allow unknown directives (e.g., @wg_openapi_operation)
  // since directives may be used by dev tools and don't affect proto generation
  const validationRules = specifiedRules.filter((rule) => rule !== KnownDirectivesRule);
  const validationErrors = validate(schema, document, validationRules);
  if (validationErrors.length > 0) {
    const errorMessages = validationErrors.map((error) => error.message).join('\n');
    throw new Error(`Invalid GraphQL operation:\n${errorMessages}`);
  }

  const visitor = new OperationsToProtoVisitor(document, schema, options);

  const root = visitor.visit();

  const proto = visitor.toProtoText(root);

  // Get the updated lock data for field number stability
  const lockData = visitor.getLockData();

  return { proto, root, lockData };
}

/**
 * Visitor that converts GraphQL operations to protocol buffer definition using protobufjs ast
 */
class OperationsToProtoVisitor {
  private readonly document: DocumentNode;
  private readonly schema: GraphQLSchema;
  private readonly serviceName: string;
  private readonly packageName: string;
  private readonly goPackage?: string;
  private readonly javaPackage?: string;
  private readonly javaOuterClassname?: string;
  private readonly javaMultipleFiles?: boolean;
  private readonly csharpNamespace?: string;
  private readonly rubyPackage?: string;
  private readonly phpNamespace?: string;
  private readonly phpMetadataNamespace?: string;
  private readonly objcClassPrefix?: string;
  private readonly swiftPrefix?: string;
  private readonly includeComments: boolean;
  private readonly queryIdempotency?: IdempotencyLevel;
  private readonly customScalarMappings?: Record<string, string>;
  private readonly maxDepth?: number;
  private readonly prefixOperationType: boolean;

  // Proto AST root
  private readonly root: protobuf.Root;

  // For tracking / avoiding duplicate messages and enums
  private createdMessages = new Set<string>();
  private createdEnums = new Set<string>();

  // Track generated nested list wrapper messages
  private nestedListWrappers = new Map<string, protobuf.Type>();

  // Lock manager for field number stability
  private readonly lockManager: ProtoLockManager;

  // Field number manager
  private readonly fieldNumberManager;

  // Fragment definitions map
  private fragments = new Map<string, FragmentDefinitionNode>();

  constructor(document: DocumentNode, schema: GraphQLSchema, options?: OperationsToProtoOptions) {
    this.document = document;
    this.schema = schema;
    this.serviceName = options?.serviceName || 'DefaultService';
    this.packageName = options?.packageName || 'service.v1';
    this.goPackage = options?.goPackage;
    this.javaPackage = options?.javaPackage;
    this.javaOuterClassname = options?.javaOuterClassname;
    this.javaMultipleFiles = options?.javaMultipleFiles;
    this.csharpNamespace = options?.csharpNamespace;
    this.rubyPackage = options?.rubyPackage;
    this.phpNamespace = options?.phpNamespace;
    this.phpMetadataNamespace = options?.phpMetadataNamespace;
    this.objcClassPrefix = options?.objcClassPrefix;
    this.swiftPrefix = options?.swiftPrefix;
    this.includeComments = options?.includeComments ?? true;
    this.queryIdempotency = options?.queryIdempotency;
    this.customScalarMappings = options?.customScalarMappings;
    this.maxDepth = options?.maxDepth;
    this.prefixOperationType = options?.prefixOperationType ?? false;

    // Initialize lock manager with previous lock data if provided
    this.lockManager = new ProtoLockManager(options?.lockData);

    // Create field number manager with lock manager integration
    this.fieldNumberManager = createFieldNumberManager(this.lockManager);

    this.root = new protobuf.Root();

    // Collect all fragment definitions from the document
    this.collectFragments();
  }

  /**
   * Collects all fragment definitions from the document
   */
  private collectFragments(): void {
    for (const definition of this.document.definitions) {
      if (definition.kind === 'FragmentDefinition') {
        this.fragments.set(definition.name.value, definition);
      }
    }
  }

  public visit(): protobuf.Root {
    const service = new protobuf.Service(this.serviceName);
    const typeInfo = new TypeInfo(this.schema);

    // Visit each operation definition
    visit(
      this.document,
      visitWithTypeInfo(typeInfo, {
        OperationDefinition: (node: OperationDefinitionNode) => {
          this.processOperation(node, service, typeInfo);
          // Don't traverse deeper - we handle selection sets manually
          return false;
        },
      }),
    );

    // Add all wrapper messages to root before adding service
    for (const wrapperMessage of this.nestedListWrappers.values()) {
      if (!this.createdMessages.has(wrapperMessage.name)) {
        this.root.add(wrapperMessage);
        this.createdMessages.add(wrapperMessage.name);
      }
    }

    this.root.add(service);

    return this.root;
  }

  private processOperation(node: OperationDefinitionNode, service: protobuf.Service, typeInfo: TypeInfo) {
    // 1. Extract operation name
    const operationName = node.name?.value;
    if (!operationName) {
      // Skip anonymous operations
      return;
    }

    // 2. Validate operation name is PascalCase
    // This ensures exact matching between GraphQL operation names and RPC method names
    // PascalCase: starts with uppercase, contains at least one lowercase letter
    if (!/^[A-Z](?=.*[a-z])[a-zA-Z0-9]*$/.test(operationName)) {
      throw new Error(
        `Operation name "${operationName}" must be in PascalCase ` +
          `(start with uppercase letter, followed by mixed-case letters/numbers). ` +
          `Examples: GetUser, CreatePost, OnMessageAdded. ` +
          `This ensures the RPC method name exactly matches the GraphQL operation name.`,
      );
    }

    // 3. Validate no root-level field aliases (breaks reversibility)
    if (node.selectionSet) {
      for (const selection of node.selectionSet.selections) {
        if (selection.kind === 'Field' && selection.alias) {
          throw new Error(
            `Root-level field alias "${selection.alias.value}: ${selection.name.value}" is not supported. ` +
              'Field aliases at the root level break proto-to-GraphQL reversibility. ' +
              'Please remove the alias or use it only on nested fields.',
          );
        }
      }
    }

    // 4. Create method name from operation name
    // Use operation name as-is to ensure exact matching (no transformation)
    let methodName = operationName;

    // Add operation type prefix if requested
    if (this.prefixOperationType) {
      const operationTypePrefix = upperFirst(node.operation.toLowerCase());
      methodName = `${operationTypePrefix}${methodName}` as any;
    }

    // 4. Create request message from variables
    const requestMessageName = createRequestMessageName(methodName);
    const requestMessage = buildRequestMessage(requestMessageName, node.variableDefinitions || [], this.schema, {
      includeComments: this.includeComments,
      fieldNumberManager: this.fieldNumberManager,
      schema: this.schema,
      customScalarMappings: this.customScalarMappings,
      ensureNestedListWrapper: this.createNestedListWrapperCallback.bind(this),
    });

    // Add request message to root
    if (!this.createdMessages.has(requestMessageName)) {
      this.root.add(requestMessage);
      this.createdMessages.add(requestMessageName);
    }

    // 3.5. Process any input object types referenced in variables
    if (node.variableDefinitions) {
      for (const varDef of node.variableDefinitions) {
        this.processInputObjectTypes(varDef.type);
      }
    }

    // 6. Create response message from selection set
    const responseMessageName = createResponseMessageName(methodName);
    if (node.selectionSet) {
      const rootType = this.getRootType(node.operation);
      const responseMessage = buildMessageFromSelectionSet(responseMessageName, node.selectionSet, rootType, typeInfo, {
        includeComments: this.includeComments,
        root: this.root,
        fieldNumberManager: this.fieldNumberManager,
        fragments: this.fragments,
        schema: this.schema,
        createdEnums: this.createdEnums,
        customScalarMappings: this.customScalarMappings,
        maxDepth: this.maxDepth,
        ensureNestedListWrapper: this.createNestedListWrapperCallback.bind(this),
      });

      // Add response message to root
      if (!this.createdMessages.has(responseMessageName)) {
        this.root.add(responseMessage);
        this.createdMessages.add(responseMessageName);
      }
    }

    // 7. Add method to service
    const method = new protobuf.Method(methodName, 'rpc', requestMessageName, responseMessageName);

    // Mark subscriptions as server streaming
    if (node.operation === OperationTypeNode.SUBSCRIPTION) {
      method.responseStream = true;
    }

    // Mark Query operations with idempotency level if specified
    if (this.queryIdempotency && node.operation === OperationTypeNode.QUERY) {
      const methodWithIdempotency = method as MethodWithIdempotency;
      methodWithIdempotency.idempotencyLevel = this.queryIdempotency;
    }

    service.add(method);
  }

  /**
   * Convert protobufjs Root to proto text format
   */
  public toProtoText(root: protobuf.Root): string {
    return rootToProtoText(root, {
      packageName: this.packageName,
      goPackage: this.goPackage,
      javaPackage: this.javaPackage,
      javaOuterClassname: this.javaOuterClassname,
      javaMultipleFiles: this.javaMultipleFiles,
      csharpNamespace: this.csharpNamespace,
      rubyPackage: this.rubyPackage,
      phpNamespace: this.phpNamespace,
      phpMetadataNamespace: this.phpMetadataNamespace,
      objcClassPrefix: this.objcClassPrefix,
      swiftPrefix: this.swiftPrefix,
      includeComments: this.includeComments,
    });
  }

  /**
   * Process input object types and enums referenced in a type node
   */
  private processInputObjectTypes(typeNode: TypeNode): void {
    // Handle NonNullType and ListType wrappers
    if (typeNode.kind === 'NonNullType' || typeNode.kind === 'ListType') {
      this.processInputObjectTypes(typeNode.type);
      return;
    }

    // Handle NamedType
    if (typeNode.kind === 'NamedType') {
      const typeName = typeNode.name.value;
      const type = this.schema.getType(typeName);

      if (type && isInputObjectType(type)) {
        // Create message for this input object if not already created
        if (!this.createdMessages.has(typeName)) {
          const inputMessage = buildInputObjectMessage(type as GraphQLInputObjectType, {
            includeComments: this.includeComments,
            fieldNumberManager: this.fieldNumberManager,
            customScalarMappings: this.customScalarMappings,
            ensureNestedListWrapper: this.createNestedListWrapperCallback.bind(this),
          });
          this.root.add(inputMessage);
          this.createdMessages.add(typeName);

          // Recursively process nested input objects and enums
          const fields = (type as GraphQLInputObjectType).getFields();
          for (const field of Object.values(fields)) {
            const fieldType = getNamedType(field.type);
            if (isInputObjectType(fieldType)) {
              const namedTypeNode: NamedTypeNode = {
                kind: Kind.NAMED_TYPE,
                name: { kind: Kind.NAME, value: fieldType.name },
              };
              this.processInputObjectTypes(namedTypeNode);
            } else if (isEnumType(fieldType)) {
              this.processEnumType(fieldType as GraphQLEnumType);
            }
          }
        }
      } else if (type && isEnumType(type)) {
        // Create enum type if not already created
        this.processEnumType(type as GraphQLEnumType);
      }
    }
  }

  /**
   * Process and add an enum type to the proto root
   */
  private processEnumType(enumType: GraphQLEnumType): void {
    const typeName = enumType.name;

    if (!this.createdEnums.has(typeName)) {
      const protoEnum = buildEnumType(enumType, {
        includeComments: this.includeComments,
      });
      this.root.add(protoEnum);
      this.createdEnums.add(typeName);
    }
  }

  /**
   * Helper: Get root operation type
   */
  private getRootType(operationType: OperationTypeNode): GraphQLObjectType {
    switch (operationType) {
      case OperationTypeNode.QUERY:
        return this.schema.getQueryType()!;
      case OperationTypeNode.MUTATION:
        return this.schema.getMutationType()!;
      case OperationTypeNode.SUBSCRIPTION:
        return this.schema.getSubscriptionType()!;
    }
  }

  /**
   * Get the current lock data for field number stability
   */
  public getLockData(): ProtoLock {
    return this.lockManager.getLockData();
  }

  /**
   * Creates wrapper messages for nested GraphQL lists
   * Similar to sdl-to-proto-visitor.ts createNestedListWrapper
   *
   * @param level - The nesting level (1 for simple wrapper, >1 for nested structures)
   * @param baseTypeName - The base type name being wrapped (e.g., "String", "User")
   * @returns The generated wrapper message
   */
  private createNestedListWrapper(level: number, baseTypeName: string): protobuf.Type {
    const wrapperName = `${'ListOf'.repeat(level)}${baseTypeName}`;

    // Return existing wrapper if already created
    if (this.nestedListWrappers.has(wrapperName)) {
      return this.nestedListWrappers.get(wrapperName)!;
    }

    // Create the wrapper message
    const wrapperMessage = new protobuf.Type(wrapperName);

    // Create nested List message
    const listMessage = new protobuf.Type('List');

    // Determine the inner type name
    let innerTypeName: string;
    if (level > 1) {
      // For nested lists, reference the previous level wrapper
      innerTypeName = `${'ListOf'.repeat(level - 1)}${baseTypeName}`;
      // Ensure the inner wrapper exists
      if (!this.nestedListWrappers.has(innerTypeName)) {
        this.createNestedListWrapper(level - 1, baseTypeName);
      }
    } else {
      // For level 1, use the base type directly
      innerTypeName = baseTypeName;
    }

    // Add repeated items field to List message
    const itemsField = new protobuf.Field('items', 1, innerTypeName);
    itemsField.repeated = true;
    listMessage.add(itemsField);

    // Add List message to wrapper
    wrapperMessage.add(listMessage);

    // Add list field to wrapper message
    const listField = new protobuf.Field('list', 1, 'List');
    wrapperMessage.add(listField);

    // Store the wrapper
    this.nestedListWrappers.set(wrapperName, wrapperMessage);

    return wrapperMessage;
  }

  /**
   * Callback for builders to create nested list wrappers
   * This method is called by request-builder and message-builder when they encounter
   * a GraphQL type that requires a nested list wrapper
   *
   * @param graphqlType - The GraphQL type that needs a wrapper
   * @returns The wrapper message name
   */
  private createNestedListWrapperCallback(graphqlType: any): string {
    const typeInfo = mapGraphQLTypeToProto(graphqlType, {
      customScalarMappings: this.customScalarMappings,
    });

    if (!typeInfo.requiresNestedWrapper) {
      // This shouldn't happen, but return the type name as fallback
      return typeInfo.typeName;
    }

    // Create the wrapper message
    const wrapperName = typeInfo.typeName;
    const nestingLevel = typeInfo.nestingLevel || 1;

    // Extract base type name from wrapper name
    // e.g., "ListOfListOfString" -> "String"
    const baseTypeName = wrapperName.replace(/^(ListOf)+/, '');

    // Ensure all wrapper levels are created
    if (!this.nestedListWrappers.has(wrapperName) && !this.createdMessages.has(wrapperName)) {
      for (let i = 1; i <= nestingLevel; i++) {
        this.createNestedListWrapper(i, baseTypeName);
      }
    }

    return wrapperName;
  }
}
