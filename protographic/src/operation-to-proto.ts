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
} from 'graphql';
import { createFieldNumberManager } from './operations/field-numbering.js';
import { buildMessageFromSelectionSet } from './operations/message-builder.js';
import { buildRequestMessage, buildInputObjectMessage, buildEnumType } from './operations/request-builder.js';
import { rootToProtoText } from './operations/proto-text-generator.js';
import {
  createRequestMessageName,
  createResponseMessageName,
  createOperationMethodName,
} from './naming-conventions.js';
import { upperFirst, camelCase } from 'lodash-es';
import { ProtoLock, ProtoLockManager } from './proto-lock.js';

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
  queryIdempotency?: 'NO_SIDE_EFFECTS' | 'DEFAULT';
  /** Lock data from previous compilation for field number stability */
  lockData?: ProtoLock;
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

  const schema =
    typeof schemaOrSDL === 'string'
      ? buildSchema(schemaOrSDL, {
          assumeValid: true,
          assumeValidSDL: true,
        })
      : schemaOrSDL;

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
  private readonly queryIdempotency?: 'NO_SIDE_EFFECTS' | 'DEFAULT';

  // Proto AST root
  private readonly root: protobuf.Root;

  // For tracking / avoiding duplicate messages and enums
  private createdMessages = new Set<string>();
  private createdEnums = new Set<string>();

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

    // 2. Create method name directly from operation name (no Query/Mutation prefix)
    const methodName = upperFirst(camelCase(operationName));

    // 3. Create request message from variables
    const requestMessageName = createRequestMessageName(methodName);
    const requestMessage = buildRequestMessage(requestMessageName, node.variableDefinitions || [], this.schema, {
      includeComments: this.includeComments,
      fieldNumberManager: this.fieldNumberManager,
      schema: this.schema,
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

    // 4. Create response message from selection set
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
      });

      // Add response message to root
      if (!this.createdMessages.has(responseMessageName)) {
        this.root.add(responseMessage);
        this.createdMessages.add(responseMessageName);
      }
    }

    // 5. Add method to service
    const method = new protobuf.Method(methodName, 'rpc', requestMessageName, responseMessageName);

    // Mark subscriptions as server streaming
    if (node.operation === OperationTypeNode.SUBSCRIPTION) {
      method.responseStream = true;
    }

    // Mark Query operations with idempotency level if specified
    if (this.queryIdempotency && node.operation === OperationTypeNode.QUERY) {
      (method as any).idempotencyLevel = this.queryIdempotency;
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
  private processInputObjectTypes(typeNode: any): void {
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
          });
          this.root.add(inputMessage);
          this.createdMessages.add(typeName);

          // Recursively process nested input objects and enums
          const fields = (type as GraphQLInputObjectType).getFields();
          for (const field of Object.values(fields)) {
            const fieldType = getNamedType(field.type);
            if (isInputObjectType(fieldType)) {
              this.processInputObjectTypes({ kind: 'NamedType', name: { value: fieldType.name } });
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
}
