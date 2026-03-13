/**
 * Build reviewer profiles from the gold set.
 * Analyzes comment patterns per reviewer: file types, subsystems, comment lengths.
 * Reads output/gold_set.jsonl, writes output/reviewer_profiles.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";

const OUTPUT_DIR = join(import.meta.dir, "../output");
const INPUT_FILE = join(OUTPUT_DIR, "gold_set.jsonl");
const OUTPUT_FILE = join(OUTPUT_DIR, "reviewer_profiles.json");

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

interface ReviewerProfile {
  total_comments: number;
  subsystems: Record<string, number>;
  file_types: Record<string, number>;
  avg_comment_length: number;
  prs_reviewed: number;
  sample_comments: string[];
}

function inferSubsystem(labels: string[], filePath: string): string {
  // Try labels first
  const subsystemLabels = ["router", "controlplane", "studio", "cli", "monorepo", "composition"];
  for (const label of labels) {
    if (subsystemLabels.includes(label)) return label;
  }

  // Fall back to file path
  if (filePath.startsWith("router/")) return "router";
  if (filePath.startsWith("controlplane/")) return "controlplane";
  if (filePath.startsWith("studio/")) return "studio";
  if (filePath.startsWith("cli/")) return "cli";
  if (filePath.startsWith("composition/")) return "composition";
  if (filePath.startsWith("connect/")) return "connect";

  return "other";
}

async function main() {
  const content = await readFile(INPUT_FILE, "utf-8");
  const entries: GoldSetEntry[] = content.trim().split("\n").map((line) => JSON.parse(line));

  const profiles = new Map<string, {
    comments: GoldSetEntry[];
    prs: Set<number>;
  }>();

  for (const entry of entries) {
    let profile = profiles.get(entry.author);
    if (!profile) {
      profile = { comments: [], prs: new Set() };
      profiles.set(entry.author, profile);
    }
    profile.comments.push(entry);
    profile.prs.add(entry.pr_number);
  }

  const result: Record<string, ReviewerProfile> = {};

  for (const [author, data] of profiles) {
    const subsystems: Record<string, number> = {};
    const fileTypes: Record<string, number> = {};
    let totalLength = 0;

    for (const c of data.comments) {
      const subsystem = inferSubsystem(c.pr_labels, c.file);
      subsystems[subsystem] = (subsystems[subsystem] ?? 0) + 1;

      const ext = extname(c.file) || "unknown";
      fileTypes[ext] = (fileTypes[ext] ?? 0) + 1;

      totalLength += c.body.length;
    }

    // Pick top 3 most representative comments (longest, likely most substantive)
    const sortedByLength = [...data.comments].sort((a, b) => b.body.length - a.body.length);
    const sampleComments = sortedByLength.slice(0, 3).map((c) =>
      `[PR #${c.pr_number} ${c.file}] ${c.body.slice(0, 200)}`
    );

    result[author] = {
      total_comments: data.comments.length,
      subsystems,
      file_types: fileTypes,
      avg_comment_length: Math.round(totalLength / data.comments.length),
      prs_reviewed: data.prs.size,
      sample_comments: sampleComments,
    };
  }

  await writeFile(OUTPUT_FILE, JSON.stringify(result, null, 2) + "\n");
  console.log(`Wrote profiles for ${Object.keys(result).length} reviewers to ${OUTPUT_FILE}`);

  // Summary
  const sorted = Object.entries(result).sort((a, b) => b[1].total_comments - a[1].total_comments);
  for (const [author, profile] of sorted) {
    const topSubsystems = Object.entries(profile.subsystems)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([s, n]) => `${s}(${n})`)
      .join(", ");
    console.log(`  ${author}: ${profile.total_comments} comments, ${profile.prs_reviewed} PRs | ${topSubsystems}`);
  }
}

main().catch(console.error);
