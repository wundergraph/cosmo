import { parse } from 'graphql';

// eslint-disable-next-line no-control-regex
const collectionNameControlCharacters = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * The longest a collection or operation name may be. Matches `isValidGraphName`.
 * Every name is returned for every row in the list response, so an unbounded
 * label inflates the payload the playground fetches on page open.
 */
export const MAX_COLLECTION_NAME_LENGTH = 100;

/**
 * Validates a user-supplied collection or saved operation name.
 *
 * Unlike `isValidGraphName` it reports *why* a name was rejected, which is what
 * `subject` names. Returns the trimmed name, so callers store exactly what was
 * validated rather than trimming separately and letting the two drift.
 */
export const validateCollectionName = (
  raw: string,
  subject: 'Collection' | 'Operation',
): { ok: true; name: string } | { ok: false; error: string } => {
  const name = raw.trim();

  if (!name) {
    return { ok: false, error: `${subject} name cannot be empty` };
  }

  if (name.length > MAX_COLLECTION_NAME_LENGTH) {
    return {
      ok: false,
      error: `${subject} name cannot be longer than ${MAX_COLLECTION_NAME_LENGTH} characters`,
    };
  }

  if (collectionNameControlCharacters.test(name)) {
    return { ok: false, error: `${subject} name cannot contain line breaks or control characters` };
  }

  return { ok: true, name };
};

export const MAX_OPERATION_LENGTH = 100_000;

export const validateOperationDocument = (
  query: string,
  variables: string | undefined,
): { ok: true } | { ok: false; error: string } => {
  if (!query.trim()) {
    return { ok: false, error: 'Operation cannot be empty' };
  }

  if (query.length > MAX_OPERATION_LENGTH) {
    return { ok: false, error: `Operation cannot be longer than ${MAX_OPERATION_LENGTH} characters` };
  }

  if (variables && variables.length > MAX_OPERATION_LENGTH) {
    return { ok: false, error: `Operation variables cannot be longer than ${MAX_OPERATION_LENGTH} characters` };
  }

  try {
    parse(query);
  } catch (e: any) {
    // `GraphQLError.message` for a syntax error already reads
    // `Syntax Error: Expected Name, found "}".`, which is what the user needs.
    return { ok: false, error: `Operation is not valid GraphQL. ${e?.message ?? ''}`.trim() };
  }

  if (variables) {
    try {
      JSON.parse(variables);
    } catch {
      return { ok: false, error: 'Operation variables must be valid JSON' };
    }
  }

  return { ok: true };
};
