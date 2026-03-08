/**
 * Classify gold set comments by category using Claude.
 * Reads output/gold_set.jsonl, writes output/classified.jsonl
 *
 * Usage: bun run scripts/classify.ts [--dry-run] [--limit N]
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUTPUT_DIR = join(import.meta.dir, "../output");
const INPUT_FILE = join(OUTPUT_DIR, "gold_set.jsonl");
const OUTPUT_FILE = join(OUTPUT_DIR, "classified.jsonl");

const CATEGORIES = [
  "architecture",
  "api_design",
  "correctness",
  "performance",
  "go_idioms",
  "testing",
  "config_schema",
  "documentation",
  "dependency_mgmt",
  "scope_control",
  "nit",
] as const;

const SYSTEM_PROMPT = `You are classifying code review comments from the wundergraph/cosmo project (a GraphQL federation router).

For each comment, output a JSON object with:
- "category": one of: ${CATEGORIES.join(", ")}
- "actionability": "high" (author changed code), "medium" (valid point), or "low" (minor/optional)
- "domain_specificity": "high" (requires cosmo/GraphQL knowledge) or "low" (generic programming)

Category definitions:
- architecture: module boundaries, separation of concerns, where code should live
- api_design: config field naming, public API shape, backwards compatibility
- correctness: logic bugs, missing edge cases, wrong behavior
- performance: goroutines, allocations, caching, sync vs async patterns
- go_idioms: error handling, interface usage, Go-specific patterns
- testing: missing tests, test quality, test infrastructure
- config_schema: router YAML config, env vars, validation
- documentation: comments, READMEs, godoc
- dependency_mgmt: Go modules, npm packages, version pinning
- scope_control: diff size, unrelated changes, PR focus
- nit: style, naming, formatting (minor cosmetic)

Respond with ONLY the JSON object, no markdown fences.`;

interface GoldSetEntry {
  pr_number: number;
  pr_title: string;
  pr_labels: string[];
  file: string;
  author: string;
  diff_hunk: string;
  body: string;
}

interface ClassifiedEntry extends GoldSetEntry {
  category: string;
  actionability: string;
  domain_specificity: string;
}

async function classifyBatch(
  client: Anthropic,
  entries: GoldSetEntry[],
): Promise<ClassifiedEntry[]> {
  const userContent = entries
    .map(
      (e, i) =>
        `--- Comment ${i + 1} ---
PR #${e.pr_number}: ${e.pr_title}
File: ${e.file}
Reviewer: ${e.author}

Diff context:
${e.diff_hunk.slice(0, 500)}

Comment:
${e.body.slice(0, 500)}`,
    )
    .join("\n\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Classify these ${entries.length} code review comments. Return a JSON array of ${entries.length} objects, one per comment in order.\n\n${userContent}`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  // Parse the JSON array from the response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error("Failed to parse classification response:", text.slice(0, 200));
    return entries.map((e) => ({ ...e, category: "unknown", actionability: "medium", domain_specificity: "low" }));
  }

  const classifications: Array<{ category: string; actionability: string; domain_specificity: string }> = JSON.parse(jsonMatch[0]);

  return entries.map((e, i) => ({
    ...e,
    category: classifications[i]?.category ?? "unknown",
    actionability: classifications[i]?.actionability ?? "medium",
    domain_specificity: classifications[i]?.domain_specificity ?? "low",
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : Infinity;

  const content = await readFile(INPUT_FILE, "utf-8");
  let entries: GoldSetEntry[] = content.trim().split("\n").map((line) => JSON.parse(line));

  if (limit < entries.length) {
    entries = entries.slice(0, limit);
  }

  console.log(`Classifying ${entries.length} comments...`);

  if (dryRun) {
    console.log("Dry run - showing first 3 entries:");
    for (const e of entries.slice(0, 3)) {
      console.log(`  PR #${e.pr_number} [${e.file}] by ${e.author}: ${e.body.slice(0, 80)}`);
    }
    return;
  }

  const client = new Anthropic();
  const BATCH_SIZE = 10;
  const results: ClassifiedEntry[] = [];

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(entries.length / BATCH_SIZE)} (${batch.length} comments)...`);

    const classified = await classifyBatch(client, batch);
    results.push(...classified);

    // Rate limit courtesy
    if (i + BATCH_SIZE < entries.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  await writeFile(OUTPUT_FILE, results.map((e) => JSON.stringify(e)).join("\n") + "\n");
  console.log(`Wrote ${results.length} classified comments to ${OUTPUT_FILE}`);

  // Print category distribution
  const counts = new Map<string, number>();
  for (const e of results) {
    counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  }
  console.log("\nCategory distribution:");
  for (const [cat, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }
}

main().catch(console.error);
