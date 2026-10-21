import { FieldNode, InlineFragmentNode, Kind, SelectionNode, visit } from 'graphql';
import {
  collectRootOccurrences,
  DEFER,
  findDeferDirective,
  getOperation,
  isDeferFragment,
  LABEL_ARG,
  parseQuery,
} from './operation';

type DeferredField = { label: string; field: string };

const getDeferLabel = (node: InlineFragmentNode): string | undefined => {
  const arg = findDeferDirective(node)?.arguments?.find((a) => a.name.value === LABEL_ARG);
  return arg?.value.kind === Kind.STRING ? arg.value.value : undefined;
};

export const makeUniqueLabel = (base: string, existing: Set<string>) => {
  if (!existing.has(base)) {
    return base;
  }
  let i = 2;
  while (existing.has(`${base}_${i}`)) {
    i++;
  }
  return `${base}_${i}`;
};

const collectLabels = (query: string): Set<string> => {
  const labels = new Set<string>();
  visit(parseQuery(query), {
    InlineFragment(node) {
      const label = getDeferLabel(node);
      if (label) {
        labels.add(label);
      }
    },
  });
  return labels;
};

/** Eager would drop the `if:` condition, so these are left alone. */
const isConditionalDefer = (node: InlineFragmentNode) =>
  node.directives?.some((d) => d.name.value === DEFER && d.arguments?.some((a) => a.name.value === 'if')) ?? false;

const rootSelections = (query: string): readonly SelectionNode[] =>
  getOperation(parseQuery(query))?.selectionSet.selections ?? [];

/** Stops at fields: a defer under a field is out of reach. */
const reachableDeferFragments = (query: string): InlineFragmentNode[] => {
  const result: InlineFragmentNode[] = [];
  const walk = (selections: readonly SelectionNode[]) => {
    for (const selection of selections) {
      if (selection.kind !== Kind.INLINE_FRAGMENT) {
        continue;
      }
      if (isDeferFragment(selection) && !isConditionalDefer(selection)) {
        result.push(selection);
      }
      walk(selection.selectionSet.selections);
    }
  };
  walk(rootSelections(query));
  return result;
};

const findUndeferredRootField = (query: string, fieldName: string): FieldNode | undefined => {
  const walk = (selections: readonly SelectionNode[]): FieldNode | undefined => {
    for (const selection of selections) {
      if (selection.kind === Kind.FIELD && (selection.alias?.value ?? selection.name.value) === fieldName) {
        return selection;
      }
      if (selection.kind === Kind.INLINE_FRAGMENT && !isDeferFragment(selection)) {
        const found = walk(selection.selectionSet.selections);
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  };
  return walk(rootSelections(query));
};

/** Splices the text, so comments and formatting survive a click. */
export const applyDefer = (query: string, fieldName: string, label: string): string => {
  const field = findUndeferredRootField(query, fieldName);
  if (!field?.loc) {
    return query;
  }
  const { start, end } = field.loc;
  return `${query.slice(0, start)}... @defer(label: "${label}") { ${query.slice(start, end)} }${query.slice(end)}`;
};

const removeText = (query: string, start: number, end: number): string => `${query.slice(0, start)}${query.slice(end)}`;

/** A # comment needs a line break after it, or it swallows what follows. */
const unwrapFragment = (query: string, fragment: InlineFragmentNode): string => {
  const loc = fragment.loc;
  const body = fragment.selectionSet.loc;
  if (!loc || !body) {
    return query;
  }
  const inner = query.slice(body.start + 1, body.end - 1).trim();
  const head = query.slice(0, loc.start);
  const tail = query.slice(loc.end);
  const left = /\w$/.test(head) && /^\w/.test(inner) ? ' ' : '';
  const right = inner.includes('#') ? '\n' : /\w$/.test(inner) && /^\w/.test(tail) ? ' ' : '';
  return `${head}${left}${inner}${right}${tail}`;
};

const revertOne = (query: string, target: InlineFragmentNode): string => {
  const deferDirective = findDeferDirective(target);
  const hasOtherDirectives = target.directives?.some((d) => d !== deferDirective) ?? false;
  if (hasOtherDirectives) {
    const directiveLoc = deferDirective?.loc;
    return directiveLoc ? removeText(query, directiveLoc.start, directiveLoc.end) : query;
  }
  return unwrapFragment(query, target);
};

export const revertDefer = (query: string, label: string): string => {
  const target = reachableDeferFragments(query).find((f) => getDeferLabel(f) === label);
  return target ? revertOne(query, target) : query;
};

/** Eager needs one fragment per label: reverting removes every fragment with that label. */
export const countDeferFragmentsByLabel = (query: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const fragment of reachableDeferFragments(query)) {
    const label = getDeferLabel(fragment);
    if (label) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return counts;
};

/** No Eager for nested defers: reverting one leaves its field deferred. */
export const listNestedDeferLabels = (query: string): Set<string> => {
  const nested = new Set<string>();
  const walk = (selections: readonly SelectionNode[], insideDefer: boolean) => {
    for (const selection of selections) {
      if (selection.kind !== Kind.INLINE_FRAGMENT) {
        continue;
      }
      const isDefer = isDeferFragment(selection);
      const label = getDeferLabel(selection);
      if (isDefer && insideDefer && label) {
        nested.add(label);
      }
      walk(selection.selectionSet.selections, insideDefer || isDefer);
    }
  };
  walk(rootSelections(query), false);
  return nested;
};

export const listDeferLabels = (query: string): string[] => [...collectLabels(query)];

export const listDeferredFields = (query: string): DeferredField[] =>
  reachableDeferFragments(query).flatMap((fragment) => {
    const label = getDeferLabel(fragment);
    if (!label) {
      return [];
    }
    return collectRootOccurrences(fragment.selectionSet.selections)
      .filter((o) => !o.deferred)
      .map((o) => ({ label, field: o.name }));
  });
