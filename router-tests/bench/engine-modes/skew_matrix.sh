#!/usr/bin/env bash
# Skew matrix: 3 cosmo engine modes x {1 VU, 64 VU} x 3 reps with one slow
# subgraph (inventory=150ms vs 20ms) — the regime where the executors differ.
# Modes interleaved per cell; plus 2 cosmo-both-SMOKE footnote rows asserting
# the safe degradation of running BOTH flags (nested schedule-tree plans make
# the dataflow executor fall back; expect ~cosmo-scheduler numbers).
set -uo pipefail
D="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RES="${RES:?set RES to the results jsonl path}"
: > "$RES"
CPUS="${CPUS:-4}"; MEMG="${MEMG:-2}"
DELAYS="${DELAYS:-accounts=20,products=20,reviews=20,inventory=150}"
# run <rep> <label> <vus> <dur> <dataflow> <schedule_tree>
run(){ echo ">>> rep$1 $2 vus=$3 @ $(date +%H:%M:%S)"; REP=$1 VUS=$3 DUR=$4 DELAYS="$DELAYS" LABEL=$2 DATAFLOW=$5 SCHEDULE_TREE=$6 RES="$RES" bash "$D/skew_bench.sh" "$CPUS" "$MEMG"; sleep 3; }
for rep in 1 2 3; do
  for vd in "1 20s" "64 30s"; do
    set -- $vd; vus=$1; dur=$2
    run "$rep" cosmo-baseline  "$vus" "$dur" false false
    run "$rep" cosmo-dataflow  "$vus" "$dur" true  false
    run "$rep" cosmo-scheduler "$vus" "$dur" false true
  done
done
run 1 cosmo-both-SMOKE 1  20s true true
run 1 cosmo-both-SMOKE 64 30s true true
echo ">>> SKEW MATRIX DONE @ $(date +%H:%M:%S)"
