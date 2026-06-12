#!/usr/bin/env bash
# Uniform matrix: 3 cosmo engine modes x {0,10,50,100}ms x 3 reps, modes
# interleaved per delay cell (cancels machine drift). One router image; modes
# are env-flag selections, so the comparison is binary-identical.
# Run under `caffeinate -dimsu` on macOS — absurd tails (>=10x the delay) are
# the host-sleep signature and invalidate the rep.
set -uo pipefail
D="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RES="${RES:?set RES to the results jsonl path}"
: > "$RES"
CPUS="${CPUS:-4}"; MEMG="${MEMG:-2}"; VUS="${VUS:-64}"; DUR="${DUR:-30s}"
# run <rep> <label> <delay> <dataflow> <schedule_tree>
run(){ echo ">>> rep$1 $2 delay=${3}ms @ $(date +%H:%M:%S)"; REP=$1 DELAY=$3 VUS=$VUS DUR=$DUR LABEL=$2 DATAFLOW=$4 SCHEDULE_TREE=$5 RES="$RES" bash "$D/uniform_bench.sh" "$CPUS" "$MEMG"; sleep 3; }
for rep in 1 2 3; do
  for delay in 0 10 50 100; do
    run "$rep" cosmo-baseline  "$delay" false false
    run "$rep" cosmo-dataflow  "$delay" true  false
    run "$rep" cosmo-scheduler "$delay" false true
  done
done
echo ">>> UNIFORM MATRIX DONE @ $(date +%H:%M:%S)"
