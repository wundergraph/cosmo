import { PLAYGROUND_DEFAULT_HEADERS_TEMPLATE } from '@/lib/constants';

/**
 * Keep this regex character-for-character identical to the one in
 * `controlplane/src/core/util.ts`.
 * The server intentionally duplicates it so it can reject header names the
 * studio would reject, without depending on this package.
 */
export const isValidHeaderName = (name: string) => /^[\^`\-\w!#$%&'*+.|~]+$/.test(name);

export const validateHeaders = (headers: Record<string, string>) => {
  for (const headersKey in headers) {
    if (!isValidHeaderName(headersKey)) {
      throw new TypeError(`Header name must be a valid HTTP token [${headersKey}]`);
    }
  }
};

export const substituteHeadersFromEnv = (headers: Record<string, string>, graphId: string) => {
  const env = JSON.parse(localStorage.getItem('playground:env') || '{}');
  const graphEnv: Record<string, any> | undefined = env[graphId];

  if (!graphEnv) {
    return headers;
  }

  const storedHeaders: Record<string, any> = {};

  Object.entries(graphEnv).forEach(([key, value]) => {
    if (value === 'true' || value === 'false') {
      storedHeaders[key] = value === 'true';
    } else if (!isNaN(value as any) && value !== '') {
      storedHeaders[key] = Number(value);
    } else {
      storedHeaders[key] = value;
    }
  });

  for (const key in headers) {
    let value = headers[key];
    const placeholderRegex = /{\s*{\s*(\w+)\s*}\s*}/g;

    if (typeof value !== 'string') {
      continue;
    }

    value = value.replace(placeholderRegex, (match, p1) => {
      if (storedHeaders[p1] !== undefined) {
        return storedHeaders[p1];
      } else {
        console.warn(`No value found for placeholder: ${p1}`);
        return match;
      }
    });

    headers[key] = value;
  }

  return headers;
};

export interface DefaultHeaderEntry {
  key: string;
  value: string;
}

/**
 * Combines the organization-shared graph defaults with the caller's personal
 * defaults. Graph order is preserved; a personal entry whose key matches an
 * existing key case-insensitively replaces that value in place and contributes
 * its own spelling of the key. Personal-only keys are appended.
 */
export const mergeDefaultHeaders = (
  graph: DefaultHeaderEntry[],
  personal: DefaultHeaderEntry[],
): DefaultHeaderEntry[] => {
  const merged = graph.filter((entry) => entry.key.trim().length > 0);
  const overrides = personal.filter((entry) => entry.key.trim().length > 0);
  const indexByLoweredKey = new Map(merged.map((entry, index) => [entry.key.toLowerCase(), index]));

  for (const entry of overrides) {
    const existingIndex = indexByLoweredKey.get(entry.key.toLowerCase());

    if (existingIndex === undefined) {
      indexByLoweredKey.set(entry.key.toLowerCase(), merged.length);
      merged.push(entry);
    } else {
      merged[existingIndex] = entry;
    }
  }

  return merged;
};

/**
 * Serializes header entries into the JSON string shape GraphiQL's header editor
 * expects.
 */
export const defaultHeadersToJsonString = (entries: DefaultHeaderEntry[]): string => {
  const asObject = Object.fromEntries(
    entries.filter((entry) => entry.key.trim().length > 0).map((entry) => [entry.key, entry.value]),
  );

  return JSON.stringify(asObject, null, 2);
};

/**
 * The single source of truth for what new playground tabs are seeded with.
 *
 * When neither level configures anything, the merge is empty and we fall back
 * to the built-in template so the pre-existing behavior is preserved. Both the
 * playground and the "Effective on new tabs" preview in the default headers
 * dialog must call this so they can never disagree.
 */
export const effectiveDefaultHeadersString = (graph: DefaultHeaderEntry[], personal: DefaultHeaderEntry[]): string => {
  const merged = mergeDefaultHeaders(graph, personal);

  return merged.length === 0 ? PLAYGROUND_DEFAULT_HEADERS_TEMPLATE : defaultHeadersToJsonString(merged);
};

export type ParsedDefaultHeaders = { success: true; entries: DefaultHeaderEntry[] } | { success: false; error: string };

/**
 * Parses the JSON object shape the default headers editor holds - the same shape
 * GraphiQL's own headers tab uses - into entries.
 *
 * Everything the controlplane would reject is rejected here too, so the user sees
 * the problem next to the text that caused it rather than as a failed save.
 */
export const parseDefaultHeadersJson = (text: string): ParsedDefaultHeaders => {
  if (text.trim() === '') {
    return { success: true, entries: [] };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return { success: false, error: 'Not valid JSON' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { success: false, error: 'Headers must be a JSON object' };
  }

  const entries: DefaultHeaderEntry[] = [];
  // JSON.parse collapses exactly-duplicated keys, but not ones that differ only in
  // case, and HTTP header names are case-insensitive.
  const seenLoweredKeys = new Set<string>();

  for (const [key, value] of Object.entries(parsed)) {
    if (!isValidHeaderName(key)) {
      return { success: false, error: `"${key}" is not a valid HTTP header name` };
    }

    if (typeof value !== 'string') {
      return { success: false, error: `The value of "${key}" must be a string` };
    }

    const loweredKey = key.toLowerCase();

    if (seenLoweredKeys.has(loweredKey)) {
      return { success: false, error: `"${key}" is listed more than once` };
    }

    seenLoweredKeys.add(loweredKey);
    entries.push({ key, value });
  }

  return { success: true, entries };
};
