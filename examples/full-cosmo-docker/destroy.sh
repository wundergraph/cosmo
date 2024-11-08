#!/bin/bash
set -e

file_path="current_commit.hash"
if [[ "$1" == "--last-release" ]] && [ -f "$file_path" ]; then
    current_commit=$(cat "$file_path")  # Use $file variable here
    rm -f "$file_path"
fi

cd ../.. && make full-demo-down

if [[ "$1" == "--last-release" ]] && (( ${#current_commit} > 0 )); then
    # Restoring code: Checkout to the current commit
    git checkout "$current_commit"
fi