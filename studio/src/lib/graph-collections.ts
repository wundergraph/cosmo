import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { parseAsString } from 'nuqs';
import { buildUrl } from '@/lib/build-url';
import {
  GraphCollection,
  GraphCollectionOperationMeta,
  GraphCollectionSortBy,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { parse } from 'graphql';
import { toast } from '@/components/ui/use-toast';

export const MAX_COLLECTION_NAME_LENGTH = 100;

/**
 * Mirrors `MAX_OPERATION_LENGTH` in `controlplane/src/core/util.ts`, and is
 * duplicated for the same reason as the name limit above.
 */
export const MAX_OPERATION_LENGTH = 100_000;

/**
 * Why an operation cannot be saved, or undefined if it can.
 *
 * Mirrors `validateOperationDocument` in `controlplane/src/core/util.ts` message
 * for message. The server stays authoritative; drift costs a wasted request.
 *
 * Syntax only, like the server: a document naming a dropped field still saves,
 * so saved operations do not rot as the schema changes.
 */
export const operationSaveError = (query: string, variables: string | undefined): string | undefined => {
  if (!query.trim()) {
    return 'Operation cannot be empty';
  }

  if (query.length > MAX_OPERATION_LENGTH) {
    return `Operation cannot be longer than ${MAX_OPERATION_LENGTH} characters`;
  }

  if (variables && variables.length > MAX_OPERATION_LENGTH) {
    return `Operation variables cannot be longer than ${MAX_OPERATION_LENGTH} characters`;
  }

  try {
    parse(query);
  } catch (e: any) {
    return `Operation is not valid GraphQL. ${e?.message ?? ''}`.trim();
  }

  if (variables) {
    try {
      JSON.parse(variables);
    } catch {
      return 'Operation variables must be valid JSON';
    }
  }

  return undefined;
};

/**
 * Which dialog the panel is showing, and what it is acting on. A union rather
 * than a boolean per dialog, so a dialog can never be open against nothing.
 */
export type DialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'rename-collection'; collection: GraphCollection }
  | { kind: 'delete-collection'; collection: GraphCollection }
  | { kind: 'share-collection'; collection: GraphCollection }
  // The operation variants carry the owning collection id too: the server
  // scopes every by-id call to it, and the metadata itself does not say which
  // collection an operation came from.
  | { kind: 'rename-operation'; operation: GraphCollectionOperationMeta; collectionId: string }
  | { kind: 'delete-operation'; operation: GraphCollectionOperationMeta; collectionId: string };

/**
 * What a mutation removed, for callers that hold references to it. Reported by
 * the dialog host, which already knows which dialog ran.
 */
export type DeletedEntity = { kind: 'collection' | 'operation'; id: string };

/** How the collections list is ordered. */
export type CollectionSort = 'name' | 'createdAt';

/** The wire value for each sort, so the proto enum stays out of the UI. */
export const collectionSortParam: Record<CollectionSort, GraphCollectionSortBy> = {
  name: GraphCollectionSortBy.GRAPH_COLLECTION_SORT_NAME,
  createdAt: GraphCollectionSortBy.GRAPH_COLLECTION_SORT_CREATED_AT,
};

type OperationLike = { id: string; name: string };
type CollectionLike<TOperation extends OperationLike> = {
  id: string;
  name: string;
  operations: TOperation[];
};

const matches = (value: string, term: string) => value.toLowerCase().includes(term);

/**
 * Narrows collections and their operations to a search term, preserving the
 * order they arrived in - `GetGraphCollections` already sorts both lists.
 *
 * A collection whose own name matches keeps **all** of its operations, so
 * searching for a collection shows you what is inside it. Otherwise it keeps
 * only the operations that match, and disappears if none do.
 */
export const filterCollections = <TOperation extends OperationLike, TCollection extends CollectionLike<TOperation>>(
  collections: TCollection[],
  term: string,
): TCollection[] => {
  const needle = term.trim().toLowerCase();

  if (!needle) {
    return collections;
  }

  return collections
    .map((collection) =>
      matches(collection.name, needle)
        ? collection
        : { ...collection, operations: collection.operations.filter((operation) => matches(operation.name, needle)) },
    )
    .filter((collection) => matches(collection.name, needle) || collection.operations.length > 0);
};

/**
 * The GraphQL operation name of the first named operation in a document.
 *
 * Only pre-fills the save dialog's label; the server stores whatever label the
 * user accepts. An unparseable document yields undefined rather than throwing.
 */
const parseFirstOperationName = (document: string): string | undefined => {
  if (!document.trim()) {
    return undefined;
  }

  try {
    for (const definition of parse(document).definitions) {
      if (definition.kind === 'OperationDefinition' && definition.name) {
        return definition.name.value;
      }
    }
  } catch {
    // Unparseable document: nothing to suggest.
  }

  return undefined;
};

/**
 * The name to pre-fill the save dialog with. Prefers GraphiQL's own
 * `operationName`, which reflects the operation the user selected when a
 * document holds several; the document alone only knows their order.
 */
export const suggestOperationName = (graphiqlOperationName: string | null | undefined, document: string): string => {
  return graphiqlOperationName?.trim() || parseFirstOperationName(document) || '';
};

export type DeepLinkResult = {
  status: 'none' | 'found' | 'unavailable';
  id?: string;
};

/**
 * The query parameter a shared collection link carries.
 *
 * Named for the id it holds, matching OPERATION_QUERY_PARAM below. Both are
 * exported rather than written inline, because the playground page reads them
 * too and a second spelling there would silently stop deep links working.
 */
export const COLLECTION_QUERY_PARAM = 'collectionId';

/**
 * The saved operation a link points at.
 *
 * Deliberately NOT `operation`: the playground already uses that param for the
 * URL-encoded operation *text* (it drives `shouldPassEditorStateProps` and
 * seeds the editors), so putting a UUID there would make the playground try to
 * parse the id as a GraphQL document.
 */
export const OPERATION_QUERY_PARAM = 'operationId';

/**
 * The deep-link parameters, for `useQueryStates`.
 *
 * Keyed off the constants above so the panel, the playground page and the
 * share link all read and write the same two names.
 */
export const collectionDeepLinkParams = {
  [COLLECTION_QUERY_PARAM]: parseAsString,
  [OPERATION_QUERY_PARAM]: parseAsString,
};

/**
 * Resolves `?collectionId=<uuid>` against the collections the caller can actually
 * see.
 *
 * Missing, belonging to another graph, and private to someone else are
 * deliberately one outcome. There is no endpoint that can tell them apart, so
 * knowing a UUID reveals nothing about whether it exists.
 */
export const resolveDeepLinkedCollection = (
  collections: { id: string }[],
  requested: string | null | undefined,
): DeepLinkResult => {
  if (!requested) {
    return { status: 'none' };
  }

  return collections.some((collection) => collection.id === requested)
    ? { status: 'found', id: requested }
    : { status: 'unavailable' };
};

/**
 * A link that addresses one collection and nothing else.
 *
 * Deliberately built from origin + pathname rather than the current URL: the
 * playground address often carries a whole compressed operation in
 * `playgroundUrlState`, plus whichever schema is loaded, and none of that
 * belongs in a link whose job is to point at a collection.
 *
 * Knowing the URL grants nothing on its own: the collection still has to be
 * visible to whoever opens it.
 */
export const buildCollectionShareUrl = (
  origin: string,
  pathname: string,
  collectionId: string,
  operationId?: string,
): string =>
  buildUrl(`${origin}${pathname}`, {
    [COLLECTION_QUERY_PARAM]: collectionId,
    [OPERATION_QUERY_PARAM]: operationId,
  });

export type DeepLinkedOperation =
  | { status: 'none' }
  | { status: 'found'; operationId: string; collectionId: string }
  | { status: 'unavailable' };

/**
 * Resolves `?operationId=<uuid>` against what the caller can see, and
 * reports which collection owns it so the panel can expand the right one.
 *
 * Like collections, "does not exist" and "not yours" are one outcome.
 */
export const resolveDeepLinkedOperation = (
  collections: { id: string; operations: { id: string }[] }[],
  requested: string | null | undefined,
): DeepLinkedOperation => {
  if (!requested) {
    return { status: 'none' };
  }

  const owner = collections.find((collection) => collection.operations.some((operation) => operation.id === requested));

  return owner ? { status: 'found', operationId: requested, collectionId: owner.id } : { status: 'unavailable' };
};

/**
 * The link between a GraphiQL tab and the saved operation it is editing.
 *
 * GraphiQL owns the tab list; this map follows it. Keeping the binding outside
 * GraphiQL is what lets the toolbar tell "Save" from "Save to collection", and
 * is where the content hash for the next save's precondition lives.
 */
export type TabBinding = {
  collectionId: string;
  operationId: string;
  /**
   * The content hash this tab loaded. Sent back as the save precondition so the
   * server can reject a save that would overwrite someone else's work.
   */
  loadedContentHash: string;
};

export type TabBindings = Record<string, TabBinding>;

export const bindTab = (bindings: TabBindings, tabId: string, binding: TabBinding): TabBindings => ({
  ...bindings,
  [tabId]: binding,
});

/**
 * Drops bindings whose tab has been closed, so a closed tab cleans up after
 * itself rather than leaving a stale operation link behind.
 */
export const pruneBindings = (bindings: TabBindings, liveTabIds: string[]): TabBindings => {
  const live = new Set(liveTabIds);
  return Object.fromEntries(Object.entries(bindings).filter(([tabId]) => live.has(tabId)));
};

export const findTabForOperation = (bindings: TabBindings, operationId: string): string | undefined =>
  Object.entries(bindings).find(([, binding]) => binding.operationId === operationId)?.[0];

/**
 * Advances a tab's stored hash to the one the server returned from a save.
 * Without this the next save would send a hash the server has already moved
 * past, and conflict with the caller's own previous write.
 */
export const updateBindingHash = (bindings: TabBindings, tabId: string, contentHash: string): TabBindings => {
  const existing = bindings[tabId];
  if (!existing) {
    return bindings;
  }

  return { ...bindings, [tabId]: { ...existing, loadedContentHash: contentHash } };
};

const isBinding = (value: unknown): value is TabBinding =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as TabBinding).collectionId === 'string' &&
  typeof (value as TabBinding).operationId === 'string' &&
  typeof (value as TabBinding).loadedContentHash === 'string';

/**
 * Reads the persisted blob defensively. Storage can hold anything: an older
 * shape, a truncated write, or nothing at all. None of those should stop
 * the playground from rendering.
 */
export const parseTabBindings = (stored: string | null): TabBindings => {
  if (!stored) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(stored);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(Object.entries(parsed).filter(([, binding]) => isBinding(binding))) as TabBindings;
  } catch {
    return {};
  }
};

/**
 * Reports a failed mutation as a toast. Prefers the server's own `details`,
 * so the fallback only covers transport errors that carry no response.
 *
 * Not a hook: `toast` dispatches to a module-level store, so `useToast` is only
 * needed to *read* toast state. Calling it here would re-render every caller
 * whenever any toast anywhere appears or dismisses.
 */
export const reportFailure = (fallback: string, details?: string) => {
  toast({ description: details || fallback, duration: 3000 });
};

/**
 * The callbacks every collections mutation passes to `mutate`.
 *
 * A transport failure and an application error have to reach the same toast,
 * and `onDone` must run only for an OK response, or a dialog closes over a
 * mutation that did not happen.
 */
export const collectionMutationHandlers = (failure: string, onDone: () => void) => ({
  onSuccess: ({ response }: { response?: { code: EnumStatusCode; details?: string } }) => {
    if (response?.code !== EnumStatusCode.OK) {
      reportFailure(failure, response?.details);
      return;
    }

    onDone();
  },
  onError: () => reportFailure(failure),
});
