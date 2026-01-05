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
import { CompositeMessageKind, ProtoMessage, RPCMethod } from './types';
import { KEY_DIRECTIVE_NAME } from './string-constants';
import {
  createEntityLookupRequestKeyMessageName,
  createRequestMessageName,
  createRequiredFieldsMethodName,
  createResponseMessageName,
  graphqlFieldToProtoField,
} from './naming-conventions';
import { getProtoTypeFromGraphQL } from './proto-utils';

type VisitContext<T extends ASTNode> = {
  node: T;
  key: string | number | undefined;
  parent: ASTNode | ReadonlyArray<ASTNode> | undefined;
  path: ReadonlyArray<string | number>;
  ancestors: ReadonlyArray<ASTNode | ReadonlyArray<ASTNode>>;
};

type RequiredFieldsVisitorOptions = {
  includeComments: boolean;
};

export class RequiredFieldsVisitor {
  private readonly visitor: ASTVisitor;
  private readonly fieldSetDoc: DocumentNode;

  private ancestors: GraphQLObjectType[] = [];
  private currentType: GraphQLObjectType | undefined = this.objectType;
  private keyDirectives: DirectiveNode[] = [];
  private currentKey?: DirectiveNode;

  /**
   * Collected RPC methods for the required fields
   */
  private rpcMethods: RPCMethod[] = [];
  private messageDefinitions: ProtoMessage[] = [];
  private requiredFieldMessage: ProtoMessage | undefined;
  private current: ProtoMessage | undefined;
  private stack: ProtoMessage[] = [];

  private currentInlineFragment?: InlineFragmentNode;
  private inlineFragmentStack: InlineFragmentNode[] = [];

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
    this.visitor = this.createASTVisitor();
  }

  public visit(): void {
    for (const keyDirective of this.keyDirectives) {
      this.currentKey = keyDirective;
      visit(this.fieldSetDoc, this.visitor);
    }
  }

  public getMessageDefinitions(): ProtoMessage[] {
    return this.messageDefinitions;
  }

  public getRPCMethods(): RPCMethod[] {
    return this.rpcMethods;
  }

  private resolveKeyDirectives(): void {
    this.keyDirectives = this.objectType.astNode?.directives?.filter((d) => d.name.value === KEY_DIRECTIVE_NAME) ?? [];
    if (this.keyDirectives.length === 0) {
      throw new Error('Object type has to be an entity type to make use of the @requires directive');
    }
  }

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

  private onLeaveDocument(): void {
    if (this.requiredFieldMessage) {
      this.messageDefinitions.push(this.requiredFieldMessage);
    }
  }

  private onEnterDocument(node: DocumentNode): void {
    // TODO: walk for each key directive.
    const keyFieldsString = this.getKeyFieldsString(this.currentKey!);
    const requiredFieldsMethodName = createRequiredFieldsMethodName(
      this.objectType.name,
      this.requiredField.name,
      keyFieldsString,
    );

    const requestMessageName = createRequestMessageName(requiredFieldsMethodName);
    const responseMessageName = createResponseMessageName(requiredFieldsMethodName);

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
    const entityKeyRequestMessageName = createEntityLookupRequestKeyMessageName(this.objectType.name, keyFieldsString);

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
    // this will be added to the message definitions when the document is left.
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

    // get the type name from the object type
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
    });
  }

  private handleCompositeType(fieldDefinition: GraphQLField<any, any, any>): void {
    if (!this.current) return;
    const compositeType = getNamedType(fieldDefinition.type);

    if (isInterfaceType(compositeType)) {
      this.current.compositeType = {
        kind: CompositeMessageKind.INTERFACE,
        implementingTypes: [],
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

  private onEnterInlineFragment(ctx: VisitContext<InlineFragmentNode>): void {
    if (this.currentInlineFragment) {
      this.inlineFragmentStack.push(this.currentInlineFragment);
    }

    this.currentInlineFragment = ctx.node;
  }

  private onLeaveInlineFragment(ctx: VisitContext<InlineFragmentNode>): void {
    const currentInlineFragment = this.currentInlineFragment;
    this.currentInlineFragment = this.inlineFragmentStack.pop() ?? undefined;

    if (!this.current || !this.current.compositeType) return;

    if (this.current.compositeType.kind === CompositeMessageKind.UNION) {
      this.current.compositeType.memberTypes.push(currentInlineFragment?.typeCondition?.name.value ?? '');
    } else {
      this.current.compositeType.implementingTypes.push(currentInlineFragment?.typeCondition?.name.value ?? '');
    }
  }

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

  private onLeaveSelectionSet(ctx: VisitContext<SelectionSetNode>): void {
    this.currentType = this.ancestors.pop() ?? this.currentType;
    this.current = this.stack.pop();
  }

  private isFieldNode(node: ASTNode | ReadonlyArray<ASTNode>): node is FieldNode {
    if (Array.isArray(node)) return false;
    return (node as ASTNode).kind === Kind.FIELD;
  }

  private isInlineFragmentNode(node: ASTNode | ReadonlyArray<ASTNode>): node is InlineFragmentNode {
    if (Array.isArray(node)) return false;
    return (node as ASTNode).kind === Kind.INLINE_FRAGMENT;
  }

  // TODO check if this is actually correct.
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

  private fieldDefinition(fieldName: string): GraphQLField<any, any, any> | undefined {
    return this.currentType?.getFields()[fieldName];
  }

  private findObjectType(typeName: string): GraphQLObjectType | undefined {
    const type = this.schema.getTypeMap()[typeName];
    if (!type) return undefined;

    if (!isObjectType(type)) return undefined;
    return type;
  }

  private getKeyFieldsString(directive: DirectiveNode): string {
    const fieldsArg = directive.arguments?.find((arg) => arg.name.value === 'fields');
    if (!fieldsArg) return '';

    return fieldsArg.value.kind === Kind.STRING ? fieldsArg.value.value : '';
  }

  private isCompositeType(type: GraphQLType): boolean {
    const namedType = getNamedType(type);
    return isInterfaceType(namedType) || isUnionType(namedType);
  }
}
