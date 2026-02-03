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
  GraphQLField,
  GraphQLType,
  getNamedType,
} from 'graphql';
import { VisitContext } from './types';

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
  private currentType: GraphQLObjectType;

  /**
   * Creates a new AbstractSelectionRewriter instance.
   *
   * @param fieldSetDoc - The parsed GraphQL document containing the field set to rewrite
   * @param schema - The GraphQL schema used for type resolution
   * @param objectType - The root object type where the field set originates
   */
  constructor(fieldSetDoc: DocumentNode, schema: GraphQLSchema, objectType: GraphQLObjectType) {
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
        enter: (node, key, parent, path, ancestors) => {
          this.onEnterSelectionSet({ node, key, parent, path, ancestors });
        },
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
    if (!ctx.parent) return;
    if (!this.isFieldNode(ctx.parent)) return;

    const currentType = this.findNamedTypeForField(ctx.parent.name.value);
    if (!currentType) return;

    // Only process selection sets for interface types
    if (!isInterfaceType(currentType)) {
      return;
    }

    const fields = ctx.node.selections.filter((s) => s.kind === Kind.FIELD);
    const inlineFragments = ctx.node.selections.filter((s) => s.kind === Kind.INLINE_FRAGMENT);

    // Remove the interface-level fields from the selection set, keeping only inline fragments
    ctx.node.selections = [...inlineFragments];

    // Distribute interface-level fields into each inline fragment
    for (const fragment of inlineFragments) {
      const normalizedFields = fragment.selectionSet.selections.filter((s) => s.kind === Kind.FIELD) ?? [];

      for (const field of fields) {
        // Skip if the fragment already has this field to avoid duplicates
        if (this.hasField(normalizedFields, field.name.value)) {
          continue;
        }

        normalizedFields.unshift(field);
      }

      fragment.selectionSet.selections = [...normalizedFields];
    }
  }

  /**
   * Checks if a field with the given name exists in the provided field array.
   *
   * @param fields - Array of FieldNode objects to search
   * @param fieldName - The name of the field to look for
   * @returns true if a field with the given name exists, false otherwise
   */
  private hasField(fields: FieldNode[], fieldName: string): boolean {
    return fields.some((f) => f.name.value === fieldName);
  }

  /**
   * Type guard to check if an AST node is a FieldNode.
   *
   * @param node - The AST node or array of nodes to check
   * @returns true if the node is a FieldNode, false otherwise
   */
  private isFieldNode(node: ASTNode | ReadonlyArray<ASTNode>): node is FieldNode {
    if (Array.isArray(node)) return false;
    return (node as ASTNode).kind === Kind.FIELD;
  }

  /**
   * Retrieves the field definition for a given field name from the current type.
   *
   * @param fieldName - The name of the field to look up
   * @returns The GraphQL field definition, or undefined if not found
   */
  private fieldDefinition(fieldName: string): GraphQLField<any, any, any> | undefined {
    return this.currentType.getFields()[fieldName];
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
    if (!field) return undefined;

    return getNamedType(field.type);
  }
}
