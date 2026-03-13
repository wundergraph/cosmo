/**
 * Detect CodeRabbit false positives by analyzing threaded review conversations.
 *
 * Fetches review comment threads from GitHub API for PRs that had CodeRabbit comments.
 * Groups by thread (using in_reply_to_id), then classifies human responses to
 * CodeRabbit suggestions as accepted, rejected, or ignored.
 *
 * Reads output/comments.jsonl (to find PRs with bot comments)
 * Writes output/threads.jsonl (raw thread data, cached)
 * Writes output/anti_patterns.json (classified false positives)
 * Writes output/anti_patterns.md (human-readable summary)
 *
 * Usage: bun run scripts/build-antipatterns.ts [--fetch-only] [--classify-only] [--dry-run]
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import type { PRRecord } from "./types";

const OUTPUT_DIR = join(import.meta.dir, "../output");
const COMMENTS_FILE = join(OUTPUT_DIR, "comments.jsonl");
const THREADS_FILE = join(OUTPUT_DIR, "threads.jsonl");
const ANTI_PATTERNS_JSON = join(OUTPUT_DIR, "anti_patterns.json");
const ANTI_PATTERNS_MD = join(OUTPUT_DIR, "anti_patterns.md");

interface GitHubComment {
  id: number;
  in_reply_to_id: number | null;
  user: string;
  is_bot: boolean;
  path: string;
  line: number | null;
  body: string;
  created_at: string;
}

interface Thread {
  pr_number: number;
  root: GitHubComment;
  replies: GitHubComment[];
}

interface ThreadRecord {
  pr_number: number;
  threads: Thread[];
}

type Outcome = "accepted" | "rejected" | "ignored" | "unclear";

interface ClassifiedThread {
  pr_number: number;
  file: string;
  line: number | null;
  bot_comment: string;
  human_replies: { user: string; body: string }[];
  outcome: Outcome;
  reason: string;
}

const BOT_LOGINS = new Set([
  "coderabbitai[bot]",
  "github-actions[bot]",
  "dependabot[bot]",
  "renovate[bot]",
  "codecov[bot]",
]);

function isBot(login: string): boolean {
  return BOT_LOGINS.has(login) || login.endsWith("[bot]");
}

async function fetchThreadsForPR(prNumber: number): Promise<Thread[]> {
  const jqExpr = `[.[] | {id, in_reply_to_id, user: .user.login, path, line, body, created_at}]`;

  let raw: string;
  try {
    raw = await $`gh api "repos/wundergraph/cosmo/pulls/${prNumber}/comments" --paginate --jq ${jqExpr}`.text();
  } catch {
    console.error(`  Failed to fetch PR #${prNumber}, skipping`);
    return [];
  }

  // gh --paginate may output multiple JSON arrays, merge them
  const comments: GitHubComment[] = [];
  for (const chunk of raw.trim().split("\n[")) {
    const json = chunk.startsWith("[") ? chunk : "[" + chunk;
    try {
      const parsed = JSON.parse(json);
      for (const c of parsed) {
        comments.push({
          ...c,
          is_bot: isBot(c.user),
        });
      }
    } catch {
      // skip malformed chunks
    }
  }

  // Group into threads
  const byId = new Map<number, GitHubComment>();
  for (const c of comments) {
    byId.set(c.id, c);
  }

  const threads: Thread[] = [];
  const roots = comments.filter((c) => c.in_reply_to_id === null && c.is_bot);

  for (const root of roots) {
    const replies = comments.filter((c) => c.in_reply_to_id === root.id);
    threads.push({ pr_number: prNumber, root, replies });
  }

  return threads;
}

function classifyThread(thread: Thread): ClassifiedThread {
  const humanReplies = thread.replies.filter((r) => !r.is_bot);
  const file = thread.root.path;
  const line = thread.root.line;
  const botBody = thread.root.body.slice(0, 500);

  if (humanReplies.length === 0) {
    return {
      pr_number: thread.pr_number,
      file,
      line,
      bot_comment: botBody,
      human_replies: [],
      outcome: "ignored",
      reason: "No human reply",
    };
  }

  // Heuristic classification based on human reply content
  const allReplies = humanReplies.map((r) => r.body.toLowerCase()).join(" ");

  const acceptedPatterns = [
    /addressed/i,
    /fixed/i,
    /done/i,
    /good catch/i,
    /you're right/i,
    /you are right/i,
    /updated/i,
    /applied/i,
    /thanks.*fix/i,
    /commit [0-9a-f]{7,}/i,
  ];

  const rejectedPatterns = [
    /intentional/i,
    /by design/i,
    /not applicable/i,
    /disagree/i,
    /incorrect/i,
    /wrong/i,
    /false positive/i,
    /that's not/i,
    /that is not/i,
    /this is expected/i,
    /we want/i,
    /we need/i,
    /not a(?:n)? (?:issue|problem|bug)/i,
    /doesn't apply/i,
    /won't change/i,
    /no.{0,10}this is/i,
    /actually/i,
    /on purpose/i,
  ];

  const isAccepted = acceptedPatterns.some((p) => p.test(allReplies));
  const isRejected = rejectedPatterns.some((p) => p.test(allReplies));

  let outcome: Outcome;
  let reason: string;

  if (isRejected && !isAccepted) {
    outcome = "rejected";
    reason = "Human explicitly disagreed";
  } else if (isAccepted && !isRejected) {
    outcome = "accepted";
    reason = "Human acknowledged and fixed";
  } else if (isAccepted && isRejected) {
    outcome = "unclear";
    reason = "Mixed signals in replies";
  } else {
    outcome = "unclear";
    reason = "Reply doesn't clearly accept or reject";
  }

  return {
    pr_number: thread.pr_number,
    file,
    line,
    bot_comment: botBody,
    human_replies: humanReplies.map((r) => ({ user: r.user, body: r.body.slice(0, 300) })),
    outcome,
    reason,
  };
}

function inferSubsystem(filePath: string): string {
  if (filePath.startsWith("router/")) return "router";
  if (filePath.startsWith("controlplane/")) return "controlplane";
  if (filePath.startsWith("studio/")) return "studio";
  if (filePath.startsWith("cli/")) return "cli";
  if (filePath.startsWith("connect/")) return "connect";
  if (filePath.startsWith("composition/")) return "composition";
  return "other";
}

function extractBotCategory(body: string): string {
  // CodeRabbit uses prefixes like "_⚠️ Potential issue_", "_🛠️ Refactor suggestion_"
  const categoryMatch = body.match(/^_([^_]+)_\s*\|\s*_([^_]+)_/);
  if (categoryMatch) return categoryMatch[1].replace(/⚠️|🛠️|💡/g, "").trim();

  if (body.includes("Potential issue")) return "Potential issue";
  if (body.includes("Refactor suggestion")) return "Refactor suggestion";
  if (body.includes("Nitpick")) return "Nitpick";
  return "unknown";
}

async function main() {
  const args = process.argv.slice(2);
  const fetchOnly = args.includes("--fetch-only");
  const classifyOnly = args.includes("--classify-only");
  const dryRun = args.includes("--dry-run");

  // Step 1: Identify PRs with bot comments
  const content = await readFile(COMMENTS_FILE, "utf-8");
  const records: PRRecord[] = content.trim().split("\n").map((line) => JSON.parse(line));

  const prsWithBot = records.filter(
    (pr) =>
      pr.pr_state === "MERGED" &&
      pr.review_comments.some((c) => c.is_bot || c.author.includes("coderabbit")),
  );

  console.log(`Found ${prsWithBot.length} merged PRs with CodeRabbit comments`);

  if (dryRun) return;

  // Step 2: Fetch threads from GitHub API (or load cache)
  let allThreadRecords: ThreadRecord[];

  if (!classifyOnly) {
    console.log(`\nFetching review comment threads from GitHub API...`);
    allThreadRecords = [];

    for (let i = 0; i < prsWithBot.length; i++) {
      const pr = prsWithBot[i];
      if ((i + 1) % 20 === 0 || i === 0) {
        console.log(`  Progress: ${i + 1}/${prsWithBot.length} (PR #${pr.pr_number})`);
      }

      const threads = await fetchThreadsForPR(pr.pr_number);
      if (threads.length > 0) {
        allThreadRecords.push({ pr_number: pr.pr_number, threads });
      }
    }

    await writeFile(
      THREADS_FILE,
      allThreadRecords.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
    console.log(`Cached ${allThreadRecords.length} PR thread records to ${THREADS_FILE}`);

    if (fetchOnly) return;
  } else {
    const threadsContent = await readFile(THREADS_FILE, "utf-8");
    allThreadRecords = threadsContent.trim().split("\n").map((line) => JSON.parse(line));
    console.log(`Loaded ${allThreadRecords.length} cached PR thread records`);
  }

  // Step 3: Classify threads
  const classified: ClassifiedThread[] = [];

  for (const record of allThreadRecords) {
    for (const thread of record.threads) {
      classified.push(classifyThread(thread));
    }
  }

  const stats = {
    total: classified.length,
    accepted: classified.filter((c) => c.outcome === "accepted").length,
    rejected: classified.filter((c) => c.outcome === "rejected").length,
    ignored: classified.filter((c) => c.outcome === "ignored").length,
    unclear: classified.filter((c) => c.outcome === "unclear").length,
  };

  console.log(`\nClassified ${stats.total} CodeRabbit comment threads:`);
  if (stats.total > 0) {
    console.log(`  Accepted: ${stats.accepted} (${((stats.accepted / stats.total) * 100).toFixed(1)}%)`);
    console.log(`  Rejected: ${stats.rejected} (${((stats.rejected / stats.total) * 100).toFixed(1)}%)`);
    console.log(`  Ignored:  ${stats.ignored} (${((stats.ignored / stats.total) * 100).toFixed(1)}%)`);
    console.log(`  Unclear:  ${stats.unclear} (${((stats.unclear / stats.total) * 100).toFixed(1)}%)`);
  }

  await writeFile(ANTI_PATTERNS_JSON, JSON.stringify(classified, null, 2) + "\n");

  // Step 4: Build anti-patterns summary
  const rejected = classified.filter((c) => c.outcome === "rejected");
  const ignored = classified.filter((c) => c.outcome === "ignored");

  // Group rejected by subsystem
  const rejectedBySubsystem = new Map<string, ClassifiedThread[]>();
  for (const t of rejected) {
    const sub = inferSubsystem(t.file);
    const existing = rejectedBySubsystem.get(sub) ?? [];
    existing.push(t);
    rejectedBySubsystem.set(sub, existing);
  }

  // Group rejected by CodeRabbit category
  const rejectedByCategory = new Map<string, ClassifiedThread[]>();
  for (const t of rejected) {
    const cat = extractBotCategory(t.bot_comment);
    const existing = rejectedByCategory.get(cat) ?? [];
    existing.push(t);
    rejectedByCategory.set(cat, existing);
  }

  // Build markdown
  const lines: string[] = [];
  lines.push("# CodeRabbit False Positive Analysis");
  lines.push("");
  lines.push(`Analysis of ${stats.total} CodeRabbit review comment threads across ${prsWithBot.length} merged PRs.`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Outcome | Count | % |`);
  lines.push(`|---------|-------|---|`);
  lines.push(`| Accepted | ${stats.accepted} | ${((stats.accepted / stats.total) * 100).toFixed(1)}% |`);
  lines.push(`| Rejected | ${stats.rejected} | ${((stats.rejected / stats.total) * 100).toFixed(1)}% |`);
  lines.push(`| Ignored | ${stats.ignored} | ${((stats.ignored / stats.total) * 100).toFixed(1)}% |`);
  lines.push(`| Unclear | ${stats.unclear} | ${((stats.unclear / stats.total) * 100).toFixed(1)}% |`);
  lines.push("");

  lines.push("## Rejected by Category");
  lines.push("");
  for (const [cat, threads] of [...rejectedByCategory.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`- **${cat}**: ${threads.length} rejected`);
  }
  lines.push("");

  lines.push("## Rejected by Subsystem");
  lines.push("");
  for (const [sub, threads] of [...rejectedBySubsystem.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`- **${sub}**: ${threads.length} rejected`);
  }
  lines.push("");

  // Show concrete examples of rejected feedback
  if (rejected.length > 0) {
    lines.push("## Rejected Examples");
    lines.push("");
    lines.push("These are cases where human reviewers explicitly disagreed with CodeRabbit's suggestion.");
    lines.push("");

    for (const t of rejected.slice(0, 20)) {
      lines.push(`### PR #${t.pr_number} — \`${t.file}\``);
      lines.push("");
      lines.push("**CodeRabbit said:**");
      lines.push(`> ${t.bot_comment.slice(0, 200).replace(/\n/g, "\n> ")}`);
      lines.push("");
      for (const reply of t.human_replies) {
        lines.push(`**${reply.user} replied:**`);
        lines.push(`> ${reply.body.slice(0, 200).replace(/\n/g, "\n> ")}`);
        lines.push("");
      }
      lines.push("---");
      lines.push("");
    }
  }

  await writeFile(ANTI_PATTERNS_MD, lines.join("\n") + "\n");
  console.log(`\nWrote ${ANTI_PATTERNS_MD}`);
  console.log(`  ${rejected.length} rejected threads (false positives)`);
  console.log(`  ${ignored.length} ignored threads (potential false positives)`);
}

main().catch(console.error);
