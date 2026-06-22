import { describe, it } from "vitest";

/**
 * F11 · KI-DEFER-NO-ROOT-PROHIBITION · SYS-REQ-763
 *
 * Finding: our engine (graphql-go-tools rc.267) has NO validation rule that
 * rejects `@defer`/`@stream` on mutation or subscription root selection sets,
 * nor one that forbids an *unconditional* `@defer`/`@stream` on a subscription's
 * single root field. The GraphQL incremental-delivery spec defines the rule
 * "Defer And Stream Directives Are Used On Valid Root Field" for exactly this;
 * it is absent. Such operations are silently admitted and planned into
 * spec-undefined behavior.
 *
 * Engine evidence (CONFIRMED_IN_SOURCE_ONLY):
 *   pkg/astvalidation/operation_validation.go — DefaultOperationValidator()
 *   registers exactly 18 rules (lines 54-71):
 *       AllVariablesUsed, AllVariableUsesDefined,
 *       DocumentContainsExecutableOperation, OperationNameUniqueness,
 *       LoneAnonymousOperation, SubscriptionSingleRootField, FieldSelections,
 *       FieldSelectionMerging, KnownArguments, Values, ArgumentUniqueness,
 *       RequiredArguments, Fragments, DirectivesAreDefined,
 *       DirectivesAreInValidLocations, VariableUniqueness,
 *       DirectivesAreUniquePerLocation, VariablesAreInputTypes.
 *   None is a defer/stream root-prohibition rule. There is no
 *   operation_rule_*defer* / *stream* / *root* file at all in the package.
 *
 *   SubscriptionSingleRootField (operation_rule_subscription_single_root_field.go)
 *   only counts root selections (>1 -> error); its EnterDocument visitor has
 *   zero awareness of @defer/@stream, so the spec's "no unconditional defer on
 *   the subscription root field" clause is unenforced.
 *
 * Why there is NO live RED test possible (CONFIRMED_IN_SOURCE_ONLY):
 *   The demo supergraph has ONLY Query root operations. There is no Mutation
 *   root operation type, and no `subscription:` root operation type — the
 *   `Subscription` type in the SDL is a billing *entity object* reached via
 *   `Organization.subscription`, not a GraphQL subscription root.
 *
 *   Probed against the live router (http://localhost:3002/graphql):
 *     - `mutation { ... @defer { __typename } }`
 *         -> {"errors":[{"message":"operation type mutation is not defined;
 *             did you forget to merge the base schema?","path":["mutation"]}]}
 *       The mutation is rejected because no Mutation root exists, BEFORE any
 *       defer-root rule could ever run — so the missing rule has no
 *       manifestation.
 *     - `subscription { ... @defer { __typename } }`
 *         -> {"payload":{"errors":[{"message":"directive: defer undefined",
 *             "path":["subscription"]}]}}
 *       The subscription is rejected because `@defer` is not even defined in the
 *       subscription schema scope (a separate concern), again pre-empting the
 *       absent root rule.
 *
 *   The defect is the ABSENCE of a validation rule; exercising it requires a
 *   supergraph that actually exposes a Mutation and/or Subscription root with
 *   @defer/@stream defined in scope. The demo provides neither, so the symptom
 *   is not wire-observable here. -> NEEDS_CONFIG to reproduce live (a schema
 *   with a real mutation/subscription root), CONFIRMED_IN_SOURCE_ONLY today.
 *
 * Overlap: none of BT-1/BT-2/BT-3 or B1-B7 (those are all @defer runtime
 * behaviors / if-handling / label validation; this is a distinct missing
 * root-location validation rule). Sibling-in-spirit of F10 (also a missing
 * validation rule), but a different rule.
 */
describe("F11 KI-DEFER-NO-ROOT-PROHIBITION (CONFIRMED_IN_SOURCE_ONLY)", () => {
  it.skip(
    "validator should reject @defer/@stream on a mutation/subscription root " +
      "field (and unconditional defer on a subscription root) per the spec rule " +
      "'Defer And Stream Directives Are Used On Valid Root Field'; our engine " +
      "registers no such rule. Not wire-observable on the demo: no Mutation root " +
      "exists and @defer is undefined in subscription scope, both of which " +
      "pre-empt the (absent) root rule before it could fire.",
    () => {
      // Intentionally skipped: missing-validation-rule, requires a supergraph
      // with a real mutation/subscription root to manifest over HTTP.
      // Correct behavior (would assert against such a schema):
      //   POST `mutation { ... @defer { __typename } }` -> a validation error
      //   naming @defer as not allowed on a mutation root, NOT a successful
      //   multipart deferred response.
    },
  );
});
