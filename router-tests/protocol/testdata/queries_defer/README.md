# Defer Query Test Fixtures

This directory contains 105 GraphQL query variants that exercise `@defer`
support across nine query families. Each family has one expected complete
response, `<source>_original.json`, shared by all of its variants.

The tests parse each response with Go's MIME reader, validate JSON parts,
pending/completed IDs and `hasNext`, then merge the deferred data and compare it
with the family's expected response. This also checks parallel defers, whose
part order can vary. Multipart framing is covered by small writer tests rather
than a full wire snapshot for every query.

## Naming Convention

```text
{source}_defer_{number}_{description}.graphql
```

`source` is the base query name (`<source>_original.graphql` in this directory).
`number` is the two-digit variation index (01–13).
`description` is a short slug.

## Variation Types

### Core Variations (01–10, applied to all source queries)

| # | Name | What it tests |
|---|------|--------------|
| 01 | `single_defer` | One field deferred, rest immediate |
| 02 | `single_defer_between_regular` | Deferred fragment sandwiched between non-deferred fields |
| 03 | `multiple_fields_deferred` | Multiple fields inside a single `... @defer` |
| 04 | `all_fields_deferred` | Everything deferred; the initial data is empty |
| 05 | `nested_defer` | Two levels of nested `... @defer { ... @defer { } }` |
| 06 | `nested_defer_variation` | Outer defer has a regular field plus an inner defer |
| 07 | `parallel_defers` | Two sibling `... @defer` fragments at the same level |
| 08 | `defer_nested_object` | An entire nested object (typically from a different subgraph) is deferred |
| 09 | `duplicated_field_across_defer` | Same field appears in both deferred and non-deferred selection |
| 10 | `extensive_parallel` | Every individual field group in its own `... @defer` inside a top-level defer |

### Fragment Variations (11–13)

Applied to: `employees`, `full`, `products`, `requires_mood`, `requires_different_depth`.

For queries that have inline fragments (`... on SomeType { }`) but no named fragment
definitions, inline fragments are first promoted to named fragment definitions.

| # | Name | What it tests |
|---|------|--------------|
| 11 | `fragment_around_and_inside` | `... @defer { ...Frag }` AND inside the fragment `... @defer { field }` |
| 12 | `fragment_body_defer` | Fragment spread used normally; fragment body contains `... @defer { fields }` |
| 13 | `fragment_spread_defer` | `...FragmentName @defer` — defer directive on the spread itself |

## Running the Tests

```bash
cd router-tests
go test ./protocol -run '^TestDefer' -count=1
```

When expected application data changes, update the family's single
`_original.json` response. Changes to MIME boundaries, JSON field order, generated
defer IDs, or parallel scheduling do not require regenerating response files.
