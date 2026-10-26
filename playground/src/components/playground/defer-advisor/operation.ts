import { DocumentNode, InlineFragmentNode, Kind, OperationDefinitionNode, parse, SelectionNode } from 'graphql';

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

type RootOccurrence = { name: string; deferred: boolean };

// `deferred` is true when an enclosing fragment is a @defer.
export const collectRootOccurrences = (selections: readonly SelectionNode[], deferred = false): RootOccurrence[] =>
  selections.flatMap((selection) => {
    if (selection.kind === Kind.FIELD) {
      return [{ name: selection.alias?.value ?? selection.name.value, deferred }];
    }
    if (selection.kind === Kind.INLINE_FRAGMENT) {
      return collectRootOccurrences(selection.selectionSet.selections, deferred || isDeferFragment(selection));
    }
    return [];
  });
