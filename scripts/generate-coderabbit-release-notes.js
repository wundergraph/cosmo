// scripts/generate-coderabbit-release-notes.js
//
// Flow:
// 1. Read release event from GITHUB_EVENT_PATH
// 2. Parse release.body to find PR numbers like (#2339)
// 3. For each PR, fetch:
//    - PR data
//    - Issue comments (for CodeRabbit bot comments)
// 4. Extract a CodeRabbit-style summary from PR body or comments
// 5. Write a Markdown file `coderabbit-release-notes-<tag>.md`

const fs = require("fs");
const { Octokit } = require("@octokit/core");

const token = process.env.GITHUB_TOKEN;
const repoSlug = process.env.GITHUB_REPOSITORY;
const eventPath = process.env.GITHUB_EVENT_PATH;

if (!token) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}
if (!repoSlug) {
  console.error("GITHUB_REPOSITORY is required");
  process.exit(1);
}
if (!eventPath) {
  console.error("GITHUB_EVENT_PATH is required");
  process.exit(1);
}

const [owner, repo] = repoSlug.split("/");

function safeFileName(str) {
  return str.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function extractSummaryFromBody(body) {
  if (!body) return null;

  const summaryHeadingRegex =
    /^(#+)\s+(?:coderabbit\s+)?summary\b[\s\S]*?$/gim;

  const match = summaryHeadingRegex.exec(body);
  if (match) {
    const headingLevel = match[1];
    const startIndex = match.index + match[0].indexOf("\n") + 1;
    let endIndex = body.length;

    const nextHeadingRegex = new RegExp(`^${headingLevel}\\s+`, "gm");
    const rest = body.slice(startIndex);
    const nextMatch = nextHeadingRegex.exec(rest);
    if (nextMatch) {
      endIndex = startIndex + nextMatch.index;
    }

    return body.slice(startIndex, endIndex).trim();
  }

  const lines = body.split("\n").slice(0, 20);
  return lines.join("\n").trim();
}

function extractSummaryFromComments(comments) {
  if (!Array.isArray(comments)) return null;

  const coderabbitComment = comments.find(
    (c) =>
      c.user &&
      c.user.login &&
      c.user.login.toLowerCase() === "coderabbitai"
  );

  if (!coderabbitComment) return null;

  const lines = (coderabbitComment.body || "").split("\n").slice(0, 40);
  return lines.join("\n").trim();
}

(async () => {
  const octokit = new Octokit({ auth: token });

  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const release = event.release;

  if (!release) {
    console.error("Not a release event payload.");
    process.exit(1);
  }

  const tagName = release.tag_name;
  const releaseName = release.name || tagName;
  const releaseUrl = release.html_url;
  const releaseBody = release.body || "";

  console.log(`Generating CodeRabbit summaries for release: ${releaseName}`);

  const prNumbers = new Set();
  for (const match of releaseBody.matchAll(/#(\d+)/g)) {
    prNumbers.add(Number(match[1]));
  }

  if (prNumbers.size === 0) {
    console.log("No PR references (#123) found in release body.");
    process.exit(0);
  }

  console.log(`Found PRs in release body: ${[...prNumbers].join(", ")}`);

  const prInfos = [];

  for (const num of Array.from(prNumbers).sort((a, b) => a - b)) {
    try {
      const { data: pr } = await octokit.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}",
        {
          owner,
          repo,
          pull_number: num,
        }
      );

      const { data: comments } = await octokit.request(
        "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
        {
          owner,
          repo,
          issue_number: num,
          per_page: 100,
        }
      );

      let summary =
        extractSummaryFromBody(pr.body || "") ||
        extractSummaryFromComments(comments);

      if (!summary || summary.trim() === "") {
        summary =
          "_No CodeRabbit-specific summary found; using PR body/title instead._\n\n" +
          (pr.body || pr.title || "").trim();
      }

      prInfos.push({
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        author: pr.user && pr.user.login,
        summary,
      });
    } catch (e) {
      console.warn(`Error fetching PR #${num}: ${e.message}`);
    }
  }

  if (prInfos.length === 0) {
    console.log("No PR details could be fetched.");
    process.exit(0);
  }

  const fileName = `coderabbit-release-notes-${safeFileName(tagName)}.md`;
  const lines = [];

  lines.push(`# Release ${releaseName} – CodeRabbit PR Summaries`);
  lines.push("");
  lines.push(`Tag: \`${tagName}\``);
  if (releaseUrl) {
    lines.push(`Release: ${releaseUrl}`);
  }
  lines.push("");
  lines.push(
    `This file was generated from PRs referenced in the release body (e.g. lines like \`... (#1234) ...\`).`
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const pr of prInfos) {
    lines.push(`## ${pr.title} (#${pr.number})`);
    lines.push("");
    if (pr.author) lines.push(`- Author: @${pr.author}`);
    lines.push(`- Link: ${pr.url}`);
    lines.push("");
    lines.push("### Summary");
    lines.push("");
    lines.push(pr.summary);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  fs.writeFileSync(fileName, lines.join("\n"), "utf8");
  console.log(`Wrote ${fileName}`);
})();
