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

type RootOccurrence = {
  name: string;
  // True when an enclosing fragment is a @defer.
  deferred: boolean;
  // False when the field comes through a named fragment spread. Defer edits the
  // operation body only, so these cannot be deferred from the panel.
  inBody: boolean;
};

// `path` holds the fragments being expanded, so a cycle stops instead of recursing.
const walkOccurrences = (
  selections: readonly SelectionNode[],
  fragments: FragmentMap,
  deferred: boolean,
  inBody: boolean,
  path: ReadonlySet<string>,
): RootOccurrence[] =>
  selections.flatMap((selection) => {
    if (selection.kind === Kind.FIELD) {
      return [{ name: selection.alias?.value ?? selection.name.value, deferred, inBody }];
    }
    if (selection.kind === Kind.INLINE_FRAGMENT) {
      return walkOccurrences(
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
    return walkOccurrences(
      fragment.selectionSet.selections,
      fragments,
      deferred,
      false,
      new Set([...path, fragment.name.value]),
    );
  });

export const collectRootOccurrences = (
  selections: readonly SelectionNode[],
  fragments: FragmentMap = new Map(),
): RootOccurrence[] => walkOccurrences(selections, fragments, false, true, new Set());

const walkFields = (
  selections: readonly SelectionNode[],
  fragments: FragmentMap,
  path: ReadonlySet<string>,
): FieldNode[] =>
  selections.flatMap((selection) => {
    if (selection.kind === Kind.FIELD) {
      return [selection];
    }
    if (selection.kind === Kind.INLINE_FRAGMENT) {
      return walkFields(selection.selectionSet.selections, fragments, path);
    }
    const fragment = fragments.get(selection.name.value);
    if (selection.kind !== Kind.FRAGMENT_SPREAD || !fragment || path.has(fragment.name.value)) {
      return [];
    }
    return walkFields(fragment.selectionSet.selections, fragments, new Set([...path, fragment.name.value]));
  });

export const collectRootFields = (
  selections: readonly SelectionNode[],
  fragments: FragmentMap = new Map(),
): FieldNode[] => walkFields(selections, fragments, new Set());
