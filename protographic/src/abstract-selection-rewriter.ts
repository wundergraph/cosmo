/**
 * @file abstract-selection-rewriter.ts
 *
 * This module provides functionality to normalize GraphQL field set selections
 * when dealing with abstract types (interfaces). It ensures that fields selected
 * at the interface level are properly distributed into each inline fragment,
 * maintaining correct selection semantics for proto mapping generation.
 */

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
  GraphQLType,
  getNamedType,
  GraphQLInterfaceType,
  isObjectType,
  InlineFragmentNode,
} from 'graphql';
import { VisitContext } from './types.js';

type GraphQLTypeWithFields = GraphQLObjectType | GraphQLInterfaceType;

/**
 * Rewrites GraphQL selection sets to normalize abstract type selections.
 *
 * When a field returns an interface type, selections can be made both at the
 * interface level and within inline fragments for concrete types. This class
 * normalizes such selections by moving interface-level fields into each inline
 * fragment, ensuring consistent selection structure for downstream processing.
 *
 * @example
 * Input selection:
 * ```graphql
 * media {
 *   id          # interface-level field
 *   ... on Book { title }
 *   ... on Movie { duration }
 * }
 * ```
 *
 * Output after normalization:
 * ```graphql
 * media {
 *   ... on Book { id title }
 *   ... on Movie { id duration }
 * }
 * ```
 */
export class AbstractSelectionRewriter {
  private readonly visitor: ASTVisitor;
  private readonly fieldSetDoc: DocumentNode;
  public readonly schema: GraphQLSchema;
  private currentType: GraphQLTypeWithFields;
  /** Stack for tracking parent types during nested field traversal */
  private typeStack: GraphQLTypeWithFields[] = [];
  /** Boolean stack indicating whether to restore type/selection context when leaving a selection set */
  private rebalanceStack: boolean[] = [];
  /** The current selection set being processed, used for in-place AST mutations */
  private currentSelectionSet: SelectionSetNode | undefined;
  /** Stack for preserving parent selection set context during nested traversal */
  private selectionSetStack: SelectionSetNode[] = [];

  /**
   * Creates a new AbstractSelectionRewriter instance.
   *
   * @param fieldSetDoc - The parsed GraphQL document containing the field set to rewrite
   * @param schema - The GraphQL schema used for type resolution
   * @param objectType - The root object type where the field set originates
   */
  constructor(fieldSetDoc: DocumentNode, schema: GraphQLSchema, objectType: GraphQLTypeWithFields) {
    this.fieldSetDoc = fieldSetDoc;
    this.schema = schema;
    this.currentType = objectType;
    this.visitor = this.createASTVisitor();
  }

  /**
   * Creates the AST visitor that processes selection sets during traversal.
   *
   * @returns An ASTVisitor configured to handle SelectionSet nodes
   */
  private createASTVisitor(): ASTVisitor {
    return {
      SelectionSet: {
        enter: (node, key, parent, path, ancestors) => this.onEnterSelectionSet({ node, key, parent, path, ancestors }),
        leave: (node, key, parent, path, ancestors) => this.onLeaveSelectionSet({ node, key, parent, path, ancestors }),
      },
      InlineFragment: {
        enter: (node, key, parent, path, ancestors) =>
          this.onEnterInlineFragment({ node, key, parent, path, ancestors }),
      },
    };
  }

  /**
   * Executes the normalization process on the field set document.
   *
   * This method traverses the AST and rewrites any selection sets that target
   * interface types, distributing interface-level fields into inline fragments.
   * The modification is performed in-place on the provided document.
   */
  public normalize(): void {
    visit(this.fieldSetDoc, this.visitor);
  }

  /**
   * Handles the entry into a SelectionSet node during AST traversal.
   *
   * If the selection set's parent field returns an interface type, this method:
   * 1. Extracts all direct field selections (interface-level fields)
   * 2. Removes them from the selection set, leaving only inline fragments
   * 3. Prepends the interface-level fields to each inline fragment's selections
   *    (unless the fragment already contains that field)
   *
   * @param ctx - The visitor context containing the current node and its position in the AST
   */
  private onEnterSelectionSet(ctx: VisitContext<SelectionSetNode>): void {
    if (!ctx.parent) {
      return;
    }

    if (!this.isFieldNode(ctx.parent)) {
      this.rebalanceStack.push(false);
      return;
    }

    const fieldType = this.findNamedTypeForField(ctx.parent.name.value);
    if (!fieldType) {
      this.rebalanceStack.push(false);
      return;
    }

    if (!this.isTypeWithFields(fieldType)) {
      this.rebalanceStack.push(false);
      return;
    }

    this.typeStack.push(this.currentType);
    this.rebalanceStack.push(true);
    this.currentType = fieldType;

    if (this.currentSelectionSet) {
      this.selectionSetStack.push(this.currentSelectionSet);
    }

    this.currentSelectionSet = ctx.node;

    // Only process selection sets for interface types
    if (!isInterfaceType(fieldType)) {
      return;
    }

    this.appendValidInlineFragments(ctx.node);
    this.distributeFieldsIntoInlineFragments(ctx.node);
  }

  /**
   * Handles leaving a SelectionSet node during AST traversal.
   *
   * This method performs cleanup operations:
   * 1. Merges duplicate inline fragments with the same type condition
   * 2. Removes empty inline fragments (those with no selections)
   * 3. Restores the previous type and selection set context from stacks
   *
   * @param ctx - The visitor context containing the current node and its position in the AST
   */
  private onLeaveSelectionSet(ctx: VisitContext<SelectionSetNode>): void {
    if (!ctx.parent) {
      return;
    }

    this.mergeInlineFragments(ctx.node);
    this.removeEmptyInlineFragments(ctx.node);

    if (this.rebalanceStack.pop() ?? false) {
      this.currentType = this.typeStack.pop() ?? this.currentType;
      this.currentSelectionSet = this.selectionSetStack.pop();
    }
  }

  /**
   * Handles entering an InlineFragment node during AST traversal.
   *
   * This method processes inline fragments in two ways:
   *
   * 1. For non-interface fragments:
   *    - Validates if the fragment type implements the current interface
   *    - Removes invalid fragments (those targeting types that don't implement the interface)
   *
   * 2. For interface fragments:
   *    - Recursively processes nested interface selections
   *    - Unwraps the inline fragment by replacing it with its selections
   *    - Ensures nested interface fields are properly distributed
   *
   * @param ctx - The visitor context containing the current inline fragment node
   * @returns undefined to continue traversal, or nothing to skip
   */
  private onEnterInlineFragment(ctx: VisitContext<InlineFragmentNode>): any {
    if (!ctx.parent || !this.currentSelectionSet) {
      return;
    }

    if (!this.inlineFragmentIsInterfaceType(ctx.node)) {
      // Returning undefined continues traversal without deleting the node.
      // If the inline fragment targets a type that doesn't implement the current interface,
      // we remove it from the selections.
      if (!this.inlineFragmentIsValidForCurrentType(ctx.node)) {
        this.currentSelectionSet.selections = this.currentSelectionSet.selections.filter(
          (s) => s.kind !== Kind.INLINE_FRAGMENT || s.typeCondition?.name.value !== ctx.node.typeCondition?.name.value,
        );
      }

      return undefined;
    }

    this.appendValidInlineFragments(ctx.node.selectionSet);
    this.distributeFieldsIntoInlineFragments(ctx.node.selectionSet);

    const index = this.currentSelectionSet.selections.findIndex(
      (s) => s.kind === Kind.INLINE_FRAGMENT && s.typeCondition?.name.value === ctx.node.typeCondition?.name.value,
    );
    if (index < 0) {
      return;
    }

    // Replace the inline fragment in the current selection set with its selections (unwrap)
    this.currentSelectionSet.selections = [
      ...this.currentSelectionSet.selections.slice(0, index),
      ...ctx.node.selectionSet.selections,
      ...this.currentSelectionSet.selections.slice(index + 1),
    ];
  }

  /**
   * Merges duplicate inline fragments with the same type condition.
   *
   * When multiple inline fragments target the same concrete type, this method
   * combines them into a single fragment with all selections merged together.
   * The merged fragment replaces all duplicate fragments in the selection set.
   *
   * @param node - The selection set node containing inline fragments to merge
   */
  private mergeInlineFragments(node: SelectionSetNode): void {
    const selectedInlineFragments = node.selections.filter((s) => s.kind === Kind.INLINE_FRAGMENT);
    if (selectedInlineFragments.length === 0) {
      return;
    }

    const uniqueInlineFragments: InlineFragmentNode[] = [];

    for (const selectedFragment of selectedInlineFragments) {
      const unqiueFragment = uniqueInlineFragments.find(
        (f) => f.typeCondition?.name.value === selectedFragment.typeCondition?.name.value,
      );
      if (!unqiueFragment) {
        uniqueInlineFragments.push(selectedFragment);
        continue;
      }

      unqiueFragment.selectionSet.selections = [
        ...unqiueFragment.selectionSet.selections,
        ...selectedFragment.selectionSet.selections,
      ];
    }

    node.selections = [...uniqueInlineFragments];
  }

  /**
   * Removes empty inline fragments from a selection set.
   *
   * Filters out any inline fragment that has no selections in its selection set.
   * This cleanup step is performed after field distribution and merging operations
   * to ensure only meaningful fragments remain in the AST.
   *
   * @param node - The selection set node to clean up
   */
  private removeEmptyInlineFragments(node: SelectionSetNode): void {
    node.selections = node.selections.filter(
      (s) => s.kind !== Kind.INLINE_FRAGMENT || s.selectionSet.selections.length > 0,
    );
  }

  /**
   * Appends inline fragments for all possible types that implement the current interface.
   *
   * When processing an interface type selection with interface-level fields, this method
   * ensures that every concrete type implementing the interface has a corresponding
   * inline fragment. Creates new fragments only for types that don't already have one.
   *
   * This guarantees that interface-level fields can be distributed to all implementing
   * types, even if the original query didn't explicitly include fragments for them.
   *
   * @param node - The selection set node to append inline fragments to
   */
  private appendValidInlineFragments(node: SelectionSetNode): void {
    if (!isInterfaceType(this.currentType)) {
      return;
    }

    const fields = node.selections.filter((s) => s.kind === Kind.FIELD);
    if (fields.length === 0) {
      return;
    }

    const selectedInlineFragments = node.selections.filter((s) => s.kind === Kind.INLINE_FRAGMENT);
    const possibleTypes = this.schema.getPossibleTypes(this.currentType);

    const newInlineFragments: InlineFragmentNode[] = [];

    for (const possibleType of possibleTypes) {
      if (!selectedInlineFragments.some((s) => s.typeCondition?.name.value === possibleType.name)) {
        newInlineFragments.push(this.createInlineFragment(possibleType, fields));
      }
    }

    node.selections = [...fields, ...newInlineFragments, ...selectedInlineFragments];
  }

  /**
   * Creates an inline fragment AST node for a specific concrete type.
   *
   * Constructs a minimal InlineFragmentNode with:
   * - Type condition targeting the specified object type
   * - Filtered field selections (only includes fields that exist on the target type)
   * - Simple field nodes with name only (no aliases, arguments, or directives)
   *
   * @param type - The concrete object type to create a fragment for
   * @param fields - The interface-level fields to include in the fragment
   * @returns A new InlineFragmentNode with the filtered field selections
   */
  private createInlineFragment(type: GraphQLObjectType, fields: FieldNode[]): InlineFragmentNode {
    return {
      kind: Kind.INLINE_FRAGMENT,
      directives: [],
      typeCondition: {
        kind: Kind.NAMED_TYPE,
        name: { kind: Kind.NAME, value: type.name },
      },
      selectionSet: {
        kind: Kind.SELECTION_SET,
        selections: fields
          .filter((f) => type.getFields()[f.name.value])
          .map((f) => ({
            kind: Kind.FIELD,
            name: { kind: Kind.NAME, value: f.name.value },
          })),
      },
    };
  }

  /**
   * Distributes interface-level fields into all inline fragments.
   *
   * This is the core normalization logic that:
   * 1. Extracts all direct field selections from the selection set
   * 2. Removes those fields from the parent selection set
   * 3. Adds each field to the inline fragments where it doesn't already exist
   * 4. Validates that each field exists on the fragment's concrete type
   *
   * Fields are prepended to maintain their original order relative to fragment-specific fields.
   * Duplicate fields within a fragment are avoided by checking existing selections.
   *
   * @param node - The selection set node containing fields and inline fragments
   */
  private distributeFieldsIntoInlineFragments(node: SelectionSetNode): void {
    const fields = node.selections.filter((s) => s.kind === Kind.FIELD);
    if (fields.length === 0) {
      return;
    }

    const inlineFragments = node.selections.filter((s) => s.kind === Kind.INLINE_FRAGMENT);

    // Keep only the inline fragments in the selection set.
    node.selections = [...inlineFragments];

    for (const fragment of inlineFragments) {
      const inlineFragmentType = this.schema.getType(fragment.typeCondition?.name.value ?? '');
      if (!inlineFragmentType || !this.isTypeWithFields(inlineFragmentType)) {
        continue;
      }

      const existingFields = new Set<string>(
        fragment.selectionSet.selections.filter((s) => s.kind === Kind.FIELD).map((s) => s.name.value) ?? [],
      );

      // Add interface fields to the inline fragment, but only if the fragment type defines the field.
      // During normalization we might have parent inline fragments that include fields that would be added to
      // the wrong inline fragments.
      const fieldsToAdd = fields
        .filter((field) => !existingFields.has(field.name.value))
        .filter((field) => inlineFragmentType.getFields()[field.name.value]);

      // Add the interface fields to the fragment. We always prepend them for now.
      // TODO: Check if fields should be inserted in the order of appearance in the selection set.
      fragment.selectionSet.selections = [...fieldsToAdd, ...fragment.selectionSet.selections];
    }
  }

  /**
   * Checks if an inline fragment's type condition targets an interface type.
   *
   * @param node - The inline fragment node to check
   * @returns true if the fragment targets an interface type, false otherwise
   */
  private inlineFragmentIsInterfaceType(node: InlineFragmentNode): boolean {
    const type = this.schema.getType(node.typeCondition?.name.value ?? '');
    return isInterfaceType(type);
  }

  /**
   * Validates whether an inline fragment is valid for the current interface type.
   *
   * An inline fragment is considered valid if:
   * - The current type is not an interface (always valid)
   * - The fragment's type is an object type that implements the current interface
   *
   * Invalid fragments (those targeting types that don't implement the interface)
   * should be removed from the selection set.
   *
   * @param node - The inline fragment node to validate
   * @returns true if the fragment is valid for the current type context, false otherwise
   */
  private inlineFragmentIsValidForCurrentType(node: InlineFragmentNode): boolean {
    if (!isInterfaceType(this.currentType)) {
      return true;
    }

    const type = this.schema.getType(node.typeCondition?.name.value ?? '');
    if (!type) {
      // Type not found in schema - invalid fragment
      return false;
    }

    if (!isObjectType(type)) {
      // Non-object types cannot implement interfaces
      return false;
    }

    return type.getInterfaces().some((i) => i.name === this.currentType.name);
  }

  /**
   * Type guard to check if an AST node is a FieldNode.
   *
   * @param node - The AST node or array of nodes to check
   * @returns true if the node is a FieldNode, false otherwise
   */
  private isFieldNode(node: ASTNode | ReadonlyArray<ASTNode>): node is FieldNode {
    if (Array.isArray(node)) {
      return false;
    }
    return (node as ASTNode).kind === Kind.FIELD;
  }

  /**
   * Finds the named (unwrapped) type for a field by its name.
   *
   * This method looks up the field in the current type's fields and returns
   * the named type (stripping away any List or NonNull wrappers).
   *
   * @param fieldName - The name of the field to look up
   * @returns The named GraphQL type, or undefined if the field doesn't exist
   */
  private findNamedTypeForField(fieldName: string): GraphQLType | undefined {
    const fields = this.currentType.getFields();
    const field = fields[fieldName];
    if (!field) {
      return undefined;
    }

    return getNamedType(field.type);
  }

  /**
   * Type guard to check if a GraphQL type has fields.
   *
   * @param type - The GraphQL type to check
   * @returns true if the type is an object type or interface type (both have getFields method)
   */
  private isTypeWithFields(type: GraphQLType): type is GraphQLTypeWithFields {
    return isObjectType(type) || isInterfaceType(type);
  }
}
