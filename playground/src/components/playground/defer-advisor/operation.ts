import {
  DocumentNode,
  FieldNode,
  FragmentDefinitionNode,
  InlineFragmentNode,
  Kind,
  OperationDefinitionNode,
  parse,
  SelectionNode,
} from 'graphql';

export const DEFER = 'defer';
export const LABEL_ARG = 'label';

export const findDeferDirective = (node: InlineFragmentNode) => node.directives?.find((d) => d.name.value === DEFER);

export const isDeferFragment = (node: InlineFragmentNode) => findDeferDirective(node) !== undefined;

export type ParsedQuery = { text: string; doc: DocumentNode };

let lastParse: ParsedQuery | undefined;

// Half-typed queries fail to parse; that is expected.
export const parseQuery = (query: string): ParsedQuery | undefined => {
  if (lastParse?.text === query) {
    return lastParse;
  }
  try {
    lastParse = { text: query, doc: parse(query) };
    return lastParse;
  } catch {
    return undefined;
  }
};

export const getOperation = (doc: DocumentNode | undefined): OperationDefinitionNode | undefined => {
  const definition = doc?.definitions.find((d) => d.kind === Kind.OPERATION_DEFINITION);
  return definition?.kind === Kind.OPERATION_DEFINITION ? definition : undefined;
};

export type FragmentMap = ReadonlyMap<string, FragmentDefinitionNode>;

export const getFragments = (doc: DocumentNode | undefined): FragmentMap =>
  new Map(
    (doc?.definitions ?? []).flatMap((d) => (d.kind === Kind.FRAGMENT_DEFINITION ? [[d.name.value, d] as const] : [])),
  );

export const parseOperation = (query: string) => {
  const doc = parseQuery(query)?.doc;
  return { operation: getOperation(doc), fragments: getFragments(doc) };
};

type RootField = {
  field: FieldNode;
  // True when an enclosing fragment is a @defer.
  deferred: boolean;
  // False when the field comes through a named fragment spread. Defer edits the
  // operation body only, so these cannot be deferred from the panel.
  inBody: boolean;
};

// `path` holds the fragments being expanded, so a cycle stops instead of recursing.
const walkRootFields = (
  selections: readonly SelectionNode[],
  fragments: FragmentMap,
  deferred: boolean,
  inBody: boolean,
  path: ReadonlySet<string>,
): RootField[] =>
  selections.flatMap((selection) => {
    if (selection.kind === Kind.FIELD) {
      return [{ field: selection, deferred, inBody }];
    }
    if (selection.kind === Kind.INLINE_FRAGMENT) {
      return walkRootFields(
        selection.selectionSet.selections,
        fragments,
        deferred || isDeferFragment(selection),
        inBody,
        path,
      );
    }
    const fragment = fragments.get(selection.name.value);
    if (selection.kind !== Kind.FRAGMENT_SPREAD || !fragment || path.has(fragment.name.value)) {
      return [];
    }
    return walkRootFields(
      fragment.selectionSet.selections,
      fragments,
      deferred,
      false,
      new Set([...path, fragment.name.value]),
    );
  });

const rootFields = (selections: readonly SelectionNode[], fragments: FragmentMap): RootField[] =>
  walkRootFields(selections, fragments, false, true, new Set());

export const collectRootFields = (
  selections: readonly SelectionNode[],
  fragments: FragmentMap = new Map(),
): FieldNode[] => rootFields(selections, fragments).map((root) => root.field);

export const collectRootOccurrences = (selections: readonly SelectionNode[], fragments: FragmentMap = new Map()) =>
  rootFields(selections, fragments).map(({ field, deferred, inBody }) => ({
    name: field.alias?.value ?? field.name.value,
    deferred,
    inBody,
  }));
