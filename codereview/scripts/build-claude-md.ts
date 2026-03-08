/**
 * Generate component-level CLAUDE.md files from standards/ source of truth.
 *
 * Reads standards/*.md and writes CLAUDE.md into each component directory.
 * The global standards are prepended to each component file.
 *
 * Usage: bun run scripts/build-claude-md.ts [--dry-run]
 */
import { readFile, writeFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");
const STANDARDS_DIR = join(REPO_ROOT, "standards");

function parseFrontmatter(raw: string): { path: string; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { path: "**", body: raw };

  const frontmatter = match[1];
  const body = match[2].trim();
  const pathMatch = frontmatter.match(/path:\s*"?([^"\n]+)"?/);
  return { path: pathMatch?.[1] ?? "**", body };
}

// Map subsystem name to the directory where CLAUDE.md should be written
const SUBSYSTEM_DIRS: Record<string, string> = {
  router: "router",
  controlplane: "controlplane",
  studio: "studio",
  cli: "cli",
  connect: "connect",
  composition: "composition",
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const files = await readdir(STANDARDS_DIR);
  let globalBody = "";

  // Load global standards first
  for (const file of files) {
    if (file !== "_global.md") continue;
    const raw = await readFile(join(STANDARDS_DIR, file), "utf-8");
    const { body } = parseFrontmatter(raw);
    globalBody = body;
  }

  let written = 0;

  for (const file of files.sort()) {
    if (!file.endsWith(".md") || file === "_global.md") continue;

    const subsystem = file.replace(".md", "");
    const dir = SUBSYSTEM_DIRS[subsystem];
    if (!dir) {
      console.log(`Skipping ${file} (no directory mapping)`);
      continue;
    }

    const targetDir = join(REPO_ROOT, dir);
    try {
      await access(targetDir);
    } catch {
      console.log(`Skipping ${subsystem} (directory ${dir}/ does not exist)`);
      continue;
    }

    const raw = await readFile(join(STANDARDS_DIR, file), "utf-8");
    const { body } = parseFrontmatter(raw);

    const content = [
      `<!-- Generated from standards/${file} - do not edit directly -->`,
      `<!-- Edit standards/${file} then run: bun run build:claude-md -->`,
      "",
      body,
      "",
      "---",
      "",
      globalBody,
      "",
    ].join("\n");

    const targetPath = join(targetDir, "CLAUDE.md");

    if (dryRun) {
      console.log(`Would write ${targetPath} (${content.length} bytes)`);
    } else {
      await writeFile(targetPath, content);
      console.log(`Wrote ${targetPath}`);
      written++;
    }
  }

  console.log(`\n${dryRun ? "Would write" : "Wrote"} ${written} CLAUDE.md files from standards/`);
}

main().catch(console.error);
