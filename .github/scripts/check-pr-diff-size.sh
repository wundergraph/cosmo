#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 || ! $3 =~ ^[0-9]+$ ]]; then
  echo "Usage: $0 <base-sha> <head-sha> <line-limit>" >&2
  exit 2
fi

base_sha=$1
head_sha=$2
limit=$3
merge_base=$(git merge-base "$base_sha" "$head_sha")
diff_file=$(mktemp)
trap 'rm -f "$diff_file"' EXIT
git diff --no-ext-diff --no-textconv --numstat -z -M "$merge_base" "$head_sha" > "$diff_file"

total=0
generated_files=0
binary_files=0
while IFS= read -r -d '' record; do
  additions=${record%%$'\t'*}
  rest=${record#*$'\t'}
  deletions=${rest%%$'\t'*}
  path=${rest#*$'\t'}

  # A rename has an empty path field, then the old and new paths.
  if [[ -z $path ]]; then
    IFS= read -r -d '' old_path
    IFS= read -r -d '' path
  fi

  # Git 2.40 or newer supports --source; ubuntu-latest provides it.
  # Read attributes from the base commit so a PR cannot exempt its own files.
  # Git quotes unusual paths, so such a generated file counts as non-generated, which is safe.
  attribute=$(git check-attr --source="$base_sha" linguist-generated -- "$path")
  if [[ $attribute == "$path: linguist-generated: true" ]]; then
    generated_files=$((generated_files + 1))
    continue
  fi

  if [[ $additions == - && $deletions == - ]]; then
    binary_files=$((binary_files + 1))
    continue
  fi

  if [[ ! $additions =~ ^[0-9]+$ || ! $deletions =~ ^[0-9]+$ ]]; then
    echo "Invalid diff count for $path" >&2
    exit 1
  fi
  total=$((total + additions + deletions))
done < "$diff_file"

echo "Non-generated lines changed: $total (limit: $limit)."
echo "Generated files excluded: $generated_files. Binary files counted as 0 lines: $binary_files."

if (( total > limit )); then
  echo "::error::PR changes $total non-generated lines (limit: $limit). Split the PR, or ask a person with branch ruleset bypass to merge it."
  exit 1
fi
