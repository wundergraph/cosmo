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
  const withNonEmptyKeys = (entries: DefaultHeaderEntry[]) => entries.filter((entry) => entry.key.trim() !== '');

  const merged = withNonEmptyKeys(graph).map((entry) => ({ ...entry }));
  const indexByLoweredKey = new Map(merged.map((entry, index) => [entry.key.toLowerCase(), index]));

  for (const entry of withNonEmptyKeys(personal)) {
    const existingIndex = indexByLoweredKey.get(entry.key.toLowerCase());

    if (existingIndex === undefined) {
      indexByLoweredKey.set(entry.key.toLowerCase(), merged.length);
      merged.push({ ...entry });
    } else {
      merged[existingIndex] = { ...entry };
    }
  }

  return merged;
};

/**
 * Serializes header entries into the JSON string shape GraphiQL's header editor
 * expects.
 */
export const defaultHeadersToJsonString = (entries: DefaultHeaderEntry[]): string => {
  const asObject: Record<string, string> = {};

  for (const entry of entries) {
    if (entry.key.trim() !== '') {
      asObject[entry.key] = entry.value;
    }
  }

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
