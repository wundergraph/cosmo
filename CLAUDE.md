# CLAUDE.md

> `AGENTS.md` is a symlink to this file, so both agents read the same conventions.

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
