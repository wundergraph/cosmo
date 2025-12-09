#!/bin/bash

# This script downloads coverage artifacts from GitHub Actions runs.
#
# Required environment variables:
#   GITHUB_TOKEN: Required for GitHub CLI authentication
#   REPO: GitHub repository (e.g., owner/repo)
#   ARTIFACTS_JSON: JSON array of artifacts to download (from find-codecov-artifact.sh output)
#   COVERAGE_PATH: Directory where artifacts should be downloaded
#

set -e

GITHUB_TOKEN="${GITHUB_TOKEN:?GITHUB_TOKEN environment variable is required}"
REPO="${REPO:?REPO environment variable is required}"
ARTIFACTS_JSON="${ARTIFACTS_JSON:?ARTIFACTS_JSON environment variable is required}"
COVERAGE_PATH="${COVERAGE_PATH:?COVERAGE_PATH environment variable is required}"

echo "Downloading artifacts..."

# Validate JSON before processing
if ! echo "$ARTIFACTS_JSON" | jq empty 2>/dev/null; then
  echo "ERROR: Invalid JSON received from artifact discovery step" >&2
  echo "JSON content (truncated to 500 chars):" >&2
  echo "$ARTIFACTS_JSON" | head -c 500 >&2
  echo "" >&2
  exit 1
fi

echo "$ARTIFACTS_JSON" | jq -c '.[]' | while read -r artifact; do
  run_id=$(echo "$artifact" | jq -r '.run_id')
  artifact_id=$(echo "$artifact" | jq -r '.artifact_id')
  artifact_name=$(echo "$artifact" | jq -r '.artifact_name')

  echo "Downloading artifact: $artifact_name (ID: $artifact_id) from run: $run_id"

  # Download artifact using GitHub CLI
  gh run download "$run_id" \
    --repo "$REPO" \
    --name "$artifact_name" \
    --dir "$COVERAGE_PATH/$artifact_name"

  if [ $? -eq 0 ]; then
    echo "✓ Successfully downloaded $artifact_name"
  else
    echo "✗ Failed to download $artifact_name" >&2
    exit 1
  fi
done

echo "All artifacts downloaded successfully"

