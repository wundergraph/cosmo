# CLAUDE.md

> `AGENTS.md` is a symlink to this file, so both agents read the same conventions.

## Naming

- **Name a value after what it is in the domain, not after how it was
  computed.** A rename callback takes `name`, not `trimmed`. A validation
  result for a taken name is `nameConflict`, not `clash`.

## Tests

- **A test title states the exact case it checks, in full words.** Write "A team
  collection can be renamed to its own name with the first letter capitalized",
  not "…to a different casing". Write "team collection name", not "team name".

## Control plane (`controlplane/`)

### Expected failures

- **Return expected failures as a result object, not a string sentinel.**
  Prefer `{ ok: true; … } | { ok: false; error }` over values like
  `'name_taken'`. Give each kind of failure its own error class, which can
  carry its status code and message so callers don't repeat them.
- **Check the error's class before mapping it to a specific status code.**
  Any other failure gets a generic `ERR`, so a new kind of failure is never
  reported as an existing one. `GraphCollectionsRepository.ts` and the
  graph-collection handlers show the pattern.

## Studio (`studio/`)

### URLs

- **Read and write query parameters with [`nuqs`](https://nuqs.47ng.com), never by
  hand.** Use `useQueryState` for a single parameter and `useQueryStates` for a
  group that changes together. Do not build a `URL` from `window.location` and
  call `router.replace`; nuqs already defaults to `history: 'replace'` and
  `shallow: true`.
- **Declare a group's parsers once and export them**, so every reader and writer
  of those parameters shares one definition, e.g.
  `export const traceParams = { traceID: parseAsString, spanID: parseAsString }`
  in `components/analytics/data-table.tsx`.
- **Build URLs with `buildUrl` from `@/lib/build-url`**, not string
  concatenation or `URLSearchParams`. It fills `:param` path segments, turns
  anything left over into query parameters, and drops `null`, `undefined` and
  `''` so optional parameters can be passed unconditionally.

### Validation

- **Validate with a [`zod`](https://zod.dev) schema and `safeParse`**, not
  hand-written checks. Read the message from `error.issues[0].message`. When
  several components run the same check, put the parse in one function that
  returns the message, so the components only call it. See `teamNameConflict`
  in `lib/graph-collections.ts`.

### Component state

- **Use `useReducer` when state values are related.** One user action that
  updates more than one value is the sign, e.g. editing a name also clears the
  server's error. Keep each action named after the event, such as
  `{ type: 'SET_VALUE', value }` or `{ type: 'SHARE_REFUSED', name }`. Use
  `useState` for a value that changes on its own. See the collection dialogs in
  `components/playground/graph-collections/dialogs/`.

### Forms

- **Lock a form's inputs while its mutation is pending.** Pass
  `disabled={isPending}` to every input, radio group and select. Otherwise a
  late server response can describe a value the user has since changed.
