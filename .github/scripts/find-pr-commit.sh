#!/bin/bash

# This script finds a PR commit for artifact lookup.
# If the current commit is from a PR, it returns that.
# Otherwise, it searches recent commits to find the last PR commit.
#
# Required environment variables:
#   REPO: GitHub repository (e.g., owner/repo)
#   CURRENT_SHA: The current commit SHA
#   GITHUB_TOKEN: Required for API authentication
#
# Outputs (to $GITHUB_OUTPUT):
#   merge_commit_sha: The commit SHA to use for artifact lookup
#   skip: 'true' if no PR commit found, 'false' otherwise
#

REPO="${REPO:?REPO environment variable is required}"
CURRENT_SHA="${CURRENT_SHA:?CURRENT_SHA environment variable is required}"

echo "Checking if commit $CURRENT_SHA is from a PR..."

# Check if current commit is from a merged PR
pr_count=$(curl -sf \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/commits/$CURRENT_SHA/pulls" \
  | jq 'map(select(.merged_at != null)) | length')

if [ $? -ne 0 ]; then
  echo "Failed to check PR status for current commit" >&2
  exit 1
fi

echo "Found $pr_count merged PR(s) for current commit"

if [ "$pr_count" -gt 0 ]; then
  echo "Current commit is from a PR"
  echo "merge_commit_sha=$CURRENT_SHA" >> "$GITHUB_OUTPUT"
  echo "skip=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

echo "Current commit is not from a PR, searching for last PR commit..."

# Get recent commits on main (up to 100)
commits=$(curl -sf \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/commits?sha=main&per_page=100" \
  | jq -r '.[].sha')

if [ $? -ne 0 ]; then
  echo "Failed to fetch recent commits" >&2
  exit 1
fi

last_pr_commit=""
for commit_sha in $commits; do
  echo "Checking commit: $commit_sha"

  pr_count=$(curl -sf \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$REPO/commits/$commit_sha/pulls" \
    | jq 'map(select(.merged_at != null)) | length')

  if [ $? -ne 0 ]; then
    echo "Warning: Failed to check PR status for commit $commit_sha, skipping..." >&2
    continue
  fi

  if [ "$pr_count" -gt 0 ]; then
    echo "Found last PR commit: $commit_sha"
    last_pr_commit="$commit_sha"
    break
  fi
done

if [ -z "$last_pr_commit" ]; then
  echo "No PR commit found in recent history, skipping codecov upload"
  echo "skip=true" >> "$GITHUB_OUTPUT"
  exit 0
fi

echo "Using artifacts from PR commit: $last_pr_commit"
echo "merge_commit_sha=$last_pr_commit" >> "$GITHUB_OUTPUT"
echo "skip=false" >> "$GITHUB_OUTPUT"
