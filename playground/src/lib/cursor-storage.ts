import { Kind, OperationTypeNode, parse } from 'graphql';

/**
 * localStorage key holding every cursor the playground knows about.
 *
 * The value is a `Record<string, string>` mapping an entry key (see {@link cursorKey})
 * to the last cursor the router delivered for that subscription.
 */
export const CURSOR_STORAGE_KEY = 'playground:cursors';

/**
 * Builds the storage key for a subscription.
 *
 * A cursor is bound to `providerType | providerID | sorted topics` on the router side, all of
 * which are derived from the subscription root field, so the endpoint plus the root field name
 * would be enough to identify the stream a cursor belongs to. The tab ID is included on top of
 * that so that cursors are tracked per playground tab: two tabs subscribing to the same field
 * (e.g. a duplicated tab) each keep their own stored cursor instead of sharing one.
 */
export function cursorKey(tabId: string, endpointUrl: string, fieldName: string): string {
  return `${tabId}|${endpointUrl}|${fieldName}`;
}

function readAll(): Record<string, string> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(CURSOR_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function writeAll(cursors: Record<string, string>) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(CURSOR_STORAGE_KEY, JSON.stringify(cursors));
    // Notify every useLocalStorage() consumer, e.g. the Cursors tab, so it re-renders
    // while a subscription is still streaming.
    window.dispatchEvent(new Event('local-storage'));
  } catch (error) {
    console.warn(`Error writing localStorage key “${CURSOR_STORAGE_KEY}”:`, error);
  }
}

export function getAllCursors(): Record<string, string> {
  return readAll();
}

export function getCursor(key: string): string | null {
  return readAll()[key] ?? null;
}

export function setCursor(key: string, cursor: string) {
  const cursors = readAll();
  if (cursors[key] === cursor) {
    return;
  }

  cursors[key] = cursor;
  writeAll(cursors);
}

export function clearCursor(key: string) {
  const cursors = readAll();
  if (!(key in cursors)) {
    return;
  }

  delete cursors[key];
  writeAll(cursors);
}

export function clearAllCursors() {
  writeAll({});
}

/**
 * Returns the name of the first root field of the subscription in `query`, or `null` if the
 * document holds no matching subscription. This is the field name, never the alias — the alias
 * is a client-side concern and does not identify the stream.
 *
 * The editor routinely holds invalid syntax while being typed, so parse failures simply yield
 * `null`.
 */
export function subscriptionRootFieldName(query?: string | null, operationName?: string | null): string | null {
  if (!query) {
    return null;
  }

  try {
    const document = parse(query);

    for (const definition of document.definitions) {
      if (definition.kind !== Kind.OPERATION_DEFINITION) {
        continue;
      }

      if (definition.operation !== OperationTypeNode.SUBSCRIPTION) {
        continue;
      }

      if (operationName && definition.name?.value !== operationName) {
        continue;
      }

      const selection = definition.selectionSet.selections[0];
      if (!selection || selection.kind !== Kind.FIELD) {
        return null;
      }

      return selection.name.value;
    }

    return null;
  } catch {
    return null;
  }
}
