#!/bin/bash
set -e

file_path="current_commit.hash"
if [[ "$1" == "--last-release" ]]; then
    current_commit=$(git rev-parse HEAD)

    latest_tag=$(git tag --sort=-v:refname | head -n 1)
    latest_release_commit=$(git rev-list -n 1 "$latest_tag")

    # Checkout the code at the last release
    git checkout "$latest_release_commit"

    echo $current_commit > "$file_path"
    current=$(cat current_commit.hash)
fi

cd ../.. && make full-demo-up