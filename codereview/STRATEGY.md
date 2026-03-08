# Code Review Knowledge Extraction Strategy

## Goal

Extract actionable knowledge from ~500 historical PRs (wundergraph/cosmo) and build artifacts that improve future LLM-driven code reviews. The approach uses **few-shot learning + synthesized guidelines** rather than fine-tuning -- cheaper, more transparent, and easier to iterate.

## Core Principle: Human Signal Over Bot Signal

About half the review comments come from coderabbitai (an LLM bot). These are excluded from training artifacts to avoid a feedback loop of LLM-training-on-LLM-output. Human reviewer comments are the ground truth. Bot comments are kept separately for validation (what did the bot catch vs miss vs get wrong).

---

## Phase 1: Extract and Classify

### Step 1: Parse Markdown to Structured JSON

Parse each `input/*.md` file into structured records:

```json
{
  "pr_number": 2334,
  "pr_title": "feat: add custom module implementing flight recorder",
  "pr_labels": ["router"],
  "pr_state": "MERGED",
  "pr_author": "endigma",
  "comments": [
    {
      "file": "router/cmd/flightrecorder/module/module.go",
      "line": 22,
      "author": "ysmolski",
      "is_bot": false,
      "diff_hunk": "...",
      "body": "Adding units would simplify editing configs...",
      "category": null
    }
  ]
}
```

The markdown structure is consistent: `### path/to/file:line` headers, `**Author**:` fields, diff hunks in code blocks, then comment body until `---`.

### Step 2: Classify Comments via LLM

Use Claude to classify each human comment into categories tailored to this codebase:

| Category | Description | Example |
|---|---|---|
| `architecture` | Module boundaries, separation of concerns, where code lives | "There should be only the main entry file that interacts with globals directly" |
| `api_design` | Config field naming, public API shape, backwards compat | "Adding units would simplify editing: `thresholdMillis`" |
| `correctness` | Logic bugs, missing edge cases, wrong behavior | "their blog recommends to set MinAge twice the duration" |
| `performance` | Goroutines, allocations, caching, sync vs async | "We capture events synchronously... could do it in a goroutine" |
| `go_idioms` | Error handling, interface usage, Go-specific patterns | "Could just check the variable for contents instead of a bool" |
| `testing` | Missing tests, test quality, test infrastructure | "Can you add a test for the error path?" |
| `config_schema` | Router YAML config, env vars, validation | "Should we leave it as a no-op with deprecation or remove it?" |
| `documentation` | Comments, READMEs, godoc | "Maybe just godoc, we don't need to fill router-tests with READMEs" |
| `dependency_mgmt` | Go modules, npm packages, version pinning | "remote plugins have generation rate limits -- can we avoid this?" |
| `scope_control` | Diff size, unrelated changes, PR focus | "Why is the diff so huge? Please check if nothing broke" |
| `nit` | Style, naming, formatting | Cosmetic suggestions |

Also tag each comment with:
- **actionability**: high / medium / low (did the author change code in response?)
- **domain_specificity**: high (requires cosmo knowledge) / low (generic)

### Step 3: Filter to Gold Set

Select comments that are:
- From human reviewers (not coderabbitai)
- Category is not `nit`
- Actionability is medium or high
- On merged PRs (the review feedback mattered)

This produces the high-value corpus for artifact generation.

---

## Phase 2: Build Artifacts

### Artifact 1: `guidelines.md` -- Project-Specific Review Guidelines

Group gold-set comments by category, deduplicate, and generalize into rules. Each rule cites the originating PR. Example:

```markdown
### Architecture
- Validation logic belongs in the config schema, not runtime checks (#2379)
- Only the main entry file should interact with globals; utility modules receive dependencies as parameters (#2335)

### Config & API Design
- Config field names should include units: `thresholdMillis` not `threshold` (#2334)
- When removing config fields, provide migration errors or document the breaking change (#2332)

### Performance
- Trace/snapshot operations should be async (goroutine) to avoid request-path latency (#2334)
```

**Generation method**: Feed ALL gold-set comments to Claude, ask it to synthesize a guidelines document. The LLM deduplicates naturally -- if 15 reviewers said "add units to config names," that becomes one rule.

### Artifact 2: `few_shot_examples.jsonl` -- Curated Review Examples

Select 30-50 diverse (diff_hunk, review_comment) pairs:

```json
{
  "category": "api_design",
  "file_type": "go",
  "subsystem": "router",
  "diff_hunk": "... (5-15 lines) ...",
  "review_comment": "Adding units would simplify editing configs",
  "pr_number": 2334,
  "reviewer": "ysmolski"
}
```

Selection criteria:
- Cover all categories with at least 2 examples each
- Short, self-contained diff hunks (under 30 lines)
- Direct and actionable comments
- Balanced across subsystems (router, controlplane, cli, studio)

### Artifact 3: `reviewer_profiles.json` -- Per-Reviewer Focus Areas

Map each reviewer's comment distribution across categories and summarize their style:

```json
{
  "StarpTech": {
    "focus": ["architecture", "scope_control", "config_schema"],
    "style": "asks probing questions, challenges design decisions"
  },
  "endigma": {
    "focus": ["architecture", "go_idioms", "dependency_mgmt"],
    "style": "direct suggestions, links to docs"
  }
}
```

Useful for simulating a specific reviewer's perspective or understanding team review norms.

### Artifact 4: `anti_patterns.md` -- What NOT to Review

Compare coderabbitai comments against human reactions to identify:
- **False positives**: bot suggested something, human disagreed
- **Noise**: bot flagged something no human cared about
- **Over-engineering**: bot suggested unnecessary complexity

This trains the LLM to avoid common automated review mistakes specific to this codebase.

---

## Phase 3: LLM Review Integration

### Prompt Structure

```
[System]
You are reviewing code for wundergraph/cosmo, a GraphQL federation router.
{guidelines.md}
{anti_patterns.md}

[Few-shot examples]
Here are examples of good review comments from this project:
{3-5 dynamically selected examples}

[User]
PR Title: {title}
PR Description: {description}
Labels: {labels}
Diff:
{diff}
```

### Dynamic Example Selection

For each new PR:
1. From labels, determine subsystem (router, controlplane, etc.)
2. From file extensions, determine language (Go, TypeScript, YAML)
3. From diff content, estimate relevant categories (new file -> architecture, config change -> config_schema)
4. Select 3-5 few-shot examples matching on at least 2 dimensions
5. If the diff touches files previously reviewed in the corpus, include those historical comments

### Confidence-Based Escalation

- If the LLM finds issues in categories where human reviewers frequently commented, flag for human review
- If the PR touches subsystems with low historical review coverage, flag for human review

---

## Pipeline Implementation

### Directory Structure

```
codereview/
  input/                    # Raw PR markdown files (existing)
  download.sh               # Existing download script
  package.json              # Dependencies (bun project)
  scripts/
    types.ts                # Shared TypeScript types
    extract.ts              # Parse markdown -> JSON
    classify.ts             # Classify comments via Claude API
    filter.ts               # Select gold set
    build-guidelines.ts     # Generate guidelines.md
    build-examples.ts       # Curate few-shot examples
    build-profiles.ts       # Build reviewer profiles
  output/
    comments.jsonl          # All parsed comments
    classified.jsonl        # Comments with categories
    gold_set.jsonl          # Filtered high-value comments
    guidelines.md           # Synthesized review guidelines
    few_shot_examples.jsonl # Curated examples
    reviewer_profiles.json  # Per-reviewer profiles
```

### Processing Order

```
bun run extract       (deterministic)  input/*.md -> comments.jsonl
    |
bun run filter        (deterministic)  comments.jsonl -> gold_set.jsonl
    |
bun run classify      (LLM calls)     gold_set.jsonl -> classified.jsonl
    |
    +-- bun run build:guidelines  (LLM)   classified.jsonl -> guidelines.md
    +-- bun run build:examples    (LLM)   classified.jsonl -> few_shot_examples.jsonl
    +-- bun run build:profiles    (stats)  gold_set.jsonl -> reviewer_profiles.json

Quick pipeline (no LLM):  bun run pipeline
```

### Incremental Updates

When new PRs are downloaded via `download.sh`:
1. Re-run `bun run extract` (processes all files, fast)
2. Re-run `bun run filter` to update the gold set
3. Re-run LLM steps (`classify`, `build:guidelines`, `build:examples`) periodically

---

## Key Constraints

1. **No fine-tuning.** Few-shot + guidelines is cheaper, more transparent, and iteratable. 1,358 human comments is too small for meaningful fine-tuning gains over good prompting.

2. **Keep examples short.** Trim diff hunks to 5-15 relevant lines. Long hunks waste context window and dilute the signal.

3. **Version the artifacts.** Tag with the PR date range they were derived from. As the codebase evolves, some patterns become obsolete.

4. **Guidelines for common patterns, examples for nuance.** If many reviewers say the same thing, it becomes a guideline rule. Few-shot examples are for patterns too subtle to express as rules.

---

## Sources

- [Evaluating LLMs for Code Review (arxiv)](https://arxiv.org/html/2505.20206v1)
- [Code Review in the Age of AI - Addy Osmani](https://addyo.substack.com/p/code-review-in-the-age-of-ai)
- [Rethinking Code Review Workflows with LLM Assistance (arxiv)](https://arxiv.org/html/2505.16339v1)
- [Automated Code Reviews with LLMs Guide - Neova Solutions](https://www.neovasolutions.com/2026/01/08/automated-code-reviews-with-llms-best-practices-and-implementation-guide/)
- [Automated Code Review at Ericsson (arxiv)](https://arxiv.org/html/2507.19115v2)
- [Awesome Reviewers - baz-scm](https://github.com/baz-scm/awesome-reviewers)
- [From Review Thread to Team Standard - baz.co](https://baz.co/resources/from-review-thread-to-team-standard-how-we-built-awesomereviewers)
- [RAG Applications: Code Review to Knowledge Discovery - Qodo](https://www.qodo.ai/blog/rag-applications-and-examples/)
- [Survey on Modern Code Review (arxiv)](https://arxiv.org/html/2405.18216v1)
