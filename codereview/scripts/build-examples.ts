/**
 * Build curated few-shot examples from classified gold set.
 * Uses Claude to select the best examples across categories.
 * Reads output/classified.jsonl, writes output/few_shot_examples.jsonl
 *
 * Usage: bun run scripts/build-examples.ts [--dry-run]
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";

const OUTPUT_DIR = join(import.meta.dir, "../output");
const INPUT_FILE = join(OUTPUT_DIR, "classified.jsonl");
const OUTPUT_FILE = join(OUTPUT_DIR, "few_shot_examples.jsonl");

interface ClassifiedEntry {
  pr_number: number;
  pr_title: string;
  pr_labels: string[];
  file: string;
  author: string;
  diff_hunk: string;
  body: string;
  category: string;
  actionability: string;
  domain_specificity: string;
}

interface FewShotExample {
  category: string;
  file_type: string;
  subsystem: string;
  diff_hunk: string;
  review_comment: string;
  pr_number: number;
  reviewer: string;
}

function inferSubsystem(labels: string[], filePath: string): string {
  const subsystemLabels = ["router", "controlplane", "studio", "cli", "composition"];
  for (const label of labels) {
    if (subsystemLabels.includes(label)) return label;
  }
  if (filePath.startsWith("router/")) return "router";
  if (filePath.startsWith("controlplane/")) return "controlplane";
  if (filePath.startsWith("studio/")) return "studio";
  if (filePath.startsWith("cli/")) return "cli";
  if (filePath.startsWith("connect/")) return "connect";
  return "other";
}

const SYSTEM_PROMPT = `You are selecting the best code review examples from a set of candidates.

For each category, select 3-5 examples that are:
1. Self-contained (the diff hunk + comment make sense without broader context)
2. Actionable (the comment clearly states what should change and why)
3. Representative of common review patterns in this project
4. Short enough to be useful as few-shot examples (prefer shorter diff hunks)

Return a JSON array of indices (0-based) of the selected examples. Just the array of numbers, nothing else.`;

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  const content = await readFile(INPUT_FILE, "utf-8");
  const entries: ClassifiedEntry[] = content.trim().split("\n").map((line) => JSON.parse(line));

  // Group by category, skip nits and unknowns
  const byCategory = new Map<string, { index: number; entry: ClassifiedEntry }[]>();
  entries.forEach((entry, index) => {
    if (entry.category === "nit" || entry.category === "unknown") return;
    const existing = byCategory.get(entry.category) ?? [];
    existing.push({ index, entry });
    byCategory.set(entry.category, existing);
  });

  if (dryRun) {
    console.log(`Candidates across ${byCategory.size} categories:`);
    for (const [cat, items] of byCategory) {
      console.log(`  ${cat}: ${items.length} candidates`);
    }
    return;
  }

  const client = new Anthropic();
  const selected: FewShotExample[] = [];

  for (const [category, items] of byCategory) {
    if (items.length === 0) continue;

    // For small categories, take all
    if (items.length <= 3) {
      for (const { entry } of items) {
        selected.push({
          category,
          file_type: extname(entry.file) || "unknown",
          subsystem: inferSubsystem(entry.pr_labels, entry.file),
          diff_hunk: entry.diff_hunk.slice(0, 1000),
          review_comment: entry.body,
          pr_number: entry.pr_number,
          reviewer: entry.author,
        });
      }
      continue;
    }

    // For larger categories, use LLM to select best examples
    const candidateList = items
      .map(
        ({ entry }, i) =>
          `[${i}] PR #${entry.pr_number} ${entry.file} (${entry.author})
Diff (${entry.diff_hunk.length} chars): ${entry.diff_hunk.slice(0, 300)}
Comment: ${entry.body.slice(0, 200)}`,
      )
      .join("\n\n");

    console.log(`Selecting from ${items.length} candidates for category: ${category}`);

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Select 3-5 best examples from this "${category}" category:\n\n${candidateList}`,
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "[]";
    let indices: number[];
    try {
      indices = JSON.parse(text.match(/\[[\d,\s]*\]/)?.[0] ?? "[]");
    } catch {
      console.warn(`Failed to parse LLM response for category "${category}", taking first 3`);
      indices = items.slice(0, 3).map((_, i) => i);
    }

    for (const idx of indices) {
      if (idx >= 0 && idx < items.length) {
        const { entry } = items[idx];
        selected.push({
          category,
          file_type: extname(entry.file) || "unknown",
          subsystem: inferSubsystem(entry.pr_labels, entry.file),
          diff_hunk: entry.diff_hunk.slice(0, 1000),
          review_comment: entry.body,
          pr_number: entry.pr_number,
          reviewer: entry.author,
        });
      }
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  await writeFile(OUTPUT_FILE, selected.map((e) => JSON.stringify(e)).join("\n") + "\n");
  console.log(`Wrote ${selected.length} few-shot examples to ${OUTPUT_FILE}`);

  // Summary
  const catCounts = new Map<string, number>();
  for (const e of selected) {
    catCounts.set(e.category, (catCounts.get(e.category) ?? 0) + 1);
  }
  console.log("\nExamples per category:");
  for (const [cat, count] of [...catCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }
}

main().catch(console.error);
