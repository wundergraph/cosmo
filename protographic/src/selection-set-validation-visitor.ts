import {
  ASTNode,
  ASTVisitor,
  DocumentNode,
  FieldNode,
  GraphQLField,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLType,
  InlineFragmentNode,
  isInterfaceType,
  isNamedType,
  isUnionType,
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
 * This visitor traverses a parsed field set document and enforces constraints
 * specific to @requires directives:
 * - Abstract types (interfaces, unions) are not allowed
 * - Inline fragments are not allowed
 *
 * @example
 * ```typescript
 * const doc = parse('{ address { street city } }');
 * const visitor = new SelectionSetValidationVisitor(doc, ProductType);
 * visitor.visit();
 * const result = visitor.getValidationResult();
 * if (result.errors.length > 0) {
 *   console.error('Validation failed:', result.errors);
 * }
 * ```
 */
export class SelectionSetValidationVisitor {
  private currentType: GraphQLObjectType;
  private currentFieldSelectionSet: SelectionSetNode | undefined;
  private fieldSelectionSetStack: SelectionSetNode[] = [];
  private readonly operationDocument: DocumentNode;

  private readonly schema: GraphQLSchema;
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
   */
  constructor(operationDocument: DocumentNode, objectType: GraphQLObjectType, schema: GraphQLSchema, fix: boolean) {
    this.operationDocument = operationDocument;
    this.currentType = objectType;
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

  public getFixedSelection(): string {
    return print(this.operationDocument);
  }

  /**
   * Normalizes the parsed field set operation by rewriting abstract selections.
   * This ensures consistent handling of interface and union type selections.
   */
  private normalizeSelectionSet(): void {
    const visitor = new AbstractSelectionRewriter(this.operationDocument, this.schema, this.currentType);
    visitor.normalize();
  }

  /**
   * Creates the AST visitor configuration for traversing the document.
   *
   * @returns An ASTVisitor object with handlers for Field and SelectionSet nodes
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
   * Restores the previous type context when ascending back up the tree.
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

  /**
   * Unwraps a GraphQL type to get its underlying named type.
   * Strips NonNull and List wrappers to get the base type.
   *
   * @param type - The GraphQL type to unwrap
   * @returns The underlying named type
   */
  private getUnderlyingType(type: GraphQLType): GraphQLNamedType {
    while (!isNamedType(type)) {
      type = type.ofType;
    }

    return type;
  }

  /**
   * Retrieves the field definition for a field node from the current type.
   * If the field is not found, a validation error is recorded and null is returned.
   *
   * @param node - The field node to look up
   * @returns The GraphQL field definition, or null if not found
   */
  private getFieldDefinition(node: FieldNode): GraphQLField<any, any> | null {
    const fieldDef = this.currentType.getFields()[node.name.value];
    if (!fieldDef) {
      this.validationResult.errors.push(`Field '${node.name.value}' not found on type '${this.currentType.name}'`);
      return null;
    }
    return fieldDef;
  }

  /**
   * Type guard to check if a node is an InlineFragmentNode.
   *
   * @param node - The AST node or array of nodes to check
   * @returns True if the node is an InlineFragmentNode
   */
  private isInlineFragment(node: ASTNode | readonly ASTNode[]): node is InlineFragmentNode {
    if (Array.isArray(node)) {
      return false;
    }

    return (node as ASTNode).kind === Kind.INLINE_FRAGMENT;
  }

  private isSelectionSet(node: ASTNode | ReadonlyArray<ASTNode>): node is SelectionSetNode {
    if (Array.isArray(node)) {
      return false;
    }
    return (node as ASTNode).kind === Kind.SELECTION_SET;
  }

  /**
   * Type guard to check if a node is a FieldNode.
   *
   * @param node - The AST node or array of nodes to check
   * @returns True if the node is a FieldNode
   */
  private isFieldNode(node: ASTNode | ReadonlyArray<ASTNode>): node is FieldNode {
    if (Array.isArray(node)) {
      return false;
    }
    return (node as ASTNode).kind === Kind.FIELD;
  }

  /**
   * Checks if a named type is an abstract type (interface or union).
   *
   * @param node - The GraphQL named type to check
   * @returns True if the type is an interface or union type
   */
  private isAbstractType(node: GraphQLNamedType): boolean {
    return isInterfaceType(node) || isUnionType(node);
  }
}
