# Code Review Knowledge Pipeline

Extracts knowledge from historical pull request reviews in [wundergraph/cosmo](https://github.com/wundergraph/cosmo) and produces configuration for [CodeRabbit](https://coderabbit.ai) automated code reviews.

The pipeline learns from ~1400 human review comments across 500 PRs to teach CodeRabbit the team's standards, patterns, and domain expertise.

## How It Works

```
download.sh          Fetch PR data from GitHub API
    |
extract.ts           Parse markdown into structured JSON (comments.jsonl)
    |
filter.ts            Select high-value human comments (gold_set.jsonl)
    |
    +-- build:profiles       Reviewer expertise by subsystem (reviewer_profiles.json)
    +-- build:guidelines     LLM-synthesized review rules (guidelines.md, path_instructions.json)
    +-- build:antipatterns   False positive detection from bot threads (anti_patterns.json)
    +-- build:coderabbit     Assemble final .coderabbit.yaml
```

### What Goes Into .coderabbit.yaml

1. **Global guidelines** -- review rules synthesized from human comments (e.g., "wrap errors with `%w`", "use `slices.Contains` for membership checks")
2. **Per-subsystem instructions** -- rules specific to router, controlplane, studio, cli, connect
3. **Expert escalation** -- @mentions for domain experts based on review history (e.g., @endigma for router changes)
4. **False positive patterns** -- things CodeRabbit previously flagged that humans explicitly rejected

## Quick Start

```bash
# Install dependencies
bun install

# Download PRs from GitHub (requires gh CLI auth)
./download.sh --since 2025-03-01

# Run full pipeline (includes LLM generation via Claude CLI)
bun run pipeline:full

# Or step by step:
bun run extract         # Parse input/*.md -> output/comments.jsonl
bun run filter          # Filter to gold set (human, merged, non-trivial)
bun run build:profiles  # Build reviewer profiles
bun run build:guidelines  # Generate guidelines via Claude CLI (slow)
bun run build:antipatterns  # Fetch GitHub threads + classify bot feedback
bun run build:coderabbit    # Assemble .coderabbit.yaml
```

## Pipeline Commands

| Command | What it does | Requires LLM? |
|---------|-------------|----------------|
| `bun run extract` | Parse markdown to JSON, incremental via manifest | No |
| `bun run extract:full` | Force full re-parse of all input files | No |
| `bun run filter` | Filter to gold set (human, merged, non-trivial) | No |
| `bun run build:profiles` | Build reviewer subsystem expertise map | No |
| `bun run build:guidelines` | Synthesize review guidelines from gold set | Yes (Claude CLI) |
| `bun run build:antipatterns` | Fetch threads from GitHub, classify bot feedback | No (GitHub API) |
| `bun run build:coderabbit` | Assemble .coderabbit.yaml from all artifacts | No |
| `bun run pipeline` | extract + filter + profiles (fast, no LLM) | No |
| `bun run pipeline:full` | Full pipeline including LLM generation | Yes |
| `bun run pipeline:rebuild` | Force full extract + full pipeline | Yes |

## Directory Structure

```
codereview/
  download.sh              # Fetch PRs via gh CLI
  package.json             # Bun project, pipeline scripts
  STRATEGY.md              # Design rationale and research

  scripts/
    types.ts               # Shared TypeScript interfaces
    extract.ts             # Markdown -> JSONL parser (incremental)
    filter.ts              # Gold set filter (human, merged, non-trivial)
    classify.ts            # LLM comment classification (unused, optional)
    build-guidelines.ts    # Synthesize guidelines via Claude CLI
    build-examples.ts      # Curate few-shot examples (unused, optional)
    build-profiles.ts      # Reviewer expertise profiles
    build-antipatterns.ts  # Bot false positive detection via GitHub threads
    build-coderabbit.ts    # Assemble .coderabbit.yaml

  input/                   # Raw PR markdown files (one per PR)
    2033.md, 2034.md, ...

  output/                  # Generated artifacts
    comments.jsonl         # All parsed PR records
    manifest.json          # Incremental processing tracker
    gold_set.jsonl         # Filtered high-value human comments
    guidelines.md          # Synthesized review guidelines
    path_instructions.json # Per-subsystem review rules
    reviewer_profiles.json # Reviewer expertise map
    threads.jsonl          # Cached GitHub API thread data
    anti_patterns.json     # Classified bot comment outcomes
    anti_patterns.md       # Human-readable false positive report
```

## Key Design Decisions

**Human signal over bot signal.** About half the review comments come from CodeRabbit itself. These are excluded from guideline generation to avoid an LLM-training-on-LLM-output feedback loop. Human comments are the ground truth.

**Few-shot + guidelines over fine-tuning.** ~1400 comments is too small for fine-tuning. Synthesized guidelines + curated examples is cheaper, more transparent, and easy to iterate.

**Incremental processing.** The extract step tracks file mtimes in `manifest.json` and only re-parses new/modified files. The antipatterns step caches GitHub API responses in `threads.jsonl`.

**Expert escalation from data.** Reviewer profiles are derived automatically from comment distribution. Anyone with 20+ comments in a subsystem is tagged as an expert for that area.

**False positive detection.** The antipatterns step uses GitHub's `in_reply_to_id` field to reconstruct threaded conversations, then classifies human responses to bot comments as accepted/rejected/ignored. Rejected patterns are fed back into CodeRabbit config as "do not flag" guidance.

## Prerequisites

- [Bun](https://bun.sh) runtime
- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated with access to wundergraph/cosmo
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) for LLM generation steps (`build:guidelines`)
