import { describe, it } from "vitest";

/**
 * F13 · KI-STREAM-DEF-NONNULL · SYS-REQ-776
 *
 * Finding: the `@stream` directive definition shipped in our engine
 * (graphql-go-tools rc.267) declares its `initialCount` argument as a
 * NULLABLE `Int = 0`, whereas the GraphQL `@defer`/`@stream` spec mandates a
 * NON-NULL `Int! = 0`.
 *
 * Engine evidence (CONFIRMED_IN_SOURCE_ONLY):
 *   pkg/asttransform/stream.graphql line 8:
 *       initialCount: Int = 0          <-- nullable; spec requires Int! = 0
 *   directive @stream(
 *       label: String
 *       if: Boolean! = true
 *       initialCount: Int = 0
 *   ) on FIELD
 *
 * Why there is NO live RED test possible:
 *   `stream.graphql` is an ORPHAN file. The only embedded base-schema sources
 *   are base.graphql + internal.graphql (see baseschema.go //go:embed lines);
 *   stream.graphql is NOT in the embed set, and `grep -i stream base.graphql
 *   internal.graphql` returns nothing. Therefore `@stream` is never added to
 *   any live schema: every `@stream` query is hard-rejected at validation as
 *   "unknown directive stream" (that rejection is F12, HTTP-observable).
 *
 *   Because the directive never reaches a live schema, the nullability of its
 *   `initialCount` argument has NO runtime manifestation — it cannot be probed
 *   over HTTP against the router. The defect lives purely in the SDL shape of
 *   an unembedded definition file. Asserting the correct (`Int!`) shape can
 *   only be done by reading the engine source, not by a wire-level test.
 *
 * Overlap: definition-shape sibling of F12 (KI-STREAM-NOT-EMBEDDED) and F14
 * (KI-STREAM-UNIMPLEMENTED). Does not map to any of BT-1/BT-2/BT-3 or B1-B7
 * (those are all @defer behaviors; this is a @stream definition-shape issue).
 */
describe("F13 KI-STREAM-DEF-NONNULL (CONFIRMED_IN_SOURCE_ONLY)", () => {
  it.skip(
    "@stream.initialCount should be declared Int! = 0 (non-null) per spec, " +
      "but our engine declares Int = 0 (nullable) in an unembedded stream.graphql; " +
      "no HTTP manifestation because @stream is never embedded into a live schema",
    () => {
      // Intentionally skipped: definition-shape-only, not wire-observable.
      // Correct behavior (would assert if @stream were embedded and inspectable):
      //   the introspected/parsed @stream directive's `initialCount` arg type
      //   is NonNull(Int) with default 0, i.e. `Int! = 0`.
    },
  );
});
