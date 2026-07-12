import {
  DocumentNode,
  FieldNode,
  FragmentDefinitionNode,
  InlineFragmentNode,
  Kind,
  OperationDefinitionNode,
  SelectionSetNode,
  parse,
  print,
} from 'graphql';

export type DeferGroupInput = {
  // Dot-separated response-name path to the parent selection set ('' = operation root).
  path: string;
  fields: string[];
  label: string;
};

type FragmentMap = Map<string, FragmentDefinitionNode>;

// selectOperation picks the operation the advisor profiled: the one matching
// operationName (a multi-operation document must not rewrite the wrong one),
// falling back to the sole/first operation.
export const selectOperation = (doc: DocumentNode, operationName?: string): OperationDefinitionNode | undefined => {
  const operations = doc.definitions.filter(
    (def): def is OperationDefinitionNode => def.kind === Kind.OPERATION_DEFINITION,
  );
  if (operationName) {
    const match = operations.find((op) => op.name?.value === operationName);
    if (match) {
      return match;
    }
  }
  return operations[0];
};

const buildFragmentMap = (doc: DocumentNode): FragmentMap => {
  const fragments: FragmentMap = new Map();
  for (const def of doc.definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(def.name.value, def);
    }
  }
  return fragments;
};

const responseName = (field: FieldNode) => field.alias?.value ?? field.name.value;

const findFieldInSelectionSet = (
  set: SelectionSetNode,
  name: string,
  fragments: FragmentMap,
  visited = new Set<string>(),
): FieldNode | undefined => {
  for (const selection of set.selections) {
    if (selection.kind === Kind.FIELD && responseName(selection) === name) {
      return selection;
    }
    if (selection.kind === Kind.INLINE_FRAGMENT) {
      const found = findFieldInSelectionSet(selection.selectionSet, name, fragments, visited);
      if (found) {
        return found;
      }
    }
    if (selection.kind === Kind.FRAGMENT_SPREAD && !visited.has(selection.name.value)) {
      visited.add(selection.name.value);
      const fragment = fragments.get(selection.name.value);
      if (fragment) {
        const found = findFieldInSelectionSet(fragment.selectionSet, name, fragments, visited);
        if (found) {
          return found;
        }
      }
    }
  }
  return undefined;
};

const findSelectionSetByPath = (set: SelectionSetNode, path: string[], fragments: FragmentMap): SelectionSetNode => {
  if (path.length === 0) {
    return set;
  }
  const field = findFieldInSelectionSet(set, path[0], fragments);
  if (!field?.selectionSet) {
    throw new Error(`field "${path[0]}" not found in the current operation`);
  }
  return findSelectionSetByPath(field.selectionSet, path.slice(1), fragments);
};

// collectContainingSets returns every selection set that holds the field as a
// DIRECT selection, searching through inline fragments and fragment spreads.
// There can be more than one: an interface/union field selected under several
// type conditions (`... on A { x } ... on B { x }`) lives in each fragment's
// set, and deferring it must wrap all of them or the slow occurrences still
// block. Deferring inside a fragment definition wraps it there, so the fragment
// keeps working everywhere it is spread.
const collectContainingSets = (
  set: SelectionSetNode,
  name: string,
  fragments: FragmentMap,
  visited = new Set<string>(),
  out: SelectionSetNode[] = [],
): SelectionSetNode[] => {
  for (const selection of set.selections) {
    if (selection.kind === Kind.FIELD && responseName(selection) === name) {
      if (!out.includes(set)) {
        out.push(set);
      }
    }
    if (selection.kind === Kind.INLINE_FRAGMENT) {
      collectContainingSets(selection.selectionSet, name, fragments, visited, out);
    }
    if (selection.kind === Kind.FRAGMENT_SPREAD && !visited.has(selection.name.value)) {
      visited.add(selection.name.value);
      const fragment = fragments.get(selection.name.value);
      if (fragment) {
        collectContainingSets(fragment.selectionSet, name, fragments, visited, out);
      }
    }
  }
  return out;
};

const wrapFieldsInSet = (set: SelectionSetNode, fields: string[], label: string) => {
  const wanted = new Set(fields);
  const moved: FieldNode[] = [];
  const remaining: SelectionSetNode['selections'][number][] = [];
  // The fragment replaces the first moved field, so deferring keeps the
  // field's position in the operation instead of pushing it to the end.
  let insertAt = -1;
  for (const selection of set.selections) {
    if (selection.kind === Kind.FIELD && wanted.has(responseName(selection))) {
      if (insertAt === -1) {
        insertAt = remaining.length;
      }
      wanted.delete(responseName(selection));
      moved.push(selection);
      continue;
    }
    remaining.push(selection);
  }
  if (wanted.size > 0) {
    throw new Error(`fields ${Array.from(wanted).join(', ')} not found in the current operation`);
  }

  const fragment: InlineFragmentNode = {
    kind: Kind.INLINE_FRAGMENT,
    directives: [
      {
        kind: Kind.DIRECTIVE,
        name: { kind: Kind.NAME, value: 'defer' },
        arguments: [
          {
            kind: Kind.ARGUMENT,
            name: { kind: Kind.NAME, value: 'label' },
            value: { kind: Kind.STRING, value: label },
          },
        ],
      },
    ],
    selectionSet: { kind: Kind.SELECTION_SET, selections: moved },
  };

  // SelectionSetNode.selections is readonly in the type system only; the parsed
  // document is cloned before mutation.
  if (insertAt === -1) {
    insertAt = remaining.length;
  }
  (set as { selections: readonly unknown[] }).selections = [
    ...remaining.slice(0, insertAt),
    fragment,
    ...remaining.slice(insertAt),
  ];
};

// moveFieldsIntoDeferredFragment wraps each field inside the selection set
// that directly contains it — which may be a fragment definition reached
// through a spread; when the group spans multiple sets, labels are suffixed to
// stay unique.
const moveFieldsIntoDeferredFragment = (
  parentSet: SelectionSetNode,
  fields: string[],
  label: string,
  fragments: FragmentMap,
) => {
  const sets: SelectionSetNode[] = [];
  const fieldsBySet = new Map<SelectionSetNode, string[]>();
  for (const field of fields) {
    const containing = collectContainingSets(parentSet, field, fragments);
    if (containing.length === 0) {
      throw new Error(`field "${field}" not found in the current operation`);
    }
    for (const set of containing) {
      if (!fieldsBySet.has(set)) {
        sets.push(set);
        fieldsBySet.set(set, []);
      }
      fieldsBySet.get(set)!.push(field);
    }
  }
  sets.forEach((set, i) => {
    wrapFieldsInSet(set, fieldsBySet.get(set)!, i === 0 ? label : `${label}_${i + 1}`);
  });
};

// removeDeferredField moves a field out of the @defer fragment wrapping it,
// back into the enclosing selection set; a fragment left empty is dropped.
export const removeDeferredField = (
  query: string,
  parentPath: string,
  field: string,
  operationName?: string,
): string => {
  const doc = JSON.parse(JSON.stringify(parse(query, { noLocation: true }))) as DocumentNode;
  const fragments = buildFragmentMap(doc);

  const operation = selectOperation(doc, operationName);
  if (!operation) {
    throw new Error('no operation found in the editor');
  }

  const parentSet = findSelectionSetByPath(
    operation.selectionSet,
    parentPath === '' ? [] : parentPath.split('.'),
    fragments,
  );

  const visited = new Set<string>();
  const unwrapFrom = (set: SelectionSetNode): boolean => {
    for (const selection of set.selections) {
      if (selection.kind === Kind.FRAGMENT_SPREAD && !visited.has(selection.name.value)) {
        visited.add(selection.name.value);
        const fragment = fragments.get(selection.name.value);
        if (fragment && unwrapFrom(fragment.selectionSet)) {
          return true;
        }
        continue;
      }
      if (selection.kind !== Kind.INLINE_FRAGMENT) {
        continue;
      }
      const isDefer = selection.directives?.some((d) => d.name.value === 'defer');
      const fragmentSet = selection.selectionSet;
      const target = fragmentSet.selections.find(
        (sel): sel is FieldNode => sel.kind === Kind.FIELD && responseName(sel) === field,
      );
      if (isDefer && target) {
        const remaining = fragmentSet.selections.filter((sel) => sel !== target);
        const nonDeferDirectives = selection.directives?.filter((directive) => directive.name.value !== 'defer');
        const undeferredSelection: InlineFragmentNode | FieldNode =
          selection.typeCondition || nonDeferDirectives?.length
            ? {
                kind: Kind.INLINE_FRAGMENT,
                typeCondition: selection.typeCondition,
                directives: nonDeferDirectives,
                selectionSet: { kind: Kind.SELECTION_SET, selections: [target] },
              }
            : target;
        const newSelections = set.selections.flatMap((sel) => {
          if (sel !== selection) {
            return [sel];
          }
          if (remaining.length === 0) {
            return [undeferredSelection];
          }
          (fragmentSet as { selections: readonly unknown[] }).selections = remaining;
          return [sel, undeferredSelection];
        });
        (set as { selections: readonly unknown[] }).selections = newSelections;
        return true;
      }
      if (unwrapFrom(fragmentSet)) {
        return true;
      }
    }
    return false;
  };

  if (!unwrapFrom(parentSet)) {
    throw new Error(`no deferred fragment containing "${field}" found`);
  }
  return print(doc);
};

// applyDeferSuggestions moves each group's fields into an inline fragment
// annotated with @defer(label). Mirrors the router-side rewriter so accepted
// suggestions produce the same query the advisor validated.
export const applyDeferSuggestions = (query: string, groups: DeferGroupInput[], operationName?: string): string => {
  // Deep-clone via JSON: AST nodes are plain objects and loc references are dropped.
  const doc = JSON.parse(JSON.stringify(parse(query, { noLocation: true }))) as DocumentNode;
  const fragments = buildFragmentMap(doc);

  const operation = selectOperation(doc, operationName);
  if (!operation) {
    throw new Error('no operation found in the editor');
  }

  for (const group of groups) {
    const path = group.path === '' ? [] : group.path.split('.');
    const set = findSelectionSetByPath(operation.selectionSet, path, fragments);
    moveFieldsIntoDeferredFragment(set, group.fields, group.label, fragments);
  }

  return print(doc);
};
