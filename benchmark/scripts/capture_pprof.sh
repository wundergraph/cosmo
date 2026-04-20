#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${1:?usage: capture_pprof.sh <output-dir>}"
PPROF_SECONDS="${PPROF_SECONDS:-5}"

mkdir -p "${OUTPUT_DIR}"

curl -sf "http://127.0.0.1:6060/debug/pprof/profile?seconds=${PPROF_SECONDS}" \
  -o "${OUTPUT_DIR}/router_cpu.pb.gz"
curl -sf "http://127.0.0.1:6060/debug/pprof/heap" \
  -o "${OUTPUT_DIR}/router_heap.pb.gz"
