import {
  ASTNode,
  ASTVisitor,
  BREAK,
  DocumentNode,
  FieldNode,
  GraphQLField,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLType,
  InlineFragmentNode,
  isInterfaceType,
  isNamedType,
  isObjectType,
  isUnionType,
  Kind,
  SelectionSetNode,
  visit,
} from 'graphql';
import { VisitContext } from './types.js';
import { ValidationResult } from './sdl-validation-visitor.js';

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
  private ancestors: GraphQLObjectType[] = [];
  private readonly operationDocument: DocumentNode;

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
  constructor(operationDocument: DocumentNode, objectType: GraphQLObjectType) {
    this.operationDocument = operationDocument;
    this.currentType = objectType;
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
   * Creates the AST visitor configuration for traversing the document.
   *
   * @returns An ASTVisitor object with handlers for Field and SelectionSet nodes
   */
  private createASTVisitor(): ASTVisitor {
    return {
      Field: {
        enter: (node, key, parent, path, ancestors) => {
          return this.onEnterField({ node, key, parent, path, ancestors });
        },
      },
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
   * Handles entering a field node during traversal.
   * Validates that the field's type is not an abstract type (interface or union).
   *
   * @param ctx - The visit context containing the field node and its ancestors
   * @returns BREAK if validation fails to stop traversal, undefined otherwise
   */
  private onEnterField(ctx: VisitContext<FieldNode>): any {
    const fieldDefinition = this.getFieldDefinition(ctx.node);
    if (!fieldDefinition) {
      return;
    }

    const namedType = this.getUnderlyingType(fieldDefinition.type);

    if (this.isAbstractType(namedType)) {
      this.validationResult.errors.push(
        `Abstract types are not allowed in requires directives. Found ${namedType.name} in ${this.currentType.name}.${ctx.node.name.value}`,
      );
      return BREAK;
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
   * Handles entering a selection set node during traversal.
   * Validates that inline fragments are not used and updates the current type
   * context when descending into nested object types.
   *
   * @param ctx - The visit context containing the selection set node and its parent
   * @returns BREAK if validation fails to stop traversal, undefined otherwise
   */
  private onEnterSelectionSet(ctx: VisitContext<SelectionSetNode>): any {
    if (!ctx.parent) {
      return;
    }

    if (this.isInlineFragment(ctx.parent)) {
      this.validationResult.errors.push('Inline fragments are not allowed in requires directives');
      return BREAK;
    }

    if (!this.isFieldNode(ctx.parent)) {
      return;
    }

    const fieldDefinition = this.getFieldDefinition(ctx.parent);
    if (!fieldDefinition) {
      return;
    }

    const namedType = this.getUnderlyingType(fieldDefinition.type);
    if (isObjectType(namedType)) {
      this.ancestors.push(this.currentType);
      this.currentType = namedType;
    }
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

    if (!this.isFieldNode(ctx.parent)) {
      return;
    }

    this.currentType = this.ancestors.pop() ?? this.currentType;
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
