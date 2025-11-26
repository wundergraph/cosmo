#!/bin/bash

# This script finds the latest successful workflow run artifact for a PR commit.
# 
# Required environment variables:
#   REPO: GitHub repository (e.g., owner/repo)
#   HEAD_SHA: The PR head commit SHA
#   CURRENT_RUN_ID: The current workflow run ID
#   ARTIFACT_NAME: Name of the artifact to find
#   WORKFLOW_PATH: Path to the workflow file to filter by
#   GITHUB_TOKEN: Required for API authentication
#
# Outputs (to $GITHUB_OUTPUT):
#   run_id: The workflow run ID containing the artifact
#   artifact_id: The artifact ID

REPO="${REPO:?REPO environment variable is required}"
HEAD_SHA="${HEAD_SHA:?HEAD_SHA environment variable is required}"
CURRENT_RUN_ID="${CURRENT_RUN_ID:?CURRENT_RUN_ID environment variable is required}"
ARTIFACT_NAME="${ARTIFACT_NAME:?ARTIFACT_NAME environment variable is required}"
WORKFLOW_PATH="${WORKFLOW_PATH:?WORKFLOW_PATH environment variable is required}"

echo "Head SHA: $HEAD_SHA"
echo "Current run id: $CURRENT_RUN_ID"

# Get all PR runs for this commit (since its runs per Sha 500 should be enough for now)
json=$(curl -sf \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/actions/runs?head_sha=$HEAD_SHA&event=pull_request&per_page=500")

if [ $? -ne 0 ]; then
  echo "Failed to fetch workflow runs" >&2
  exit 1
fi

# Pick the latest *completed & successful* run that is NOT this run
run_id=$(echo "$json" | jq -r --arg cur "$CURRENT_RUN_ID" --arg workflow "$WORKFLOW_PATH" '
  .workflow_runs
  | map(select(
    .id != ($cur|tonumber)
    and .status == "completed"
    and .conclusion == "success"
    and .path == $workflow
  ))
  | sort_by(.created_at)
  | last
  | .id
')

if [ $? -ne 0 ]; then
  echo "Failed to parse workflow runs JSON" >&2
  exit 1
fi

if [ -z "$run_id" ] || [ "$run_id" = "null" ]; then
  echo "No previous successful PR run found for $HEAD_SHA" >&2
  exit 1
fi

echo "Using run id: $run_id"

# Get artifacts for that run
artifacts_json=$(curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/actions/runs/$run_id/artifacts")

# Find the artifact ID for the desired artifact name
artifact_id=$(echo "$artifacts_json" | jq -r --arg name "$ARTIFACT_NAME" '
  .artifacts
  | map(select(.name == $name and .expired == false))
  | sort_by(.created_at)
  | last
  | .id
')

if [ -z "$artifact_id" ] || [ "$artifact_id" = "null" ]; then
  echo "No non-expired artifact named '$ARTIFACT_NAME' found for run $run_id" >&2
  echo "Artifacts JSON for debugging:" >&2
  echo "$artifacts_json" >&2
  exit 1
fi

echo "Using artifact id: $artifact_id"

echo "run_id=$run_id" >> "$GITHUB_OUTPUT"
echo "artifact_id=$artifact_id" >> "$GITHUB_OUTPUT"