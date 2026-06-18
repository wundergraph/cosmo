import {
  type ArgumentNode,
  BREAK,
  type DirectiveNode,
  type DocumentNode,
  type FieldNode,
  type InlineFragmentNode,
  Kind,
  type SelectionSetNode,
} from 'graphql';

// graphql v16's CJS root re-exports enum objects through getters; keep hot walker reads local.
const KindRef = Kind;

/* Hand-rolled replacement for graphql-js visit() over tiny field-set documents (parsed @key/@provides/@requires
 * selection sets). It only supports the node kinds for which the field-set visitors define handlers (Argument, Field,
 * InlineFragment, and SelectionSet) but replicates the graphql-js visit() traversal semantics for those handlers
 * exactly:
 * 1. SelectionSet selections are visited in array order.
 * 2. Field children are visited in QueryDocumentKeys order: alias, name, arguments, directives, selectionSet.
 *    Consequently, a Field's arguments (and any directive arguments) are visited before its child selections.
 * 3. InlineFragment children are visited in the order typeCondition, directives, selectionSet.
 * 4. FragmentSpread nodes (which have no handler) are still descended into, so their directive arguments fire the
 *    Argument handler, as with graphql-js visit().
 * 5. A handler returning BREAK aborts the entire traversal immediately WITHOUT invoking any further enter/leave
 *    handlers.
 * 6. An enter handler returning false skips the node's children AND the node's leave handler.
 * */
export type FieldSetVisitor = {
  argumentEnter?: (node: ArgumentNode) => unknown;
  fieldEnter?: (node: FieldNode) => unknown;
  fieldLeave?: (node: FieldNode) => unknown;
  inlineFragmentEnter?: (node: InlineFragmentNode) => unknown;
  selectionSetEnter?: (node: SelectionSetNode) => unknown;
  selectionSetLeave?: (node: SelectionSetNode) => unknown;
};

// Returns false if the traversal was aborted with BREAK.
function walkDirectives(nodes: ReadonlyArray<DirectiveNode> | undefined, visitor: FieldSetVisitor): boolean {
  if (!nodes || !visitor.argumentEnter) {
    return true;
  }
  for (const directiveNode of nodes) {
    if (!directiveNode.arguments) {
      continue;
    }
    for (const argumentNode of directiveNode.arguments) {
      // An Argument enter handler returning false is a no-op because Argument children define no handlers.
      if (visitor.argumentEnter(argumentNode) === BREAK) {
        return false;
      }
    }
  }
  return true;
}

// Returns false if the traversal was aborted with BREAK.
function walkField(node: FieldNode, visitor: FieldSetVisitor): boolean {
  if (visitor.fieldEnter) {
    const result = visitor.fieldEnter(node);
    if (result === BREAK) {
      return false;
    }
    if (result === false) {
      return true;
    }
  }
  if (node.arguments && visitor.argumentEnter) {
    for (const argumentNode of node.arguments) {
      if (visitor.argumentEnter(argumentNode) === BREAK) {
        return false;
      }
    }
  }
  if (!walkDirectives(node.directives, visitor)) {
    return false;
  }
  if (node.selectionSet && !walkSelectionSet(node.selectionSet, visitor)) {
    return false;
  }
  if (visitor.fieldLeave && visitor.fieldLeave(node) === BREAK) {
    return false;
  }
  return true;
}

// Returns false if the traversal was aborted with BREAK.
function walkInlineFragment(node: InlineFragmentNode, visitor: FieldSetVisitor): boolean {
  if (visitor.inlineFragmentEnter) {
    const result = visitor.inlineFragmentEnter(node);
    if (result === BREAK) {
      return false;
    }
    if (result === false) {
      return true;
    }
  }
  if (!walkDirectives(node.directives, visitor)) {
    return false;
  }
  return walkSelectionSet(node.selectionSet, visitor);
}

// Returns false if the traversal was aborted with BREAK.
function walkSelectionSet(node: SelectionSetNode, visitor: FieldSetVisitor): boolean {
  if (visitor.selectionSetEnter) {
    const result = visitor.selectionSetEnter(node);
    if (result === BREAK) {
      return false;
    }
    if (result === false) {
      return true;
    }
  }
  for (const selection of node.selections) {
    switch (selection.kind) {
      case KindRef.FIELD: {
        if (!walkField(selection, visitor)) {
          return false;
        }
        break;
      }
      case KindRef.INLINE_FRAGMENT: {
        if (!walkInlineFragment(selection, visitor)) {
          return false;
        }
        break;
      }
      // Fragment spreads define no handler, but graphql-js visit() descends into their directives.
      default: {
        if (!walkDirectives(selection.directives, visitor)) {
          return false;
        }
      }
    }
  }
  if (visitor.selectionSetLeave && visitor.selectionSetLeave(node) === BREAK) {
    return false;
  }
  return true;
}

export function walkFieldSetDocument(documentNode: DocumentNode, visitor: FieldSetVisitor): void {
  for (const definition of documentNode.definitions) {
    if ('selectionSet' in definition && definition.selectionSet) {
      if (!walkSelectionSet(definition.selectionSet, visitor)) {
        return;
      }
    }
  }
}
