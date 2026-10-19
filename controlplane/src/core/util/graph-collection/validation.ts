import { parse } from 'graphql';
import { z } from 'zod';

// C0 controls, DEL and C1: names with newlines or NULs break list rendering.
// eslint-disable-next-line no-control-regex
const collectionNameControlCharacters = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * The longest a collection or operation name may be. Matches `isValidGraphName`.
 * Every name is returned for every row in the list response, so an unbounded
 * label inflates the payload the playground fetches on page open.
 */
export const MAX_COLLECTION_NAME_LENGTH = 100;

export const MAX_OPERATION_LENGTH = 100_000;

type Subject = 'Collection' | 'Operation';

/** `subject` is in the messages, so the schema is built per caller. */
const collectionNameSchema = (subject: Subject) =>
  z
    .string()
    .trim()
    .min(1, { message: `${subject} name cannot be empty` })
    .max(MAX_COLLECTION_NAME_LENGTH, {
      message: `${subject} name cannot be longer than ${MAX_COLLECTION_NAME_LENGTH} characters`,
    })
    .refine((name) => !collectionNameControlCharacters.test(name), {
      message: `${subject} name cannot contain line breaks or control characters`,
    });

const operationQuerySchema = z
  .string()
  .refine((query) => query.trim().length > 0, { message: 'Operation cannot be empty' })
  .refine((query) => query.length <= MAX_OPERATION_LENGTH, {
    message: `Operation cannot be longer than ${MAX_OPERATION_LENGTH} characters`,
  })
  .superRefine((query, ctx) => {
    // Already reported as empty or oversized; parsing it adds a second message.
    if (!query.trim() || query.length > MAX_OPERATION_LENGTH) {
      return;
    }

    try {
      parse(query);
    } catch (e: any) {
      // `GraphQLError.message` already reads `Syntax Error: Expected Name, found "}".`
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Operation is not valid GraphQL. ${e?.message ?? ''}`.trim(),
      });
    }
  });

const operationVariablesSchema = z
  .string()
  .refine((variables) => variables.length <= MAX_OPERATION_LENGTH, {
    message: `Operation variables cannot be longer than ${MAX_OPERATION_LENGTH} characters`,
  })
  .refine(
    (variables) => {
      if (variables.length > MAX_OPERATION_LENGTH) {
        return true;
      }

      try {
        JSON.parse(variables);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Operation variables must be valid JSON' },
  );

type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

const toResult = <T>(parsed: z.SafeParseReturnType<unknown, T>): Validated<T> =>
  parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.issues[0].message };

/**
 * Validates a user-supplied collection or saved operation name.
 *
 * Returns the trimmed name, so callers store exactly what was validated rather
 * than trimming separately and letting the two drift.
 */
export const validateCollectionName = (
  raw: string,
  subject: Subject,
): { ok: true; name: string } | { ok: false; error: string } => {
  const result = toResult(collectionNameSchema(subject).safeParse(raw));
  return result.ok ? { ok: true, name: result.value } : result;
};

/**
 * Validates the document half of a saved operation. Shared by create and update
 * so the two cannot drift.
 *
 * Syntax only, via `parse`, and NOT against the schema: a document naming a
 * field the graph has since dropped still parses, so a saved operation does not
 * rot when the schema moves on. The accepted cost is that a half-typed document
 * (`query {`) no longer saves.
 */
export const validateOperationDocument = (
  query: string,
  variables: string | undefined,
): { ok: true } | { ok: false; error: string } => {
  const queryResult = toResult(operationQuerySchema.safeParse(query));

  if (!queryResult.ok) {
    return queryResult;
  }

  if (variables === undefined) {
    return { ok: true };
  }

  const variablesResult = toResult(operationVariablesSchema.safeParse(variables));

  return variablesResult.ok ? { ok: true } : variablesResult;
};
