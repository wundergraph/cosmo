/**
 * Filter extracted comments to produce the gold set.
 * Selects human, non-trivial review comments from merged PRs.
 * Reads output/comments.jsonl, writes output/gold_set.jsonl
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PRRecord, ReviewComment } from "./types";

const OUTPUT_DIR = join(import.meta.dir, "../output");
const INPUT_FILE = join(OUTPUT_DIR, "comments.jsonl");
const OUTPUT_FILE = join(OUTPUT_DIR, "gold_set.jsonl");

interface GoldSetEntry {
  pr_number: number;
  pr_title: string;
  pr_labels: string[];
  pr_author: string;
  file: string;
  line: number | null;
  author: string;
  diff_hunk: string;
  body: string;
  category?: string;
}

// Heuristic filters to skip low-value comments
const SKIP_PATTERNS = [
  /^lgtm/i,
  /^nit:/i,
  /^nit\s/i,
  /^\+1/,
  /^👍/,
  /^:thumbsup:/,
  /^thanks/i,
  /^thank you/i,
  /^nice/i,
  /^looks good/i,
  /^ship it/i,
];

const BOT_AUTHORS = new Set([
  "coderabbitai[bot]",
  "coderabbitai",
  "github-actions[bot]",
  "github-actions",
  "dependabot[bot]",
  "dependabot",
  "renovate[bot]",
  "renovate",
  "codecov[bot]",
  "codecov",
]);

function isBot(comment: ReviewComment): boolean {
  return comment.is_bot || BOT_AUTHORS.has(comment.author);
}

function isTrivial(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length < 10) return true;
  return SKIP_PATTERNS.some((p) => p.test(trimmed));
}

async function main() {
  const content = await readFile(INPUT_FILE, "utf-8");
  const records: PRRecord[] = content.trim().split("\n").map((line) => JSON.parse(line));

  const goldSet: GoldSetEntry[] = [];
  let skippedBot = 0;
  let skippedTrivial = 0;
  let skippedNotMerged = 0;

  for (const pr of records) {
    if (pr.pr_state !== "MERGED") {
      skippedNotMerged += pr.review_comments.length;
      continue;
    }

    for (const comment of pr.review_comments) {
      if (isBot(comment)) {
        skippedBot++;
        continue;
      }

      if (isTrivial(comment.body)) {
        skippedTrivial++;
        continue;
      }

      goldSet.push({
        pr_number: pr.pr_number,
        pr_title: pr.pr_title,
        pr_labels: pr.pr_labels,
        pr_author: pr.pr_author,
        file: comment.file,
        line: comment.line,
        author: comment.author,
        diff_hunk: comment.diff_hunk,
        body: comment.body,
      });
    }
  }

  await writeFile(OUTPUT_FILE, goldSet.map((e) => JSON.stringify(e)).join("\n") + "\n");

  console.log(`Gold set: ${goldSet.length} comments`);
  console.log(`Skipped: ${skippedBot} bot, ${skippedTrivial} trivial, ${skippedNotMerged} from non-merged PRs`);
  console.log(`Written to ${OUTPUT_FILE}`);

  // Print top reviewers
  const reviewerCounts = new Map<string, number>();
  for (const entry of goldSet) {
    reviewerCounts.set(entry.author, (reviewerCounts.get(entry.author) ?? 0) + 1);
  }
  const sorted = [...reviewerCounts.entries()].sort((a, b) => b[1] - a[1]);
  console.log("\nTop reviewers in gold set:");
  for (const [author, count] of sorted.slice(0, 15)) {
    console.log(`  ${author}: ${count}`);
  }
}

main().catch(console.error);
