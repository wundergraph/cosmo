import {
  ASTVisitor,
  DocumentNode,
  GraphQLSchema,
  GraphQLObjectType,
  visit,
  SelectionSetNode,
  isInterfaceType,
  Kind,
  FieldNode,
  ASTNode,
  GraphQLField,
  GraphQLType,
  getNamedType,
} from 'graphql';
import { VisitContext } from './types';

// TODO: The full functionality will be implemented in the second iteration.
/**
 * AbstractSelectionRewriter is a visitor implementation that normalizes an operation document
 * by rewriting abstract type selections for interfaces to the concrete types.
 *
 * This normalizes the operation and allows us to determine the proper types needed to generate proto messages.
 *
 */
export class AbstractSelectionRewriter {
  private readonly visitor: ASTVisitor;
  private readonly fieldSetDoc: DocumentNode;
  public readonly schema: GraphQLSchema;
  private normalizedFiedSetDoc: DocumentNode | undefined;

  private ancestors: GraphQLObjectType[] = [];
  private currentType: GraphQLObjectType;

  constructor(fieldSetDoc: DocumentNode, schema: GraphQLSchema, objectType: GraphQLObjectType) {
    this.fieldSetDoc = fieldSetDoc;
    this.schema = schema;
    this.currentType = objectType;
    this.visitor = this.createASTVisitor();
  }

  private createASTVisitor(): ASTVisitor {
    return {
      SelectionSet: {
        enter: (node, key, parent, path, ancestors) => {
          this.onEnterSelectionSet({ node, key, parent, path, ancestors });
        },
      },
    };
  }

  public normalize(): void {
    visit(this.fieldSetDoc, this.visitor);
  }

  private onEnterSelectionSet(ctx: VisitContext<SelectionSetNode>): void {
    if (!ctx.parent) return;
    if (!this.isFieldNode(ctx.parent)) return;

    const currentType = this.findNamedTypeForField(ctx.parent.name.value);
    if (!currentType) return;

    if (!isInterfaceType(currentType)) {
      return;
    }

    const fields = ctx.node.selections.filter((s) => s.kind === Kind.FIELD);
    const inlineFragments = ctx.node.selections.filter((s) => s.kind === Kind.INLINE_FRAGMENT);

    // remove the fields from the selection set.
    ctx.node.selections = [...inlineFragments];

    for (const fragment of inlineFragments) {
      const normalizedFields = fragment.selectionSet.selections.filter((s) => s.kind === Kind.FIELD) ?? [];

      for (const field of fields) {
        if (this.hasField(normalizedFields, field.name.value)) {
          continue;
        }

        normalizedFields.unshift(field);
      }

      fragment.selectionSet.selections = [...normalizedFields];
    }
  }

  private hasField(fields: FieldNode[], fieldName: string): boolean {
    return fields.some((f) => f.name.value === fieldName);
  }

  private isFieldNode(node: ASTNode | ReadonlyArray<ASTNode>): node is FieldNode {
    if (Array.isArray(node)) return false;
    return (node as ASTNode).kind === Kind.FIELD;
  }

  private fieldDefinition(fieldName: string): GraphQLField<any, any, any> | undefined {
    return this.currentType.getFields()[fieldName];
  }

  private findNamedTypeForField(fieldName: string): GraphQLType | undefined {
    const fields = this.currentType.getFields();
    const field = fields[fieldName];
    if (!field) return undefined;

    return getNamedType(field.type);
  }
}
