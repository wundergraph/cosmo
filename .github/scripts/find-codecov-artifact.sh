#!/bin/bash

# This script finds the latest successful workflow run artifacts for a PR commit.
#
# Required environment variables:
#   REPO: GitHub repository (e.g., owner/repo)
#   CURRENT_RUN_ID: The current workflow run ID
#   ARTIFACT_NAME_PATTERN: Pattern to match artifact names (e.g., "codecov-pr-build")
#   WORKFLOW_PATHS: Comma-separated list of workflow file paths to filter by (e.g., ".github/workflows/router-ci.yaml,.github/workflows/cli-ci.yaml")
#   GITHUB_TOKEN: Required for API authentication
#
# Optional environment variables:
#   HEAD_SHA: The PR head commit SHA (if running in PR context)
#   MERGE_COMMIT_SHA: The merge commit SHA (if running after merge to main)
#
# Outputs (to $GITHUB_OUTPUT):
#   artifacts_json: JSON array of objects with run_id, artifact_id, and artifact_name
#
REPO="${REPO:?REPO environment variable is required}"
CURRENT_RUN_ID="${CURRENT_RUN_ID:?CURRENT_RUN_ID environment variable is required}"
ARTIFACT_NAME_PATTERN="${ARTIFACT_NAME_PATTERN:?ARTIFACT_NAME_PATTERN environment variable is required}"
WORKFLOW_PATHS="${WORKFLOW_PATHS:?WORKFLOW_PATHS environment variable is required}"

# If MERGE_COMMIT_SHA is provided, look up the PR to get HEAD_SHA
if [ -n "$MERGE_COMMIT_SHA" ]; then
  echo "Merge commit SHA provided: $MERGE_COMMIT_SHA"
  echo "Looking up PR for merge commit..."

  # Search for PRs that were merged with this commit (with retry logic for timing issues)
  max_retries=5
  retry_count=0
  pr_json=""
  backoff_delays=(3 9 15 15)  # Backoff delays in seconds

  while [ $retry_count -lt $max_retries ]; do
    pr_json=$(curl -sf \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/$REPO/commits/$MERGE_COMMIT_SHA/pulls")

    if [ $? -ne 0 ]; then
      echo "Failed to fetch PR information for merge commit" >&2
      exit 1
    fi

    # Check if we got any PRs
    pr_count=$(echo "$pr_json" | jq 'length')
    if [ "$pr_count" -gt 0 ]; then
      echo "Found $pr_count PR(s) for merge commit"
      break
    fi

    retry_count=$((retry_count + 1))
    if [ $retry_count -lt $max_retries ]; then
      # Get the appropriate backoff delay
      delay_index=$((retry_count - 1))
      if [ $delay_index -ge ${#backoff_delays[@]} ]; then
        delay_index=$((${#backoff_delays[@]} - 1))
      fi
      delay=${backoff_delays[$delay_index]}
      echo "No PRs found yet (attempt $retry_count/$max_retries), retrying in $delay seconds..."
      sleep $delay
    fi
  done

  if [ -z "$pr_json" ] || [ "$(echo "$pr_json" | jq 'length')" -eq 0 ]; then
    echo "No PRs found for merge commit after $max_retries attempts" >&2
    echo "This might be a direct push (not from a PR merge)" >&2
    exit 1
  fi

  # Extract the head SHA from the PR that was actually merged (state: closed, merged_at != null)
  # We prefer the PR whose merge_commit_sha matches our MERGE_COMMIT_SHA
  HEAD_SHA=$(echo "$pr_json" | jq -r --arg merge_sha "$MERGE_COMMIT_SHA" '
    map(select(.state == "closed" and .merged_at != null))
    | map(select(.merge_commit_sha == $merge_sha))
    | .[0].head.sha
  ')

  # If no exact match, fall back to the first merged PR
  if [ -z "$HEAD_SHA" ] || [ "$HEAD_SHA" = "null" ]; then
    echo "No exact merge commit match, trying first merged PR..."
    HEAD_SHA=$(echo "$pr_json" | jq -r '
      map(select(.state == "closed" and .merged_at != null))
      | .[0].head.sha
    ')
  fi

  if [ -z "$HEAD_SHA" ] || [ "$HEAD_SHA" = "null" ]; then
    echo "No merged PR found for commit $MERGE_COMMIT_SHA" >&2
    echo "PR JSON: $pr_json" >&2
    exit 1
  fi

  echo "Found PR head SHA: $HEAD_SHA"
else
  HEAD_SHA="${HEAD_SHA:?HEAD_SHA environment variable is required when MERGE_COMMIT_SHA is not provided}"
fi

echo "Head SHA: $HEAD_SHA"
echo "Current run id: $CURRENT_RUN_ID"
echo "Artifact pattern: $ARTIFACT_NAME_PATTERN"
echo "Workflow paths: $WORKFLOW_PATHS"

# Get all PR runs for this commit (since its runs per SHA 500 should be enough for now)
json=$(curl -sf \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/actions/runs?head_sha=$HEAD_SHA&event=pull_request&per_page=500")

if [ $? -ne 0 ]; then
  echo "Failed to fetch workflow runs" >&2
  exit 1
fi

# Convert comma-separated workflow paths to JSON array for jq
workflow_paths_array=$(echo "$WORKFLOW_PATHS" | jq -Rc 'split(",")')

echo "Finding runs for workflows: $workflow_paths_array"

# Find all completed & successful runs that are NOT this run and match our workflow paths
run_ids=$(echo "$json" | jq -r --arg cur "$CURRENT_RUN_ID" --argjson workflows "$workflow_paths_array" '
  .workflow_runs
  | map(select(
    .id != ($cur|tonumber)
    and .status == "completed"
    and .conclusion == "success"
    and ([.path] | inside($workflows))
  ))
  | map(.id)
  | unique
  | .[]
')

if [ -z "$run_ids" ]; then
  echo "No previous successful PR runs found for $HEAD_SHA matching specified workflows" >&2
  exit 1
fi

echo "Found run IDs: $run_ids"

# Collect all matching artifacts from all runs
all_artifacts="[]"

for run_id in $run_ids; do
  echo "Fetching artifacts for run id: $run_id"

  # Get artifacts for that run
  artifacts_json=$(curl -s \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$REPO/actions/runs/$run_id/artifacts")

  # Find all artifacts matching the pattern
  matching_artifacts=$(echo "$artifacts_json" | jq --arg pattern "$ARTIFACT_NAME_PATTERN" --arg run "$run_id" '
    .artifacts
    | map(select((.name | contains($pattern)) and .expired == false))
    | map({
        run_id: ($run | tonumber),
        artifact_id: .id,
        artifact_name: .name,
        created_at: .created_at
      })
  ')

  # Merge with collected artifacts
  all_artifacts=$(echo "$all_artifacts" | jq --argjson new "$matching_artifacts" '. + $new')
done

# Sort by created_at and ensure we have at least one artifact
artifact_count=$(echo "$all_artifacts" | jq 'length' 2>/dev/null || echo "0")

if [ -z "$artifact_count" ] || [ "$artifact_count" -eq 0 ]; then
  echo "No non-expired artifacts matching pattern '$ARTIFACT_NAME_PATTERN' found" >&2
  echo "All artifacts JSON: $all_artifacts" >&2
  exit 1
fi

echo "Found $artifact_count matching artifacts"

# Output the JSON array
echo "$all_artifacts" | jq -c 'sort_by(.created_at)'

# Write to GitHub output as a single-line JSON string
artifacts_output=$(echo "$all_artifacts" | jq -c 'sort_by(.created_at)')
echo "artifacts_json=$artifacts_output" >> "$GITHUB_OUTPUT"