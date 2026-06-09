Run JavaScript source as a single async arrow function in the Code Mode sandbox.
Use `await tools.<name>(vars)` for operations registered by code_mode_search_tools;
the cumulative tools namespace is available at `yoko://persisted-ops.d.ts`.

Style: write compact source — single line if it fits, no // comments, no blank lines, short variable names.
The JSON wrapping that encodes your source charges you for every newline and indent space.

Batch everything into ONE code_mode_run_js call.
≥3 `tools.*` invocations per call is normal;
over-fetch and decide in JS, don't round-trip.
A failing inner call degrades the result, not the whole script — wrap with try/catch and surface the error in the return value.

The return value of your async arrow is the only output channel — `console` is not available.
To surface intermediate state, include it in the returned object (e.g. `return { result, debug: { ... } }`).
For resilient fan-out use `Promise.allSettled` — `Promise.all` rejects on first failure and discards partial results.
Up to 256 `tools.*` invocations per call.
Non-serializable leaves in the return value (`BigInt`, functions, symbols, `undefined`, circular refs) are replaced with the sentinel string `<<non-serializable: KIND>>` and listed in the response's `warnings: [{path, kind}]` field;
the rest of the value still comes through.

Example: `async()=>{const o=await tools.getOrders({customerId:"c_1"});if(o.errors?.length)throw new Error(o.errors[0].message);return o.data.orders;}`

Type declarations for reference (consumed via `yoko://persisted-ops.d.ts`):

```ts
type GraphQLError = { message: string; path?: (string | number)[]; extensions?: Record<string, unknown> };
type R<T> = Promise<{ data: T | null; errors?: GraphQLError[] }>;

declare const tools: {};

declare function notNull<T>(value: T | null | undefined, message?: string): T;
declare function compact<T>(value: T): T;
```