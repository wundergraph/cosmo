# Experiment results: can an LLM build monday.com queries from just a file tree?

**Setup.** monday.com's public SDL (`https://api.monday.com/v2/get_schema?format=sdl`,
~8,250 lines, 527 types, 81 queries, 172 mutations) was rendered into a file tree
with `graphql-fs build`. For each of five complex use cases from monday's API
docs, a **separate sub-agent** was given *only* the natural-language prompt and
the path to the file tree. Each was told to explore with `ls`/`cat`/`grep`/`find`
only — no internet, and no reading the full `schema.graphql` dump. Its query was
then graded against the canonical query from monday's docs with
`graphql-fs compare` (parse + validate both against the schema, compare field
paths and canonicalised arguments).

## Scoreboard

| Case | Use case | Generated valid? | Structure F1 | Args F1 | Notes |
|------|----------|:---:|:---:|:---:|-------|
| 01 | `items_page` with `query_params` rules + operators | ✅ | 1.00 | 0.67 | Valid alternative strategy (see below) |
| 02 | `create_item` with JSON `column_values` | ✅ | 1.00 | 1.00 | Exact match |
| 03 | `next_items_page` cursor pagination | ✅ | 1.00 | 1.00 | Exact match |
| 04 | `items_page_by_column_values` (column filters) | ✅ | 1.00 | 0.80 | Only diff: `ID` written as `"123"` vs `123` |
| 05 | `boards` + `hierarchy_types` enum + nested `items_page` | ✅ | 1.00 | 0.88 | Only diff: `ID` written as `"123"` vs `123` |

- **5/5 generated queries are valid** against the real monday schema.
- **5/5 have perfect selection structure** — the agents found the right endpoint,
  the right nesting, and the right return fields every time, including
  non-obvious ones (top-level `next_items_page` vs board-nested `items_page`;
  the dedicated `items_page_by_column_values` endpoint).
- The agents correctly discovered, from the tree alone: input-object shapes
  (`ItemsQuery` → `rules` → `ItemsQueryRule`), the JSON-string `column_values`
  argument, and **enum values** (`classic`, `multi_level`, `any_of`,
  `not_any_of`, …) — exactly the things that are invisible in a field signature
  and normally require reading the schema.

## Where the "mismatches" came from

The strict args score is dragged down by two things, neither of which is a real
error:

1. **`ID` literal form (cases 04, 05, and part of 01).** Agents wrote
   `ids: ["1234567890"]`; the docs wrote `ids: [1234567890]`. GraphQL's `ID`
   type accepts both an int and a string literal — these are semantically
   identical, and both validate. The comparator is deliberately strict about
   literal form, so it flags them.

2. **Case 01 — a genuinely different but valid strategy.** To express "date
   between 2023-06-01 and 2023-06-30", the docs use one rule with
   `operator: between` and a two-element `compare_value` array. The agent instead
   used **two** rules (`greater_than_or_equals` + `lower_than_or_equal`) with
   scalar compare values, and omitted the top-level `operator: and` (which
   defaults to `and`). The result is a valid query that satisfies the same
   intent — just not byte-for-byte the doc's idiom. This is the kind of divergence
   that a structural/field-path metric (F1 = 1.00 here) captures better than an
   argument-literal metric.

## Takeaway

For a large, unfamiliar schema, the file-tree projection was **sufficient on its
own** to construct correct, valid queries across all five cases — including the
parts that live in argument/input/enum detail rather than in field names. The
remaining differences are literal-form (`ID`) noise and one equally-valid
filtering strategy, not correctness failures. This supports the original premise:
progressive disclosure over a navigable tree lets the model pull exactly the
schema detail it needs, and `grep`/`cat`/symlink-following is enough to do it.

Reproduce with `./run.sh` (regenerates the tree from the live SDL and re-grades
every `actual.graphql`).
