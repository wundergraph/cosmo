/**
 * Assemble the .coderabbit.yaml from standards/ files, anti-patterns, and CODEOWNERS.
 *
 * Reads standards/*.md (source of truth for review guidelines)
 * Reads .github/CODEOWNERS (for expert escalation)
 * Reads output/reviewer_profiles.json (for expert activity data)
 * Reads output/anti_patterns.json (for false positive suppression)
 * Writes ../../.coderabbit.yaml (repo root)
 *
 * Usage: bun run scripts/build-coderabbit.ts [--output PATH]
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");
const STANDARDS_DIR = join(REPO_ROOT, "standards");
const CODEOWNERS_FILE = join(REPO_ROOT, ".github/CODEOWNERS");
const OUTPUT_DIR = join(import.meta.dir, "../output");
const PROFILES_FILE = join(OUTPUT_DIR, "reviewer_profiles.json");
const ANTI_PATTERNS_JSON = join(OUTPUT_DIR, "anti_patterns.json");
const DEFAULT_OUTPUT = join(REPO_ROOT, ".coderabbit.yaml");

interface ReviewerProfile {
  total_comments: number;
  subsystems: Record<string, number>;
  file_types: Record<string, number>;
  avg_comment_length: number;
  prs_reviewed: number;
}

interface StandardsFile {
  path: string;
  content: string;
  subsystem: string;
}

interface ClassifiedThread {
  pr_number: number;
  file: string;
  bot_comment: string;
  human_replies: { user: string; body: string }[];
  outcome: string;
}

const EXPERT_THRESHOLD = 20;

/** Sanitize a string for safe embedding in a YAML double-quoted value. */
function sanitizeForYaml(s: string): string {
  return s
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/"/g, "'")
    .replace(/\\/g, "\\\\")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFrontmatter(raw: string): { path: string; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { path: "**", body: raw };

  const frontmatter = match[1];
  const body = match[2].trim();
  const pathMatch = frontmatter.match(/path:\s*"?([^"\n]+)"?/);
  return { path: pathMatch?.[1] ?? "**", body };
}

function parseCodeowners(content: string): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const path = parts[0].replace(/^\//, "").replace(/\/$/, "");
    const users = parts.slice(1).filter((p) => p.startsWith("@") && !p.includes("/")).map((p) => p.slice(1));
    if (users.length > 0) {
      owners.set(path, users);
    }
  }
  return owners;
}

function getExpertsForSubsystem(
  profiles: Record<string, ReviewerProfile>,
  codeowners: Map<string, string[]>,
  subsystem: string,
): { username: string; comments: number }[] {
  // Start with CODEOWNERS as the authoritative list
  const ownerUsers = new Set<string>();
  for (const [path, users] of codeowners) {
    if (path === subsystem || path.startsWith(subsystem + "/")) {
      for (const u of users) ownerUsers.add(u);
    }
  }

  // Filter to those with enough review activity
  const experts: { username: string; comments: number }[] = [];
  for (const username of ownerUsers) {
    const count = profiles[username]?.subsystems[subsystem] ?? 0;
    if (count >= EXPERT_THRESHOLD) {
      experts.push({ username, comments: count });
    }
  }

  return experts.sort((a, b) => b.comments - a.comments).slice(0, 3);
}

function extractInstructionLines(body: string): string[] {
  // Strip the markdown title (# ...) and return just the guideline lines
  return body
    .split("\n")
    .filter((l) => !l.startsWith("# "))
    .join("\n")
    .trim()
    .split("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const outputIdx = args.indexOf("--output");
  const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : DEFAULT_OUTPUT;

  // Load standards files
  const files = await readdir(STANDARDS_DIR);
  const standardsFiles: StandardsFile[] = [];
  let globalStandards: { path: string; body: string } | null = null;

  for (const file of files.sort()) {
    if (!file.endsWith(".md")) continue;
    const raw = await readFile(join(STANDARDS_DIR, file), "utf-8");
    const parsed = parseFrontmatter(raw);
    const subsystem = file.replace(".md", "").replace(/^_/, "");

    if (file === "_global.md") {
      globalStandards = parsed;
    } else {
      standardsFiles.push({ path: parsed.path, content: parsed.body, subsystem });
    }
  }

  if (!globalStandards) {
    console.error("Missing standards/_global.md");
    process.exit(1);
  }

  // Load CODEOWNERS
  let codeowners = new Map<string, string[]>();
  try {
    codeowners = parseCodeowners(await readFile(CODEOWNERS_FILE, "utf-8"));
  } catch {
    console.log("No CODEOWNERS found, skipping expert tagging");
  }

  // Load reviewer profiles
  let profiles: Record<string, ReviewerProfile> = {};
  try {
    profiles = JSON.parse(await readFile(PROFILES_FILE, "utf-8"));
  } catch {
    console.log("No reviewer profiles found, skipping expert tagging");
  }

  // Load anti-patterns
  let antiPatterns: ClassifiedThread[] = [];
  try {
    antiPatterns = JSON.parse(await readFile(ANTI_PATTERNS_JSON, "utf-8"));
  } catch {
    console.log("No anti-patterns found, skipping false positive guidance");
  }

  // Build YAML
  const lines: string[] = [];

  lines.push("# Generated from standards/ files by codereview pipeline");
  lines.push("# Edit standards/*.md, then run: bun run build:coderabbit");
  lines.push("");
  lines.push("language: en-US");
  lines.push("");
  lines.push("reviews:");
  lines.push("  collapse_walkthrough: true");
  lines.push("  poem: false");
  lines.push("  high_level_summary: true");
  lines.push("  auto_review:");
  lines.push("    enabled: true");
  lines.push("  path_filters:");
  lines.push('    - "!codereview/**"');
  lines.push('    - "!standards/**"');
  lines.push("");

  // Global instructions from standards/_global.md
  lines.push("  instructions: |");
  for (const line of extractInstructionLines(globalStandards.body)) {
    lines.push(line.trim() ? "    " + line : "");
  }

  // Add anti-pattern guidance (CodeRabbit-specific, not in standards files)
  const rejected = antiPatterns.filter((t) => t.outcome === "rejected");
  if (rejected.length > 0) {
    lines.push("");
    lines.push("    ## Known False Positive Patterns");
    lines.push("");
    lines.push("    The following patterns were previously flagged but explicitly rejected by human reviewers.");
    lines.push("    Do NOT flag these unless the context is clearly different from the original case.");
    lines.push("");
    for (const t of rejected) {
      const replySnippet = sanitizeForYaml(t.human_replies[0]?.body.slice(0, 150) ?? "");
      const botSnippet = sanitizeForYaml(
        t.bot_comment
          .replace(/^_[^_]+_\s*(\|\s*_[^_]+_\s*)?/gm, "")
          .replace(/<details>[\s\S]*?<\/details>/g, "")
          .replace(/<[^>]*>/g, "")
          .replace(/[<>]/g, "")
          .trim()
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 10 && !l.startsWith("🧩") && !l.startsWith("🌐") && !l.startsWith("🏁") && !l.startsWith("💡"))
          [0]
          ?.replace(/^\*\*/, "")
          .replace(/\*\*$/, "")
          .replace(/\*\*/g, "")
          .slice(0, 120) ?? "",
      );
      if (botSnippet) {
        lines.push(`    - "${botSnippet}" \u2014 rejected: "${replySnippet}" (#${t.pr_number})`);
      }
    }
  }

  lines.push("");

  // Path instructions from component standards files
  if (standardsFiles.length > 0) {
    lines.push("  path_instructions:");

    for (const { path, content, subsystem } of standardsFiles) {
      lines.push(`    - path: "${path}"`);
      lines.push("      instructions: |");

      for (const line of extractInstructionLines(content)) {
        lines.push(line.trim() ? "        " + line : "");
      }

      // Expert escalation from CODEOWNERS + activity data
      const experts = getExpertsForSubsystem(profiles, codeowners, subsystem);
      if (experts.length > 0) {
        lines.push("");
        lines.push("        ## Expert Escalation");
        lines.push("        When you detect a complex or architecturally significant change in this subsystem,");
        lines.push("        add a comment tagging the relevant domain expert(s) for human review.");
        lines.push("        Triggers for escalation:");
        lines.push("        - Changes to core abstractions, interfaces, or module boundaries");
        lines.push("        - Performance-sensitive code paths (hot loops, allocations, concurrency)");
        lines.push("        - Breaking changes to public APIs or configuration schema");
        lines.push("        - Security-relevant changes (auth, validation, input handling)");
        lines.push(`        Domain experts for ${subsystem}:`);
        for (const expert of experts) {
          lines.push(`        - @${expert.username}`);
        }
        lines.push('        Format: "**Expert review recommended**: @username - [brief reason]"');
      }

      lines.push("");
    }
  }

  const yaml = lines.join("\n").trimEnd() + "\n";

  // Validate YAML syntax before writing
  const proc = Bun.spawnSync(["python3", "-c", "import yaml, sys; yaml.safe_load(sys.stdin)"], {
    stdin: Buffer.from(yaml),
  });
  if (proc.exitCode !== 0) {
    console.error("Generated YAML is invalid:");
    console.error(proc.stderr.toString());
    process.exit(1);
  }

  await writeFile(outputPath, yaml);
  console.log(`Wrote .coderabbit.yaml to ${outputPath}`);
  console.log(`  Source: standards/ (${standardsFiles.length + 1} files)`);
  console.log(`  Path instructions: ${standardsFiles.length} subsystems`);
  console.log(`  False positives: ${rejected.length} entries`);

  for (const { subsystem } of standardsFiles) {
    const experts = getExpertsForSubsystem(profiles, codeowners, subsystem);
    if (experts.length > 0) {
      console.log(`  ${subsystem} experts: ${experts.map((e) => e.username).join(", ")}`);
    }
  }
}

main().catch(console.error);
