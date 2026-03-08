/**
 * Build review guidelines from gold set comments.
 * Uses Claude CLI to synthesize recurring patterns into actionable rules,
 * producing both global guidelines and per-subsystem path instructions.
 *
 * Reads output/gold_set.jsonl
 * Writes output/guidelines.md and output/path_instructions.json
 *
 * Usage: bun run scripts/build-guidelines.ts [--dry-run]
 */
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";

const OUTPUT_DIR = join(import.meta.dir, "../output");
const INPUT_FILE = join(OUTPUT_DIR, "gold_set.jsonl");
const GUIDELINES_FILE = join(OUTPUT_DIR, "guidelines.md");
const PATH_INSTRUCTIONS_FILE = join(OUTPUT_DIR, "path_instructions.json");

interface GoldSetEntry {
  pr_number: number;
  pr_title: string;
  pr_labels: string[];
  pr_author: string;
  file: string;
  author: string;
  diff_hunk: string;
  body: string;
}

function inferSubsystem(labels: string[], filePath: string): string {
  const subsystemLabels = ["router", "controlplane", "studio", "cli", "composition", "connect"];
  for (const label of labels) {
    if (subsystemLabels.includes(label)) return label;
  }
  if (filePath.startsWith("router/")) return "router";
  if (filePath.startsWith("controlplane/")) return "controlplane";
  if (filePath.startsWith("studio/")) return "studio";
  if (filePath.startsWith("cli/")) return "cli";
  if (filePath.startsWith("composition/")) return "composition";
  if (filePath.startsWith("connect/")) return "connect";
  return "other";
}

async function claudeCli(prompt: string): Promise<string> {
  const tmpFile = join(OUTPUT_DIR, `_tmp_${Date.now()}.txt`);
  await writeFile(tmpFile, prompt);
  try {
    const result = await $`CLAUDECODE= claude -p --model claude-sonnet-4-20250514 < ${tmpFile}`.text();
    return result.trim();
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

const GLOBAL_SYSTEM = `Your task: read the code review comments below and output a markdown guidelines document. Output ONLY the markdown document, nothing else — no preamble, no commentary, no meta-analysis.

The project is wundergraph/cosmo, a GraphQL federation router platform (Go + TypeScript).

Document format:
- Start with a one-paragraph intro: "These guidelines are derived from [N] code review comments by the cosmo team..."
- Then category sections with ## headers, ordered by importance
- Each guideline is a bullet: concrete, actionable, 1-2 sentences
- Cite PR numbers, e.g. (#2334)
- Deduplicate: merge comments that say the same thing
- Focus on domain-specific patterns, not generic advice
- Skip cosmetic/nit comments
- Maximum 40 guidelines total`;

const PATH_SYSTEM = `You are writing subsystem-specific code review instructions for wundergraph/cosmo.

You will receive code review comments for a specific subsystem. Distill them into 5-10 focused review rules specific to that subsystem.

Output ONLY a bullet list of rules (no headers, no intro). Each rule should be:
- Concrete and actionable (not vague)
- Specific to this subsystem's patterns
- 1 sentence each
- Cite PR numbers where helpful, e.g. (#2334)

Do not repeat generic advice like "write tests" or "handle errors" unless there's a specific pattern unique to this subsystem.`;

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  const content = await readFile(INPUT_FILE, "utf-8");
  const entries: GoldSetEntry[] = content.trim().split("\n").map((line) => JSON.parse(line));

  // Group by subsystem
  const bySubsystem = new Map<string, GoldSetEntry[]>();
  for (const entry of entries) {
    const subsystem = inferSubsystem(entry.pr_labels, entry.file);
    const existing = bySubsystem.get(subsystem) ?? [];
    existing.push(entry);
    bySubsystem.set(subsystem, existing);
  }

  console.log(`${entries.length} gold set comments across ${bySubsystem.size} subsystems:`);
  for (const [sub, items] of [...bySubsystem.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${sub}: ${items.length}`);
  }

  if (dryRun) return;

  // Step 1: Generate global guidelines from ALL comments
  console.log("\nGenerating global guidelines...");
  const allCommentsSummary = entries
    .map((c) => `- PR #${c.pr_number} [${c.file}] (${c.author}): ${c.body.slice(0, 250)}`)
    .join("\n");

  const globalPrompt = `${GLOBAL_SYSTEM}\n\n---\n\nHere are ${entries.length} code review comments from wundergraph/cosmo human reviewers. Synthesize into guidelines.\n\n${allCommentsSummary}`;
  const guidelines = await claudeCli(globalPrompt);
  await writeFile(GUIDELINES_FILE, guidelines + "\n");
  console.log(`Wrote global guidelines to ${GUIDELINES_FILE}`);

  // Step 2: Generate per-subsystem path instructions
  const pathInstructions: Record<string, { path: string; instructions: string }> = {};
  const MIN_COMMENTS = 10;

  const subsystemPaths: Record<string, string> = {
    router: "router/**",
    controlplane: "controlplane/**",
    studio: "studio/**",
    cli: "cli/**",
    composition: "composition/**",
    connect: "connect/**",
  };

  for (const [subsystem, comments] of bySubsystem) {
    if (comments.length < MIN_COMMENTS || !subsystemPaths[subsystem]) continue;

    console.log(`Generating path instructions for ${subsystem} (${comments.length} comments)...`);

    const commentsSummary = comments
      .map((c) => `- PR #${c.pr_number} [${c.file}] (${c.author}): ${c.body.slice(0, 250)}`)
      .join("\n");

    const prompt = `${PATH_SYSTEM}\n\n---\n\nSubsystem: ${subsystem}\nComments:\n${commentsSummary}`;
    const instructions = await claudeCli(prompt);
    pathInstructions[subsystem] = {
      path: subsystemPaths[subsystem],
      instructions,
    };
  }

  await writeFile(PATH_INSTRUCTIONS_FILE, JSON.stringify(pathInstructions, null, 2) + "\n");
  console.log(`Wrote path instructions for ${Object.keys(pathInstructions).length} subsystems to ${PATH_INSTRUCTIONS_FILE}`);

}

main().catch(console.error);
