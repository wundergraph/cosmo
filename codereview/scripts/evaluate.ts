/**
 * Evaluation harness for code review instructions.
 *
 * Measures whether a set of review instructions improves an LLM's ability
 * to catch real issues (recall) and avoid false positives (precision).
 *
 * Test sets:
 * - Positives: sampled from gold_set.jsonl (human review comments)
 * - Negatives: rejected bot comments from anti_patterns.json
 *
 * Uses claude CLI for LLM calls (no API key needed).
 *
 * Usage:
 *   bun run evaluate                    # evaluate current .coderabbit.yaml instructions
 *   bun run evaluate -- --baseline      # evaluate without instructions (baseline)
 *   bun run evaluate -- --sample 100    # control sample size (default 200)
 *   bun run evaluate -- --no-cache      # ignore cached results
 */
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { $ } from "bun";

const OUTPUT_DIR = join(import.meta.dir, "../output");
const GOLD_SET_FILE = join(OUTPUT_DIR, "gold_set.jsonl");
const ANTI_PATTERNS_FILE = join(OUTPUT_DIR, "anti_patterns.json");
const CACHE_FILE = join(OUTPUT_DIR, "eval_cache.json");
const SUMMARY_FILE = join(OUTPUT_DIR, "eval_summary.md");
const CODERABBIT_FILE = join(import.meta.dir, "../../../.coderabbit.yaml");

const MODEL = "claude-sonnet-4-20250514";

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
}

interface ClassifiedThread {
  pr_number: number;
  file: string;
  line: number | null;
  bot_comment: string;
  human_replies: { user: string; body: string }[];
  outcome: string;
  reason: string;
}

interface EvalResult {
  test_id: string;
  test_type: "positive" | "negative";
  subsystem: string;
  instructions_hash: string;
  verdict: "yes" | "no";
  raw_response: string;
}

type EvalCache = Record<string, EvalResult>;

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function inferSubsystem(file: string): string {
  if (file.startsWith("router/")) return "router";
  if (file.startsWith("controlplane/")) return "controlplane";
  if (file.startsWith("studio/")) return "studio";
  if (file.startsWith("cli/")) return "cli";
  if (file.startsWith("connect/")) return "connect";
  if (file.startsWith("composition/")) return "composition";
  return "other";
}

function extractInstructions(yaml: string): string {
  const match = yaml.match(/instructions:\s*\|\n([\s\S]*?)(?=\n\s*path_instructions:|\n\s*path_filters:)/);
  if (!match) return "";
  return match[1].replace(/^    /gm, "").trim();
}

async function claudeCli(prompt: string): Promise<string> {
  const tmpFile = join(OUTPUT_DIR, `_eval_tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.txt`);
  await writeFile(tmpFile, prompt);
  try {
    const result = await $`CLAUDECODE= claude -p --model ${MODEL} --max-tokens 50 < ${tmpFile}`.text();
    return result.trim();
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

function sampleArray<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

function stratifiedSample(entries: GoldSetEntry[], n: number): GoldSetEntry[] {
  const bySubsystem = new Map<string, GoldSetEntry[]>();
  for (const e of entries) {
    const sub = inferSubsystem(e.file);
    const list = bySubsystem.get(sub) ?? [];
    list.push(e);
    bySubsystem.set(sub, list);
  }

  const result: GoldSetEntry[] = [];
  const subsystems = [...bySubsystem.keys()];
  const perSubsystem = Math.max(1, Math.floor(n / subsystems.length));

  for (const sub of subsystems) {
    const items = bySubsystem.get(sub)!;
    result.push(...sampleArray(items, perSubsystem));
  }

  if (result.length < n) {
    const ids = new Set(result.map((e) => `${e.pr_number}:${e.file}:${e.line}`));
    const remaining = entries.filter((e) => !ids.has(`${e.pr_number}:${e.file}:${e.line}`));
    result.push(...sampleArray(remaining, n - result.length));
  }

  return result.slice(0, n);
}

async function evaluatePositive(
  entry: GoldSetEntry,
  instructions: string,
  instructionsHash: string,
  cache: EvalCache,
): Promise<EvalResult> {
  const testId = `pos:${entry.pr_number}:${entry.file}:${entry.line}`;
  const cacheKey = `${testId}:${instructionsHash}`;

  if (cache[cacheKey]) return cache[cacheKey];

  const context = instructions
    ? `You are a code reviewer for wundergraph/cosmo. Here are your review instructions:\n\n${instructions}\n\n---\n\n`
    : "You are a code reviewer for wundergraph/cosmo.\n\n";

  const prompt = `${context}File: ${entry.file}
Diff:
${entry.diff_hunk.slice(0, 1500)}

A human reviewer flagged this concern: "${entry.body.slice(0, 300)}"

Looking at this diff, would you independently flag a similar concern? Answer YES or NO only.`;

  const text = await claudeCli(prompt);
  const verdict = text.toUpperCase().startsWith("YES") ? "yes" : "no";

  const result: EvalResult = {
    test_id: testId,
    test_type: "positive",
    subsystem: inferSubsystem(entry.file),
    instructions_hash: instructionsHash,
    verdict,
    raw_response: text,
  };

  cache[cacheKey] = result;
  return result;
}

async function evaluateNegative(
  thread: ClassifiedThread,
  instructions: string,
  instructionsHash: string,
  cache: EvalCache,
): Promise<EvalResult> {
  const testId = `neg:${thread.pr_number}:${thread.file}:${thread.line}`;
  const cacheKey = `${testId}:${instructionsHash}`;

  if (cache[cacheKey]) return cache[cacheKey];

  const context = instructions
    ? `You are a code reviewer for wundergraph/cosmo. Here are your review instructions:\n\n${instructions}\n\n---\n\n`
    : "You are a code reviewer for wundergraph/cosmo.\n\n";

  const concern = thread.bot_comment
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .split("\n")
    .filter((l) => l.trim().length > 10)
    .slice(0, 3)
    .join(" ")
    .slice(0, 400);

  const rejection = thread.human_replies[0]?.body.slice(0, 200) ?? "";

  const prompt = `${context}File: ${thread.file}

A bot reviewer flagged this concern: "${concern}"

A human reviewer rejected this with: "${rejection}"

Given only the file path and the concern described above, would you flag this same concern? Answer YES or NO only.`;

  const text = await claudeCli(prompt);
  const verdict = text.toUpperCase().startsWith("YES") ? "yes" : "no";

  const result: EvalResult = {
    test_id: testId,
    test_type: "negative",
    subsystem: inferSubsystem(thread.file),
    instructions_hash: instructionsHash,
    verdict,
    raw_response: text,
  };

  cache[cacheKey] = result;
  return result;
}

interface SubsystemStats {
  positive_total: number;
  positive_hits: number;
  negative_total: number;
  negative_false_positives: number;
}

function computeStats(results: EvalResult[]): {
  overall: SubsystemStats;
  bySubsystem: Map<string, SubsystemStats>;
} {
  const bySubsystem = new Map<string, SubsystemStats>();

  const getOrCreate = (sub: string): SubsystemStats => {
    if (!bySubsystem.has(sub)) {
      bySubsystem.set(sub, { positive_total: 0, positive_hits: 0, negative_total: 0, negative_false_positives: 0 });
    }
    return bySubsystem.get(sub)!;
  };

  for (const r of results) {
    const stats = getOrCreate(r.subsystem);
    if (r.test_type === "positive") {
      stats.positive_total++;
      if (r.verdict === "yes") stats.positive_hits++;
    } else {
      stats.negative_total++;
      if (r.verdict === "yes") stats.negative_false_positives++;
    }
  }

  const overall: SubsystemStats = { positive_total: 0, positive_hits: 0, negative_total: 0, negative_false_positives: 0 };
  for (const stats of bySubsystem.values()) {
    overall.positive_total += stats.positive_total;
    overall.positive_hits += stats.positive_hits;
    overall.negative_total += stats.negative_total;
    overall.negative_false_positives += stats.negative_false_positives;
  }

  return { overall, bySubsystem };
}

function formatPercent(n: number, d: number): string {
  if (d === 0) return "N/A";
  return ((n / d) * 100).toFixed(1) + "%";
}

async function main() {
  const args = process.argv.slice(2);
  const isBaseline = args.includes("--baseline");
  const noCache = args.includes("--no-cache");
  const sampleIdx = args.indexOf("--sample");
  const sampleSize = sampleIdx !== -1 ? parseInt(args[sampleIdx + 1], 10) : 200;

  if (isNaN(sampleSize) || sampleSize < 1) {
    console.error("Invalid --sample value");
    process.exit(1);
  }

  // Load test data
  const goldSetContent = await readFile(GOLD_SET_FILE, "utf-8");
  const allGoldSet: GoldSetEntry[] = goldSetContent.trim().split("\n").map((l) => JSON.parse(l));

  const antiPatternsContent = await readFile(ANTI_PATTERNS_FILE, "utf-8");
  const allAntiPatterns: ClassifiedThread[] = JSON.parse(antiPatternsContent);
  const negatives = allAntiPatterns.filter((t) => t.outcome === "rejected");

  // Load instructions
  let instructions = "";
  if (!isBaseline) {
    const yaml = await readFile(CODERABBIT_FILE, "utf-8");
    instructions = extractInstructions(yaml);
  }
  const instructionsHash = hash(instructions || "baseline");

  console.log(`Mode: ${isBaseline ? "BASELINE (no instructions)" : "GUIDED (with instructions)"}`);
  console.log(`Instructions hash: ${instructionsHash}`);
  console.log(`Sample size: ${sampleSize} positives, ${negatives.length} negatives`);

  // Load cache
  let cache: EvalCache = {};
  if (!noCache) {
    try {
      cache = JSON.parse(await readFile(CACHE_FILE, "utf-8"));
    } catch {
      // No cache yet
    }
  }

  // Sample positives
  const positives = stratifiedSample(allGoldSet, sampleSize);

  // Run evaluations sequentially (claude CLI is one-at-a-time)
  console.log(`\nEvaluating ${positives.length} positive test cases...`);
  const positiveResults: EvalResult[] = [];
  for (let i = 0; i < positives.length; i++) {
    const result = await evaluatePositive(positives[i], instructions, instructionsHash, cache);
    positiveResults.push(result);
    process.stdout.write(`\r  ${i + 1}/${positives.length}`);
  }
  process.stdout.write("\n");

  console.log(`Evaluating ${negatives.length} negative test cases...`);
  const negativeResults: EvalResult[] = [];
  for (let i = 0; i < negatives.length; i++) {
    const result = await evaluateNegative(negatives[i], instructions, instructionsHash, cache);
    negativeResults.push(result);
    process.stdout.write(`\r  ${i + 1}/${negatives.length}`);
  }
  process.stdout.write("\n");

  // Save cache
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2) + "\n");

  // Compute stats
  const allResults = [...positiveResults, ...negativeResults];
  const { overall, bySubsystem } = computeStats(allResults);

  // Print results
  const mode = isBaseline ? "Baseline" : "Guided";
  console.log(`\n=== ${mode} Results ===`);
  console.log(`Recall: ${formatPercent(overall.positive_hits, overall.positive_total)} (${overall.positive_hits}/${overall.positive_total})`);
  console.log(`False positive rate: ${formatPercent(overall.negative_false_positives, overall.negative_total)} (${overall.negative_false_positives}/${overall.negative_total})`);

  console.log("\nBy subsystem:");
  for (const [sub, stats] of [...bySubsystem.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const recall = formatPercent(stats.positive_hits, stats.positive_total);
    const fp = stats.negative_total > 0 ? formatPercent(stats.negative_false_positives, stats.negative_total) : "-";
    console.log(`  ${sub.padEnd(15)} recall=${recall.padEnd(7)} fp_rate=${fp} (${stats.positive_total} pos, ${stats.negative_total} neg)`);
  }

  // Write summary
  const summary = [
    `# Evaluation Summary: ${mode}`,
    "",
    `**Date**: ${new Date().toISOString().slice(0, 10)}`,
    `**Instructions hash**: \`${instructionsHash}\``,
    `**Sample**: ${positives.length} positives, ${negatives.length} negatives`,
    "",
    "## Overall",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Recall | ${formatPercent(overall.positive_hits, overall.positive_total)} (${overall.positive_hits}/${overall.positive_total}) |`,
    `| False positive rate | ${formatPercent(overall.negative_false_positives, overall.negative_total)} (${overall.negative_false_positives}/${overall.negative_total}) |`,
    "",
    "## By Subsystem",
    "",
    "| Subsystem | Recall | FP Rate | Positives | Negatives |",
    "|-----------|--------|---------|-----------|-----------|",
  ];

  for (const [sub, stats] of [...bySubsystem.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const recall = formatPercent(stats.positive_hits, stats.positive_total);
    const fp = stats.negative_total > 0 ? formatPercent(stats.negative_false_positives, stats.negative_total) : "-";
    summary.push(`| ${sub} | ${recall} | ${fp} | ${stats.positive_total} | ${stats.negative_total} |`);
  }

  summary.push("");
  summary.push("## How to Compare");
  summary.push("");
  summary.push("Run both modes and compare:");
  summary.push("```");
  summary.push("bun run evaluate -- --baseline    # no instructions");
  summary.push("bun run evaluate                  # with instructions");
  summary.push("```");
  summary.push("");
  summary.push("Instructions add value if: recall increases AND false positive rate doesn't increase.");
  summary.push("");

  await writeFile(SUMMARY_FILE, summary.join("\n") + "\n");
  console.log(`\nSummary written to ${SUMMARY_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
