#!/usr/bin/env bash
set -euo pipefail

REPO="wundergraph/cosmo"
OUTDIR="$(cd "$(dirname "$0")" && pwd)/input"
SINCE_DATE="$(date -v-6m +%Y-%m-%d 2>/dev/null || date -d '6 months ago' +%Y-%m-%d)"
LIMIT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit) LIMIT="$2"; shift 2 ;;
    --since) SINCE_DATE="$2"; shift 2 ;;
    *) echo "Usage: $0 [--limit N] [--since YYYY-MM-DD]"; exit 1 ;;
  esac
done

mkdir -p "$OUTDIR"

echo "Fetching PR list from $REPO (created since $SINCE_DATE)..."

# Fetch all PR numbers, titles, etc. in one paginated call
gh_limit="${LIMIT:-500}"
pr_json=$(gh pr list --repo "$REPO" --state all --search "created:>=$SINCE_DATE" \
  --limit "$gh_limit" \
  --json number,title,author,createdAt,mergedAt,closedAt,state,url,labels,body \
  --jq 'sort_by(.number) | reverse')

pr_count=$(echo "$pr_json" | jq 'length')
echo "Found $pr_count PRs"

# Filter out dependabot/renovate PRs
pr_json=$(echo "$pr_json" | jq '[.[] | select(.author.login != "dependabot" and .author.login != "renovate" and .author.login != "renovate[bot]" and .author.login != "dependabot[bot]")]')
filtered_count=$(echo "$pr_json" | jq 'length')
echo "After filtering bots: $filtered_count PRs"

if [ -n "$LIMIT" ]; then
  pr_json=$(echo "$pr_json" | jq ".[0:$LIMIT]")
  echo "Limited to $LIMIT PRs"
fi

downloaded=0
skipped=0
total=$(echo "$pr_json" | jq 'length')

while IFS= read -r pr; do
  number=$(echo "$pr" | jq -r '.number')
  title=$(echo "$pr" | jq -r '.title')
  author=$(echo "$pr" | jq -r '.author.login')
  created=$(echo "$pr" | jq -r '.createdAt')
  merged=$(echo "$pr" | jq -r '.mergedAt // "n/a"')
  closed=$(echo "$pr" | jq -r '.closedAt // "n/a"')
  state=$(echo "$pr" | jq -r '.state')
  url=$(echo "$pr" | jq -r '.url')
  labels=$(echo "$pr" | jq -r '[.labels[].name] | join(", ")')
  body=$(echo "$pr" | jq -r '.body // ""')

  outfile="$OUTDIR/${number}.md"

  if [ -f "$outfile" ]; then
    echo "[$number] SKIP (already exists): $title"
    skipped=$((skipped + 1))
    continue
  fi

  downloaded=$((downloaded + 1))
  echo "[$downloaded/$total] #$number: $title"

  # Start building the markdown file
  {
    echo "# PR #${number}: ${title}"
    echo ""
    echo "- **Author**: ${author}"
    echo "- **State**: ${state}"
    echo "- **Created**: ${created}"
    echo "- **Merged**: ${merged}"
    echo "- **Closed**: ${closed}"
    echo "- **URL**: ${url}"
    echo "- **Labels**: ${labels}"
    echo ""
    echo "## Description"
    echo ""
    echo "$body"
    echo ""
  } > "$outfile"

  # Fetch diff
  {
    echo "## Diff"
    echo ""
    echo '```diff'
    gh pr diff "$number" --repo "$REPO" 2>/dev/null || echo "(diff unavailable)"
    echo '```'
    echo ""
  } >> "$outfile"

  # Fetch review comments (inline code comments)
  {
    echo "## Review Comments"
    echo ""
    review_comments=$(gh api "repos/$REPO/pulls/$number/comments" --paginate 2>/dev/null || echo "[]")
    echo "$review_comments" | jq -r '.[] |
      "### \(.path):\(.line // .original_line // "?")\n" +
      "**Author**: \(.user.login)" +
      (if .user.type == "Bot" then " [bot]" else "" end) +
      "\n\n" +
      "```diff\n\(.diff_hunk)\n```\n\n" +
      "\(.body)\n\n---\n"
    ' 2>/dev/null || echo "(no review comments)"
    echo ""
  } >> "$outfile"

  # Fetch issue comments (general discussion)
  {
    echo "## Issue Comments"
    echo ""
    issue_comments=$(gh api "repos/$REPO/issues/$number/comments" --paginate 2>/dev/null || echo "[]")
    echo "$issue_comments" | jq -r '.[] |
      "### Comment by \(.user.login)" +
      (if .user.type == "Bot" then " [bot]" else "" end) +
      "\n" +
      "**Date**: \(.created_at)\n\n" +
      "\(.body)\n\n---\n"
    ' 2>/dev/null || echo "(no issue comments)"
    echo ""
  } >> "$outfile"

  # Fetch reviews (approval/request changes/comment summaries)
  {
    echo "## Reviews"
    echo ""
    reviews=$(gh api "repos/$REPO/pulls/$number/reviews" --paginate 2>/dev/null || echo "[]")
    echo "$reviews" | jq -r '.[] | select(.body != "" or .state != "COMMENTED") |
      "- **\(.user.login)**: \(.state)" +
      (if .body != "" then "\n  > \(.body)" else "" end)
    ' 2>/dev/null || echo "(no reviews)"
    echo ""
  } >> "$outfile"

  # Courtesy sleep to avoid secondary rate limits
  sleep 0.3
done < <(echo "$pr_json" | jq -c '.[]')

echo ""
echo "Done. Downloaded: $downloaded, Skipped: $skipped"
echo "Output directory: $OUTDIR"
