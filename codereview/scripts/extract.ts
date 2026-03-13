/**
 * Extract structured data from PR markdown files.
 * Parses each input/*.md into a PRRecord and writes to output/comments.jsonl
 *
 * Supports incremental updates: tracks processed files in output/manifest.json
 * and only parses new files on subsequent runs. Use --full to force re-processing.
 */
import { readdir, readFile, writeFile, appendFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PRRecord, ReviewComment, IssueComment, Review } from "./types";

const INPUT_DIR = join(import.meta.dir, "../input");
const OUTPUT_DIR = join(import.meta.dir, "../output");
const OUTPUT_FILE = join(OUTPUT_DIR, "comments.jsonl");
const MANIFEST_FILE = join(OUTPUT_DIR, "manifest.json");

interface Manifest {
  processed: Record<string, number>; // filename -> mtime ms
}

async function loadManifest(): Promise<Manifest> {
  try {
    const content = await readFile(MANIFEST_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return { processed: {} };
  }
}

async function saveManifest(manifest: Manifest): Promise<void> {
  await writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n");
}

function parseHeader(content: string): Omit<PRRecord, "description" | "diff" | "review_comments" | "issue_comments" | "reviews"> {
  const titleMatch = content.match(/^# PR #(\d+): (.+)$/m);
  const authorMatch = content.match(/^\- \*\*Author\*\*: (.+)$/m);
  const stateMatch = content.match(/^\- \*\*State\*\*: (.+)$/m);
  const createdMatch = content.match(/^\- \*\*Created\*\*: (.+)$/m);
  const mergedMatch = content.match(/^\- \*\*Merged\*\*: (.+)$/m);
  const closedMatch = content.match(/^\- \*\*Closed\*\*: (.+)$/m);
  const urlMatch = content.match(/^\- \*\*URL\*\*: (.+)$/m);
  const labelsMatch = content.match(/^\- \*\*Labels\*\*: (.*)$/m);

  return {
    pr_number: titleMatch ? parseInt(titleMatch[1]) : 0,
    pr_title: titleMatch?.[2]?.trim() ?? "",
    pr_author: authorMatch?.[1]?.trim() ?? "",
    pr_state: stateMatch?.[1]?.trim() ?? "",
    pr_created: createdMatch?.[1]?.trim() ?? "",
    pr_merged: mergedMatch?.[1]?.trim() ?? "",
    pr_closed: closedMatch?.[1]?.trim() ?? "",
    pr_url: urlMatch?.[1]?.trim() ?? "",
    pr_labels: labelsMatch?.[1]?.trim()
      ? labelsMatch[1].split(",").map((l) => l.trim()).filter(Boolean)
      : [],
  };
}

function extractSection(content: string, sectionHeader: string, nextSectionHeaders: string[]): string {
  const headerPattern = new RegExp(`^## ${sectionHeader}\\s*$`, "m");
  const headerMatch = content.match(headerPattern);
  if (!headerMatch || headerMatch.index === undefined) return "";

  const start = headerMatch.index + headerMatch[0].length;

  let end = content.length;
  for (const next of nextSectionHeaders) {
    const nextPattern = new RegExp(`^## ${next}\\s*$`, "m");
    const nextMatch = content.slice(start).match(nextPattern);
    if (nextMatch?.index !== undefined) {
      end = Math.min(end, start + nextMatch.index);
    }
  }

  return content.slice(start, end).trim();
}

function extractDiff(sectionContent: string): string {
  const match = sectionContent.match(/```diff\n([\s\S]*?)```/);
  return match?.[1]?.trim() ?? "";
}

function parseReviewComments(sectionContent: string): ReviewComment[] {
  if (!sectionContent || sectionContent === "(no review comments)") return [];

  const comments: ReviewComment[] = [];
  const commentBlocks = sectionContent.split(/(?=^### .+:\d)/m);

  for (const block of commentBlocks) {
    const headerMatch = block.match(/^### (.+):(\d+|[?])\s*$/m);
    if (!headerMatch) continue;

    const file = headerMatch[1].trim();
    const line = headerMatch[2] === "?" ? null : parseInt(headerMatch[2]);

    const authorMatch = block.match(/^\*\*Author\*\*: (.+?)(?:\s+\[bot\])?\s*$/m);
    if (!authorMatch) continue;

    const author = authorMatch[1].trim();
    const is_bot = block.includes("[bot]") && !!block.match(/^\*\*Author\*\*:.*\[bot\]/m);

    const diffMatch = block.match(/```diff\n([\s\S]*?)```/);
    const diff_hunk = diffMatch?.[1]?.trim() ?? "";

    let body = "";
    if (diffMatch?.index !== undefined) {
      const afterDiff = block.slice(diffMatch.index + diffMatch[0].length);
      body = afterDiff.replace(/\n---\s*$/, "").trim();
    } else {
      const authorLineEnd = block.indexOf("\n", block.indexOf(authorMatch[0]) + authorMatch[0].length);
      if (authorLineEnd !== -1) {
        body = block.slice(authorLineEnd).replace(/\n---\s*$/, "").trim();
      }
    }

    if (body) {
      comments.push({ file, line, author, is_bot, diff_hunk, body });
    }
  }

  return comments;
}

function parseIssueComments(sectionContent: string): IssueComment[] {
  if (!sectionContent || sectionContent === "(no issue comments)") return [];

  const comments: IssueComment[] = [];
  const blocks = sectionContent.split(/(?=^### Comment by )/m);

  for (const block of blocks) {
    const headerMatch = block.match(/^### Comment by (.+?)(?:\s+\[bot\])?\s*$/m);
    if (!headerMatch) continue;

    const author = headerMatch[1].trim();
    const is_bot = !!block.match(/^### Comment by .+\[bot\]/m);
    const dateMatch = block.match(/^\*\*Date\*\*: (.+)$/m);
    const date = dateMatch?.[1]?.trim() ?? "";

    const dateLineEnd = block.indexOf("\n", block.indexOf(dateMatch?.[0] ?? "") + (dateMatch?.[0]?.length ?? 0));
    let body = "";
    if (dateLineEnd !== -1) {
      body = block.slice(dateLineEnd).replace(/\n---\s*$/, "").trim();
    }

    if (body) {
      comments.push({ author, is_bot, date, body });
    }
  }

  return comments;
}

function parseReviews(sectionContent: string): Review[] {
  if (!sectionContent || sectionContent === "(no reviews)") return [];

  const reviews: Review[] = [];
  const lines = sectionContent.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^- \*\*(.+?)\*\*: (.+)$/);
    if (!match) continue;

    const author = match[1].trim();
    const state = match[2].trim();

    let body = "";
    let j = i + 1;
    while (j < lines.length && lines[j].match(/^\s*>/)) {
      body += (body ? "\n" : "") + lines[j].replace(/^\s*>\s?/, "");
      j++;
    }

    reviews.push({ author, state, body: body.trim() });
  }

  return reviews;
}

function parsePRFile(content: string): PRRecord {
  const header = parseHeader(content);

  const descSection = extractSection(content, "Description", ["Diff"]);
  const diffSection = extractSection(content, "Diff", ["Review Comments"]);
  const reviewSection = extractSection(content, "Review Comments", ["Issue Comments"]);
  const issueSection = extractSection(content, "Issue Comments", ["Reviews"]);
  const reviewsSection = extractSection(content, "Reviews", []);

  return {
    ...header,
    description: descSection,
    diff: extractDiff(diffSection),
    review_comments: parseReviewComments(reviewSection),
    issue_comments: parseIssueComments(issueSection),
    reviews: parseReviews(reviewsSection),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const fullRebuild = args.includes("--full");

  await mkdir(OUTPUT_DIR, { recursive: true });

  const allFiles = (await readdir(INPUT_DIR)).filter((f) => f.endsWith(".md")).sort();
  const existingManifest = await loadManifest();
  const hasManifest = Object.keys(existingManifest.processed).length > 0;
  const manifest = fullRebuild || !hasManifest ? { processed: {} } : existingManifest;

  // Determine which files need processing
  const newFiles: string[] = [];
  const updatedFiles: string[] = [];

  for (const file of allFiles) {
    const fileStat = await stat(join(INPUT_DIR, file));
    const mtime = fileStat.mtimeMs;
    const prevMtime = manifest.processed[file];

    if (prevMtime === undefined) {
      newFiles.push(file);
    } else if (mtime > prevMtime) {
      updatedFiles.push(file);
    }
  }

  // Detect deleted files
  const currentFileSet = new Set(allFiles);
  const deletedFiles = Object.keys(manifest.processed).filter((f) => !currentFileSet.has(f));

  const needsRebuild = fullRebuild || updatedFiles.length > 0 || deletedFiles.length > 0;

  if (newFiles.length === 0 && !needsRebuild) {
    console.log(`No changes. ${allFiles.length} PR files already processed.`);
    return;
  }

  if (needsRebuild) {
    // Full rebuild: re-process everything
    console.log(
      fullRebuild
        ? `Full rebuild: processing ${allFiles.length} PR files...`
        : `Rebuild needed (${updatedFiles.length} updated, ${deletedFiles.length} deleted): processing ${allFiles.length} PR files...`,
    );

    const lines: string[] = [];
    let totalReviewComments = 0;
    let humanReviewComments = 0;
    let botReviewComments = 0;
    const newManifest: Manifest = { processed: {} };

    for (const file of allFiles) {
      const filePath = join(INPUT_DIR, file);
      const content = await readFile(filePath, "utf-8");
      const fileStat = await stat(filePath);
      const record = parsePRFile(content);

      for (const c of record.review_comments) {
        totalReviewComments++;
        if (c.is_bot) botReviewComments++;
        else humanReviewComments++;
      }

      lines.push(JSON.stringify(record));
      newManifest.processed[file] = fileStat.mtimeMs;
    }

    await writeFile(OUTPUT_FILE, lines.join("\n") + "\n");
    await saveManifest(newManifest);

    console.log(`Wrote ${lines.length} PR records to ${OUTPUT_FILE}`);
    console.log(`Review comments: ${totalReviewComments} total (${humanReviewComments} human, ${botReviewComments} bot)`);
  } else {
    // Incremental: append only new files
    console.log(`Incremental update: ${newFiles.length} new files (${allFiles.length - newFiles.length} cached)`);

    let appended = 0;
    let totalReviewComments = 0;
    let humanReviewComments = 0;
    let botReviewComments = 0;

    for (const file of newFiles) {
      const filePath = join(INPUT_DIR, file);
      const content = await readFile(filePath, "utf-8");
      const fileStat = await stat(filePath);
      const record = parsePRFile(content);

      for (const c of record.review_comments) {
        totalReviewComments++;
        if (c.is_bot) botReviewComments++;
        else humanReviewComments++;
      }

      await appendFile(OUTPUT_FILE, JSON.stringify(record) + "\n");
      manifest.processed[file] = fileStat.mtimeMs;
      appended++;
    }

    await saveManifest(manifest);

    console.log(`Appended ${appended} new PR records to ${OUTPUT_FILE}`);
    console.log(`New review comments: ${totalReviewComments} (${humanReviewComments} human, ${botReviewComments} bot)`);
    console.log(`Total PR records in file: ${Object.keys(manifest.processed).length}`);
  }
}

main().catch(console.error);
