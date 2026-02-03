import {
  ASTNode,
  ASTVisitor,
  DirectiveNode,
  DocumentNode,
  FieldNode,
  getNamedType,
  GraphQLField,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLType,
  InlineFragmentNode,
  isInterfaceType,
  isObjectType,
  isUnionType,
  Kind,
  parse,
  SelectionSetNode,
  visit,
} from 'graphql';
import { CompositeMessageKind, ProtoMessage, ProtoMessageField, RPCMethod, VisitContext } from './types';
import { KEY_DIRECTIVE_NAME } from './string-constants';
import {
  createEntityLookupRequestKeyMessageName,
  createRequestMessageName,
  createRequiredFieldsMethodName,
  createResponseMessageName,
  graphqlFieldToProtoField,
} from './naming-conventions';
import { getProtoTypeFromGraphQL } from './proto-utils';
import { AbstractSelectionRewriter } from './abstract-selection-rewriter';
import { FieldMapping, TypeFieldMapping } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';

/**
 * Configuration options for the RequiredFieldsVisitor.
 */
type RequiredFieldsVisitorOptions = {
  includeComments: boolean;
};

/**
 * A record mapping key directive strings to their corresponding RequiredFieldMapping.
 * Each entity can have multiple @key directives, and each key needs its own RPC mapping.
 */
type RequiredFieldMappings = Record<string, RequiredFieldMapping>;

/**
 * Represents the mapping configuration for a single @requires field.
 * This mapping is keyed by the @key directive fields string.
 */
export type RequiredFieldMapping = {
  /** The RPC method configuration for resolving this required field */
  rpc?: RPCMethod;
  /** The field mapping between GraphQL and proto field names */
  requiredFieldMapping?: FieldMapping;
};

/**
 * Generates protobuf messages and RPC methods for @requires directive field sets.
 *
 * This visitor processes the field set defined in a @requires directive and generates:
 * - RPC method definitions for fetching required fields
 * - Request/response message definitions
 * - Field mappings between GraphQL and protobuf
 *
 * The visitor handles each @key directive on the entity separately, creating
 * distinct RPC methods for each key since required fields may need to be
 * fetched using different entity keys.
 *
 * @example
 * ```typescript
 * const visitor = new RequiredFieldsVisitor(
 *   schema,
 *   ProductType,
 *   weightField,
 *   'dimensions { width height }'
 * );
 * visitor.visit();
 *
 * const messages = visitor.getMessageDefinitions();
 * const rpcs = visitor.getRPCMethods();
 * const mappings = visitor.getMapping();
 * ```
 */
export class RequiredFieldsVisitor {
  private readonly visitor: ASTVisitor;
  private readonly fieldSetDoc: DocumentNode;

  private ancestors: GraphQLObjectType[] = [];
  private currentType: GraphQLObjectType | undefined = this.objectType;
  private keyDirectives: DirectiveNode[] = [];
  private currentKeyFieldsString: string = '';

  /** Collected RPC methods for the required fields */
  private rpcMethods: RPCMethod[] = [];
  /** All generated protobuf message definitions */
  private messageDefinitions: ProtoMessage[] = [];
  /** The current required field message being built */
  private requiredFieldMessage: ProtoMessage | undefined;
  /** The current message context during traversal */
  private current: ProtoMessage | undefined;
  /** Stack for tracking nested message contexts */
  private stack: ProtoMessage[] = [];

  private currentInlineFragment?: InlineFragmentNode;
  private inlineFragmentStack: InlineFragmentNode[] = [];

  /** Mappings keyed by @key directive fields string */
  private mapping: RequiredFieldMappings = {};

  /**
   * Creates a new RequiredFieldsVisitor.
   *
   * @param schema - The GraphQL schema containing type definitions
   * @param objectType - The entity type that has the @requires directive
   * @param requiredField - The field with the @requires directive
   * @param fieldSet - The field set string from the @requires directive (e.g., "dimensions { width height }")
   * @param options - Optional configuration options
   * @throws Error if the object type is not an entity (has no @key directive)
   */
  constructor(
    private readonly schema: GraphQLSchema,
    private readonly objectType: GraphQLObjectType,
    private readonly requiredField: GraphQLField<any, any, any>,
    fieldSet: string,
    options: RequiredFieldsVisitorOptions = {
      includeComments: false,
    },
  ) {
    this.resolveKeyDirectives();
    this.fieldSetDoc = parse(`{ ${fieldSet} }`);
    this.normalizeOperation();
    this.visitor = this.createASTVisitor();
    this.mapping = {};
  }

  /**
   * Executes the visitor, processing the field set for each @key directive.
   * Creates separate RPC methods and mappings for each entity key.
   */
  public visit(): void {
    for (const keyDirective of this.keyDirectives) {
      this.currentKeyFieldsString = this.getKeyFieldsString(keyDirective);

      this.mapping[this.currentKeyFieldsString] = {
        requiredFieldMapping: new FieldMapping({
          original: this.requiredField.name,
          mapped: graphqlFieldToProtoField(this.requiredField.name),
        }),
      };
      visit(this.fieldSetDoc, this.visitor);
    }
  }

  /**
   * Normalizes the parsed field set operation by rewriting abstract selections.
   * This ensures consistent handling of interface and union type selections.
   */
  private normalizeOperation(): void {
    const visitor = new AbstractSelectionRewriter(this.fieldSetDoc, this.schema, this.objectType);
    visitor.normalize();
  }

  /**
   * Returns all generated protobuf message definitions.
   *
   * @returns Array of ProtoMessage definitions for request, response, and nested messages
   */
  public getMessageDefinitions(): ProtoMessage[] {
    return this.messageDefinitions;
  }

  /**
   * Returns the generated RPC method definitions.
   *
   * @returns Array of RPCMethod definitions for fetching required fields
   */
  public getRPCMethods(): RPCMethod[] {
    return this.rpcMethods;
  }

  /**
   * Returns the field mappings keyed by @key directive fields string.
   *
   * @returns Record mapping key strings to their RequiredFieldMapping configurations
   */
  public getMapping(): RequiredFieldMappings {
    return this.mapping;
  }

  /**
   * Resolves all @key directives from the object type.
   * Each key directive will result in a separate RPC method.
   *
   * @throws Error if the object type has no @key directives
   */
  private resolveKeyDirectives(): void {
    this.keyDirectives = this.objectType.astNode?.directives?.filter((d) => d.name.value === KEY_DIRECTIVE_NAME) ?? [];
    if (this.keyDirectives.length === 0) {
      throw new Error('Object type has to be an entity type to make use of the @requires directive');
    }
  }

  /**
   * Creates the AST visitor configuration for traversing the field set document.
   *
   * @returns An ASTVisitor with handlers for Document, Field, InlineFragment, and SelectionSet nodes
   */
  private createASTVisitor(): ASTVisitor {
    return {
      Document: {
        enter: (node) => {
          this.onEnterDocument(node);
        },
        leave: () => {
          this.onLeaveDocument();
        },
      },
      Field: {
        enter: (node, key, parent, path, ancestors) => {
          this.onEnterField({ node, key, parent, path, ancestors });
        },
      },
      InlineFragment: {
        enter: (node, key, parent, path, ancestors) => {
          this.onEnterInlineFragment({ node, key, parent, path, ancestors });
        },
        leave: (node, key, parent, path, ancestors) => {
          this.onLeaveInlineFragment({ node, key, parent, path, ancestors });
        },
      },
      SelectionSet: {
        enter: (node, key, parent, path, ancestors) => {
          this.onEnterSelectionSet({ node, key, parent, path, ancestors });
        },
        leave: (node, key, parent, path, ancestors) => {
          this.onLeaveSelectionSet({ node, key, parent, path, ancestors });
        },
      },
    };
  }

  /**
   * Handles leaving the document node.
   * Finalizes the required field message and generates type field mappings.
   */
  private onLeaveDocument(): void {
    if (this.requiredFieldMessage) {
      this.messageDefinitions.push(this.requiredFieldMessage);
    }
  }

  /**
   * Creates a FieldMapping for a required field's proto message field.
   *
   * @param field - The proto message field to create a mapping for
   * @returns A FieldMapping with original GraphQL name and mapped proto name
   */
  private createFieldMappingForRequiredField(field: ProtoMessageField): FieldMapping {
    return new FieldMapping({
      original: field.graphqlName ?? field.fieldName,
      mapped: field.fieldName,
      argumentMappings: [], // TODO: add argument mappings.
    });
  }

  /**
   * Handles entering the document node.
   * Creates the RPC method definition and all request/response message structures
   * for fetching the required fields.
   *
   * @param node - The document node being entered
   */
  private onEnterDocument(node: DocumentNode): void {
    const requiredFieldsMethodName = createRequiredFieldsMethodName(
      this.objectType.name,
      this.requiredField.name,
      this.currentKeyFieldsString,
    );

    const requestMessageName = createRequestMessageName(requiredFieldsMethodName);
    const responseMessageName = createResponseMessageName(requiredFieldsMethodName);

    this.mapping[this.currentKeyFieldsString].rpc = {
      name: requiredFieldsMethodName,
      request: requestMessageName,
      response: responseMessageName,
    };

    this.rpcMethods.push({
      name: requiredFieldsMethodName,
      request: requestMessageName,
      response: responseMessageName,
    });

    // Request messages
    const contextMessageName = `${requiredFieldsMethodName}Context`;
    this.messageDefinitions.push({
      messageName: requestMessageName,
      fields: [
        {
          fieldName: 'context',
          typeName: contextMessageName,
          fieldNumber: 1,
          isRepeated: true,
          description: `${contextMessageName} provides the context for the required fields method ${requiredFieldsMethodName}.`,
        },
      ],
    });

    const fieldsMessageName = `${requiredFieldsMethodName}Fields`;
    const entityKeyRequestMessageName = createEntityLookupRequestKeyMessageName(
      this.objectType.name,
      this.currentKeyFieldsString,
    );

    this.messageDefinitions.push({
      messageName: contextMessageName,
      fields: [
        {
          fieldName: 'key',
          typeName: entityKeyRequestMessageName,
          fieldNumber: 1,
        },
        {
          fieldName: 'fields',
          typeName: fieldsMessageName,
          fieldNumber: 2,
        },
      ],
    });

    // Define the prototype for the required fields message.
    // This will be added to the message definitions when the document is left.
    this.requiredFieldMessage = {
      messageName: fieldsMessageName,
      fields: [],
    };

    // Response messages
    const resultMessageName = `${requiredFieldsMethodName}Result`;
    this.messageDefinitions.push({
      messageName: responseMessageName,
      fields: [
        {
          fieldName: 'result',
          typeName: resultMessageName,
          fieldNumber: 1,
          isRepeated: true,
          description: `${resultMessageName} provides the result for the required fields method ${requiredFieldsMethodName}.`,
        },
      ],
    });

    // Get the type name from the required field
    const typeInfo = getProtoTypeFromGraphQL(false, this.requiredField.type);

    this.messageDefinitions.push({
      messageName: resultMessageName,
      fields: [
        {
          fieldName: graphqlFieldToProtoField(this.requiredField.name),
          typeName: typeInfo.typeName,
          fieldNumber: 1,
          isRepeated: typeInfo.isRepeated,
        },
      ],
    });

    this.stack.push(this.requiredFieldMessage);
    this.current = this.requiredFieldMessage;
  }

  /**
   * Handles entering a field node during traversal.
   * Adds the field to the current proto message with appropriate type mapping.
   *
   * @param ctx - The visit context containing the field node and its ancestors
   * @throws Error if the field definition is not found on the current type
   */
  private onEnterField(ctx: VisitContext<FieldNode>): void {
    if (!this.current) return;

    const fieldDefinition = this.fieldDefinition(ctx.node.name.value);
    if (!fieldDefinition) throw new Error(`Field definition not found for field ${ctx.node.name.value}`);

    if (this.isCompositeType(fieldDefinition.type)) {
      this.handleCompositeType(fieldDefinition);
    }

    const typeInfo = getProtoTypeFromGraphQL(false, fieldDefinition.type);
    this.current.fields.push({
      fieldName: graphqlFieldToProtoField(fieldDefinition.name),
      typeName: typeInfo.typeName,
      fieldNumber: this.current?.fields.length + 1,
      isRepeated: typeInfo.isRepeated,
      graphqlName: fieldDefinition.name,
    });
  }

  /**
   * Handles entering an inline fragment node.
   * Pushes the current inline fragment onto the stack for nested fragment handling.
   *
   * @param ctx - The visit context containing the inline fragment node
   */
  private onEnterInlineFragment(ctx: VisitContext<InlineFragmentNode>): void {
    if (this.currentInlineFragment) {
      this.inlineFragmentStack.push(this.currentInlineFragment);
    }

    this.currentInlineFragment = ctx.node;
  }

  /**
   * Handles leaving an inline fragment node.
   * Records union member types when processing union type fragments.
   *
   * @param ctx - The visit context containing the inline fragment node
   */
  private onLeaveInlineFragment(ctx: VisitContext<InlineFragmentNode>): void {
    const currentInlineFragment = this.currentInlineFragment;
    this.currentInlineFragment = this.inlineFragmentStack.pop() ?? undefined;

    if (!this.current || !this.current.compositeType) return;

    if (this.current.compositeType.kind === CompositeMessageKind.UNION) {
      this.current.compositeType.memberTypes.push(currentInlineFragment?.typeCondition?.name.value ?? '');
    }
  }

  /**
   * Handles entering a selection set node.
   * Creates a new nested proto message for object type selections and updates
   * the current type context for proper field resolution.
   *
   * @param ctx - The visit context containing the selection set node and its parent
   */
  private onEnterSelectionSet(ctx: VisitContext<SelectionSetNode>): void {
    if (!ctx.parent || !this.current) return;

    let currentType: GraphQLType | undefined;
    if (this.isFieldNode(ctx.parent)) {
      currentType = this.findObjectTypeForField(ctx.parent.name.value) ?? undefined;
      if (!currentType) {
        // TODO: handle this case. Could be a union or interface type.
        return;
      }
    } else if (this.isInlineFragmentNode(ctx.parent)) {
      const typeName = ctx.parent.typeCondition?.name.value;
      if (!typeName) return;

      currentType = this.findObjectType(typeName) ?? undefined;
    } else {
      return;
    }

    if (!this.currentType) return;

    this.ancestors.push(this.currentType);
    this.currentType = currentType;

    // Create a new nested message for the current type.
    let nested: ProtoMessage = {
      messageName: this.currentType?.name ?? '',
      fields: [],
    };

    if (!this.current.nestedMessages) {
      this.current.nestedMessages = [];
    }

    this.current.nestedMessages.push(nested);

    this.stack.push(this.current);
    this.current = nested;
  }

  /**
   * Handles leaving a selection set node.
   * Restores the previous type and message context when ascending the tree.
   *
   * @param ctx - The visit context containing the selection set node
   */
  private onLeaveSelectionSet(ctx: VisitContext<SelectionSetNode>): void {
    this.currentType = this.ancestors.pop() ?? this.currentType;
    this.current = this.stack.pop();
  }

  /**
   * Handles composite types (interfaces and unions) by setting up the
   * appropriate composite type metadata on the current message.
   *
   * @param fieldDefinition - The field definition with a composite type
   */
  private handleCompositeType(fieldDefinition: GraphQLField<any, any, any>): void {
    if (!this.current) return;
    const compositeType = getNamedType(fieldDefinition.type);

    if (isInterfaceType(compositeType)) {
      this.current.compositeType = {
        kind: CompositeMessageKind.INTERFACE,
        implementingTypes: this.schema.getImplementations(compositeType).objects.map((o) => o.name),
        typeName: compositeType.name,
      };

      return;
    }

    if (isUnionType(compositeType)) {
      this.current.compositeType = {
        kind: CompositeMessageKind.UNION,
        memberTypes: [],
        typeName: compositeType.name,
      };

      return;
    }
  }

  /**
   * Type guard to check if a node is a FieldNode.
   *
   * @param node - The AST node or array of nodes to check
   * @returns True if the node is a FieldNode
   */
  private isFieldNode(node: ASTNode | ReadonlyArray<ASTNode>): node is FieldNode {
    if (Array.isArray(node)) return false;
    return (node as ASTNode).kind === Kind.FIELD;
  }

  /**
   * Type guard to check if a node is an InlineFragmentNode.
   *
   * @param node - The AST node or array of nodes to check
   * @returns True if the node is an InlineFragmentNode
   */
  private isInlineFragmentNode(node: ASTNode | ReadonlyArray<ASTNode>): node is InlineFragmentNode {
    if (Array.isArray(node)) return false;
    return (node as ASTNode).kind === Kind.INLINE_FRAGMENT;
  }

  /**
   * Finds the GraphQL object type for a field by looking up the field's return type.
   *
   * @param fieldName - The name of the field to look up
   * @returns The GraphQL object type if the field returns an object type, undefined otherwise
   */
  private findObjectTypeForField(fieldName: string): GraphQLObjectType | undefined {
    const fields = this.currentType?.getFields() ?? {};
    const field = fields[fieldName];
    if (!field) return undefined;

    const namedType = getNamedType(field.type);
    if (isObjectType(namedType)) {
      return namedType;
    }

    return undefined;
  }

  /**
   * Retrieves the field definition for a field name from the current type.
   *
   * @param fieldName - The name of the field to look up
   * @returns The GraphQL field definition, or undefined if not found
   */
  private fieldDefinition(fieldName: string): GraphQLField<any, any, any> | undefined {
    return this.currentType?.getFields()[fieldName];
  }

  /**
   * Finds a GraphQL object type by name from the schema's type map.
   *
   * @param typeName - The name of the type to find
   * @returns The GraphQL object type if found and is an object type, undefined otherwise
   */
  private findObjectType(typeName: string): GraphQLObjectType | undefined {
    const type = this.schema.getTypeMap()[typeName];
    if (!type) return undefined;

    if (!isObjectType(type)) return undefined;
    return type;
  }

  /**
   * Extracts the fields string from a @key directive's fields argument.
   *
   * @param directive - The @key directive node
   * @returns The fields string value, or empty string if not found
   */
  private getKeyFieldsString(directive: DirectiveNode): string {
    const fieldsArg = directive.arguments?.find((arg) => arg.name.value === 'fields');
    if (!fieldsArg) return '';

    return fieldsArg.value.kind === Kind.STRING ? fieldsArg.value.value : '';
  }

  /**
   * Checks if a GraphQL type is a composite type (interface or union).
   *
   * @param type - The GraphQL type to check
   * @returns True if the type is an interface or union type
   */
  private isCompositeType(type: GraphQLType): boolean {
    const namedType = getNamedType(type);
    return isInterfaceType(namedType) || isUnionType(namedType);
  }
}
