/**
 * Synthesize review guidelines from gold set comments using Claude CLI.
 * Writes directly to standards/*.md (the source of truth).
 *
 * Reads output/gold_set.jsonl
 * Writes standards/_global.md and standards/{subsystem}.md
 *
 * Usage: bun run scripts/build-guidelines.ts [--dry-run]
 */
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";

const OUTPUT_DIR = join(import.meta.dir, "../output");
const INPUT_FILE = join(OUTPUT_DIR, "gold_set.jsonl");
const STANDARDS_DIR = join(import.meta.dir, "../../standards");

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

const GLOBAL_SYSTEM = `Your task: read the code review comments below and output review guidelines as a markdown bullet list. Output ONLY the bullet list — no preamble, no headers, no commentary.

The project is wundergraph/cosmo, a GraphQL federation router platform (Go + TypeScript).

Rules:
- Each guideline is a bullet starting with "- "
- Concrete, actionable, 1-2 sentences each
- Cite PR numbers, e.g. (#2334)
- Deduplicate: merge comments that say the same thing
- Focus on domain-specific patterns, not generic advice
- Skip cosmetic/nit comments
- Group related guidelines under ## headers (Error Handling, GraphQL Federation, Go Code Quality, Testing, Configuration, PubSub, Authentication, Database, Proto, Performance)
- Maximum 40 guidelines total`;

const PATH_SYSTEM = `You are writing subsystem-specific code review instructions for wundergraph/cosmo.

You will receive code review comments for a specific subsystem. Distill them into 5-15 focused review rules specific to that subsystem.

Output ONLY a bullet list of rules (no headers, no intro, no preamble). Each rule should be:
- A bullet starting with "- "
- Concrete and actionable (not vague)
- Specific to this subsystem's patterns
- 1 sentence each
- Cite PR numbers where helpful, e.g. (#2334)

Do not repeat generic advice like "write tests" or "handle errors" unless there's a specific pattern unique to this subsystem.`;

const SUBSYSTEM_PATHS: Record<string, string> = {
  router: "router/**",
  controlplane: "controlplane/**",
  studio: "studio/**",
  cli: "cli/**",
  composition: "composition/**",
  connect: "connect/**",
};

const SUBSYSTEM_TITLES: Record<string, string> = {
  router: "Router Standards",
  controlplane: "Controlplane Standards",
  studio: "Studio Standards",
  cli: "CLI Standards",
  composition: "Composition Standards",
  connect: "Connect Standards",
};

const MIN_COMMENTS = 10;

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

  const globalFile = join(STANDARDS_DIR, "_global.md");
  await writeFile(globalFile, `---\npath: "**"\n---\n\n# Global Standards\n\n${guidelines}\n`);
  console.log(`Wrote ${globalFile}`);

  // Step 2: Generate per-subsystem standards
  for (const [subsystem, comments] of bySubsystem) {
    if (comments.length < MIN_COMMENTS || !SUBSYSTEM_PATHS[subsystem]) continue;

    console.log(`Generating standards for ${subsystem} (${comments.length} comments)...`);

    const commentsSummary = comments
      .map((c) => `- PR #${c.pr_number} [${c.file}] (${c.author}): ${c.body.slice(0, 250)}`)
      .join("\n");

    const prompt = `${PATH_SYSTEM}\n\n---\n\nSubsystem: ${subsystem}\nComments:\n${commentsSummary}`;
    const instructions = await claudeCli(prompt);

    const title = SUBSYSTEM_TITLES[subsystem] ?? `${subsystem} Standards`;
    const path = SUBSYSTEM_PATHS[subsystem];
    const stdFile = join(STANDARDS_DIR, `${subsystem}.md`);
    await writeFile(stdFile, `---\npath: "${path}"\n---\n\n# ${title}\n\n${instructions}\n`);
    console.log(`Wrote ${stdFile}`);
  }

  console.log("\nDone. Run 'bun run build:coderabbit && bun run build:claude-md' to regenerate configs.");
}

main().catch(console.error);
