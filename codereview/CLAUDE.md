# Codereview Pipeline - Agent Instructions

This directory contains a pipeline that extracts knowledge from historical code reviews and produces `.coderabbit.yaml` configuration for the wundergraph/cosmo repository.

## Architecture

The pipeline processes PR data through these stages:

```
input/*.md → extract → filter → build artifacts → .coderabbit.yaml
```

All scripts are TypeScript, run with `bun`. The pipeline is defined in `package.json` scripts.

## Script Inventory

| Script | Input | Output | LLM? | Notes |
|--------|-------|--------|------|-------|
| `extract.ts` | `input/*.md` | `output/comments.jsonl`, `output/manifest.json` | No | Incremental via manifest. Use `--full` to force rebuild. |
| `filter.ts` | `output/comments.jsonl` | `output/gold_set.jsonl` | No | Filters to human, merged, non-trivial comments. BOT_AUTHORS set defines bots. |
| `build-profiles.ts` | `output/gold_set.jsonl` | `output/reviewer_profiles.json` | No | Maps reviewers to subsystems by comment count. |
| `build-guidelines.ts` | `output/gold_set.jsonl` | `output/guidelines.md`, `output/path_instructions.json` | Yes | Uses `claude -p` CLI (not SDK). Env var `CLAUDECODE=` must be unset to avoid nested session error. |
| `build-antipatterns.ts` | `output/comments.jsonl` + GitHub API | `output/threads.jsonl`, `output/anti_patterns.json`, `output/anti_patterns.md` | No | Fetches review comment threads via `gh api`, classifies bot feedback outcomes. Cached in threads.jsonl. Flags: `--fetch-only`, `--classify-only`, `--dry-run`. |
| `build-coderabbit.ts` | `output/guidelines.md`, `output/path_instructions.json`, `output/reviewer_profiles.json`, `output/anti_patterns.json` | `../../.coderabbit.yaml` | No | Assembles final config. Expert threshold: 20 comments. |
| `classify.ts` | `output/gold_set.jsonl` | `output/classified.jsonl` | Yes | Uses Anthropic SDK (requires API key). Not currently used in pipeline. |
| `build-examples.ts` | `output/classified.jsonl` | `output/few_shot_examples.jsonl` | Yes | Uses Anthropic SDK. Not currently used in pipeline. |

## Conventions

- **Shared types** are in `scripts/types.ts` (`PRRecord`, `ReviewComment`, `IssueComment`, `Review`).
- **Subsystem inference** uses PR labels first, then file path prefix (`router/`, `controlplane/`, `studio/`, `cli/`, `connect/`, `composition/`).
- **Bot detection** uses a hardcoded `BOT_AUTHORS` set in filter.ts and `isBot()` in build-antipatterns.ts. The GitHub username includes `[bot]` suffix (e.g., `coderabbitai[bot]`).
- **LLM calls** in build-guidelines.ts use Claude CLI (`claude -p --model claude-sonnet-4-20250514`) via `Bun.$` shell, writing prompt to a temp file and piping via stdin redirect. Must unset `CLAUDECODE` env var to avoid nested session error.
- **Incremental processing**: extract.ts tracks file mtimes in `manifest.json`. If files are updated or deleted, it triggers a full rebuild. New files are appended.
- **GitHub API caching**: build-antipatterns.ts stores raw thread data in `threads.jsonl`. Use `--classify-only` to re-run classification without re-fetching.

## Common Tasks

### Add new PRs and update everything
```bash
./download.sh --since 2025-01-01
bun run pipeline:full
```

### Re-run only the antipatterns analysis (no API fetch)
```bash
bun run build:antipatterns -- --classify-only
bun run build:coderabbit
```

### Force complete rebuild
```bash
bun run pipeline:rebuild
bun run build:antipatterns
bun run build:coderabbit
```

## Output: .coderabbit.yaml Structure

The generated config contains:
1. `reviews.instructions` — global guidelines from human review patterns
2. `reviews.instructions` (cont.) — "Known False Positive Patterns" section from rejected bot feedback
3. `reviews.path_instructions` — per-subsystem rules (router, controlplane, studio, cli, connect)
4. Expert escalation blocks within each path instruction — @mentions for domain experts
5. `reviews.path_filters` — excludes `codereview/**` from reviews

## Data Flow Details

**Gold set filtering criteria** (filter.ts):
- Human reviewers only (excludes coderabbitai, github-actions, dependabot, renovate, codecov)
- Merged PRs only
- Non-trivial: body > 10 chars, doesn't match SKIP_PATTERNS (lgtm, nit, thanks, etc.)

**Anti-pattern classification** (build-antipatterns.ts):
- Fetches review comments with `in_reply_to_id` from GitHub API to reconstruct threads
- Groups by thread: bot root comment + human replies
- Classifies via keyword heuristics: accepted (fixed/done/addressed), rejected (intentional/incorrect/disagree), ignored (no reply)
- Stats from last run: ~79% ignored, ~7% accepted, ~1% rejected, ~13% unclear

**Expert threshold**: 20+ gold set comments in a subsystem qualifies a reviewer as an expert for that subsystem. Top 3 experts are listed per subsystem.
