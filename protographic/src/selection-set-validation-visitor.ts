import {
  ASTNode,
  ASTVisitor,
  DocumentNode,
  FieldNode,
  GraphQLObjectType,
  GraphQLSchema,
  InlineFragmentNode,
  Kind,
  SelectionSetNode,
  visit,
  print,
} from 'graphql';
import { VisitContext } from './types.js';
import { ValidationResult } from './sdl-validation-visitor.js';
import { AbstractSelectionRewriter } from './abstract-selection-rewriter.js';

/**
 * Validates selection sets within @requires directive field sets.
 *
 * This visitor traverses a parsed field set document and ensures that inline
 * fragments on composite types (interfaces, unions) include `__typename` for
 * type discrimination in protobuf. The `__typename` field can appear either
 * in the parent field's selection set or within each inline fragment's
 * selection set — at least one of these locations must contain it.
 *
 * Before validation, the selection set is normalized by the
 * {@link AbstractSelectionRewriter}, which distributes parent-level fields
 * (including `__typename`) into each inline fragment.
 */
export class SelectionSetValidationVisitor {
  private currentFieldSelectionSet: SelectionSetNode | undefined;
  private fieldSelectionSetStack: SelectionSetNode[] = [];
  private readonly operationDocument: DocumentNode;

  private readonly schema: GraphQLSchema;
  private readonly objectType: GraphQLObjectType;
  private readonly fix: boolean = false;

  private validationResult: ValidationResult = {
    errors: [],
    warnings: [],
  };

  /**
   * Creates a new SelectionSetValidationVisitor.
   *
   * @param operationDocument - The parsed GraphQL document representing the field set
   * @param objectType - The root GraphQL object type to validate against
   * @param schema - The full GraphQL schema, used for normalization of abstract type selections
   * @param fix - When true, missing `__typename` fields are added automatically instead of reporting errors
   */
  constructor(operationDocument: DocumentNode, objectType: GraphQLObjectType, schema: GraphQLSchema, fix: boolean) {
    this.operationDocument = operationDocument;
    this.objectType = objectType;
    this.schema = schema;
    this.fix = fix;

    this.normalizeSelectionSet();
  }

  /**
   * Executes the validation by traversing the operation document.
   * After calling this method, use `getValidationResult()` to retrieve any errors or warnings.
   */
  public visit(): void {
    visit(this.operationDocument, this.createASTVisitor());
  }

  /**
   * Returns the validation result containing any errors and warnings found during traversal.
   *
   * @returns The validation result with errors and warnings arrays
   */
  public getValidationResult(): ValidationResult {
    return this.validationResult;
  }

  /**
   * Normalizes the parsed field set operation by rewriting abstract selections.
   * This ensures consistent handling of interface and union type selections.
   */
  private normalizeSelectionSet(): void {
    const visitor = new AbstractSelectionRewriter(this.operationDocument, this.schema, this.objectType);
    visitor.normalize();
  }

  /**
   * Creates the AST visitor configuration for traversing the document.
   *
   * @returns An ASTVisitor object with enter/leave handlers for SelectionSet nodes
   */
  private createASTVisitor(): ASTVisitor {
    return {
      SelectionSet: {
        enter: (node, key, parent, path, ancestors) => {
          return this.onEnterSelectionSet({ node, key, parent, path, ancestors });
        },
        leave: (node, key, parent, path, ancestors) => {
          this.onLeaveSelectionSet({ node, key, parent, path, ancestors });
        },
      },
    };
  }

  /**
   * Handles entering a selection set node during traversal.
   *
   * @param ctx - The visit context containing the selection set node and its parent
   */
  private onEnterSelectionSet(ctx: VisitContext<SelectionSetNode>): void {
    // When we have no parent, we are at the root of the selection set.
    if (!ctx.parent) {
      return;
    }

    // We store the stack for field selection sets. We ignore the root selection set and the inline fragments in the stack
    if (this.isFieldNode(ctx.parent)) {
      this.currentFieldSelectionSet = ctx.node;
      this.fieldSelectionSetStack.push(ctx.node);
      return;
    }

    // We currently only check for inline fragments.
    if (!this.isInlineFragment(ctx.parent)) {
      return;
    }

    // either the selection set of the inline fragment or the parent selection set must contain __typename.
    if (
      !this.selectionSetContainsTypename(ctx.node) &&
      !this.selectionSetContainsTypename(this.currentFieldSelectionSet)
    ) {
      if (!this.fix) {
        this.validationResult.errors.push(
          `Selection set must contain __typename for inline fragment ${ctx.parent.typeCondition?.name.value}`,
        );
        return;
      }

      this.ensureTypenameInSelection(ctx.node);
    }
  }

  private ensureTypenameInSelection(selectionSet: SelectionSetNode): void {
    selectionSet.selections = [
      {
        kind: Kind.FIELD,
        name: { kind: Kind.NAME, value: '__typename' },
      },
      ...selectionSet.selections,
    ];
  }

  private selectionSetContainsTypename(selectionSet: SelectionSetNode | undefined): boolean {
    if (!selectionSet) {
      return false;
    }

    return selectionSet.selections.some(
      (selection) => selection.kind === Kind.FIELD && selection.name.value === '__typename',
    );
  }

  /**
   * Handles leaving a selection set node during traversal.
   * Restores the previous field selection set from the stack when leaving a field's selection set.
   *
   * @param ctx - The visit context containing the selection set node and its parent
   */
  private onLeaveSelectionSet(ctx: VisitContext<SelectionSetNode>): void {
    if (!ctx.parent) {
      return;
    }

    if (this.isFieldNode(ctx.parent)) {
      this.currentFieldSelectionSet = this.fieldSelectionSetStack.pop();
    }
  }

  private isInlineFragment(node: ASTNode | readonly ASTNode[]): node is InlineFragmentNode {
    if (Array.isArray(node)) {
      return false;
    }

    return (node as ASTNode).kind === Kind.INLINE_FRAGMENT;
  }

  private isFieldNode(node: ASTNode | ReadonlyArray<ASTNode>): node is FieldNode {
    if (Array.isArray(node)) {
      return false;
    }
    return (node as ASTNode).kind === Kind.FIELD;
  }
}
