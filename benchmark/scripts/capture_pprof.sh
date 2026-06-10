#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${1:?usage: capture_pprof.sh <output-dir>}"
PPROF_SECONDS="${PPROF_SECONDS:-5}"
CURL_CONNECT_TIMEOUT="${CURL_CONNECT_TIMEOUT:-2}"
# CPU capture runs PPROF_SECONDS server-side, so allow that plus headroom for
# connect/response overhead. Heap is bounded by a smaller constant.
CURL_CPU_MAX_TIME="${CURL_CPU_MAX_TIME:-$((PPROF_SECONDS + 15))}"
CURL_HEAP_MAX_TIME="${CURL_HEAP_MAX_TIME:-20}"

mkdir -p "${OUTPUT_DIR}"

curl -fsS --connect-timeout "${CURL_CONNECT_TIMEOUT}" --max-time "${CURL_CPU_MAX_TIME}" \
  "http://127.0.0.1:6060/debug/pprof/profile?seconds=${PPROF_SECONDS}" \
  -o "${OUTPUT_DIR}/router_cpu.pb.gz"
curl -fsS --connect-timeout "${CURL_CONNECT_TIMEOUT}" --max-time "${CURL_HEAP_MAX_TIME}" \
  "http://127.0.0.1:6060/debug/pprof/heap" \
  -o "${OUTPUT_DIR}/router_heap.pb.gz"
