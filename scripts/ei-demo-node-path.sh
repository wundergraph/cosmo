#!/bin/bash
set -e

# Prints the bin directory of a Node version the control plane can run on.
# Node 25's experimental global localStorage and missing native prebuilds
# (@sentry-internal/node-native-stacktrace) break `pnpm dev` in
# controlplane, so odd/experimental majors are rejected: LTS majors 20,
# 22, 24 are accepted. Falls back to the newest nvm-installed v22/v24 if
# the system node is unsuitable. Fails loudly with instructions otherwise.

node_bin_ok() {
  local bin="$1"
  local major
  major="$("$bin/node" -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
  [ "$major" = "20" ] || [ "$major" = "22" ] || [ "$major" = "24" ]
}

system_bin="$(dirname "$(command -v node 2>/dev/null || echo /nonexistent)")"
if [ -x "$system_bin/node" ] && node_bin_ok "$system_bin"; then
  echo "$system_bin"
  exit 0
fi

for version_glob in v22 v24; do
  candidate="$(ls -d "$HOME"/.nvm/versions/node/$version_glob.*/bin 2>/dev/null | sort -V | tail -1)"
  if [ -n "$candidate" ] && node_bin_ok "$candidate"; then
    echo "$candidate"
    exit 0
  fi
done

echo "ERROR: no suitable Node found for the control plane." >&2
echo "       Need Node 20, 22, or 24 (LTS). Node 25+ breaks native modules." >&2
echo "       Install one (e.g. 'nvm install 22') and re-run." >&2
exit 1
