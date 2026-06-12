#!/usr/bin/env bash
# Byte-identity gate: the SAME federated query must return the SAME bytes from
# ONE router image across all engine-flag modes, 25 sequential + 25 concurrent
# requests each. Aborts the benchmark protocol on any divergence.
#
# Modes: baseline(off,off) dataflow(on,off) scheduler(off,on) both(on,on).
# "both" asserts safe degradation: schedule-tree plans are nested, the dataflow
# executor structurally rejects nested plans and falls back — same bytes.
#
# Plumb-through preflight per mode (LOG_LEVEL=info): when dataflow is on the
# logs must contain "dataflow executor enabled"; when the scheduler is on,
# "schedule-tree planner enabled" — proving env -> config -> engine wiring.
#
# Success-path only by design: multi-error ordering determinism is covered
# in-engine by TestDataflowErrorOrderDeterminism.
set -uo pipefail
ROUTER_IMAGE="${ROUTER_IMAGE:-bench-cosmo:local}"
SUBGRAPHS_IMAGE="${SUBGRAPHS_IMAGE:-bench-subgraphs:latest}"
COSMO_CFG_DIR="${COSMO_CFG_DIR:?set COSMO_CFG_DIR (subgraph URLs -> http://bench-sg:4200)}"
QUERY_FILE="${QUERY_FILE:?set QUERY_FILE}"
EXPECTED_BYTES="${EXPECTED_BYTES:-87599}"
NET=bench-net; SG=bench-sg; GWC=bench-gw
WORK="${WORK:-$(mktemp -d)}"

cleanup(){ docker rm -f "$GWC" "$SG" >/dev/null 2>&1; }
cleanup
docker network rm "$NET" >/dev/null 2>&1; sleep 1; docker network create "$NET" >/dev/null 2>&1

docker run -d --name "$SG" --network "$NET" "$SUBGRAPHS_IMAGE" >/dev/null 2>&1
for i in $(seq 1 60); do
  docker run --rm --network "$NET" curlimages/curl:latest -fsS --max-time 1 -X POST http://$SG:4200/products -H 'content-type: application/json' -d '{"query":"{topProducts{upc}}"}' >/dev/null 2>&1 && break
  sleep 0.5
done

BASE_HASH=""
FAIL=0

run_mode(){
  local mode="$1" dataflow="$2" schedule="$3"
  docker rm -f "$GWC" >/dev/null 2>&1
  docker run -d --name "$GWC" --network "$NET" \
    -e LISTEN_ADDR=0.0.0.0:4000 -e LOG_LEVEL=info \
    -e TRACING_ENABLED=false -e METRICS_ENABLED=false -e METRICS_OTLP_ENABLED=false \
    -e GRAPHQL_METRICS_ENABLED=false -e PROMETHEUS_ENABLED=false -e ACCESS_LOGS_ENABLED=false \
    -e ENGINE_ENABLE_DATAFLOW="$dataflow" -e ENGINE_ENABLE_SCHEDULE_TREE="$schedule" \
    -e ROUTER_CONFIG_PATH=/etc/cosmo/config.json -e CONFIG_PATH=/etc/cosmo/config.yaml \
    -v "$COSMO_CFG_DIR:/etc/cosmo:ro" "$ROUTER_IMAGE" >/dev/null 2>&1

  local EP="http://$GWC:4000/graphql" up=0
  for i in $(seq 1 120); do
    docker run --rm --network "$NET" curlimages/curl:latest -fsS --max-time 3 -X POST "$EP" -H 'content-type: application/json' -d '{"query":"{__typename}"}' >/dev/null 2>&1 && { up=1; break; }
    sleep 0.5
  done
  [ "$up" = 1 ] || { echo "BYTEID FAIL [$mode]: router did not come up"; docker logs "$GWC" 2>&1 | tail -5; FAIL=1; return; }

  local logs; logs=$(docker logs "$GWC" 2>&1)
  if [ "$dataflow" = "true" ] && ! echo "$logs" | grep -q "dataflow executor enabled"; then
    echo "BYTEID FAIL [$mode]: ENGINE_ENABLE_DATAFLOW not plumbed through"; FAIL=1; return
  fi
  if [ "$schedule" = "true" ] && ! echo "$logs" | grep -q "schedule-tree planner enabled"; then
    echo "BYTEID FAIL [$mode]: ENGINE_ENABLE_SCHEDULE_TREE not plumbed through"; FAIL=1; return
  fi

  local outdir="$WORK/byteid_$mode"
  rm -rf "$outdir"; mkdir -p "$outdir"
  for i in $(seq 1 25); do
    docker run --rm --network "$NET" -v "$QUERY_FILE:/q.json:ro" curlimages/curl:latest \
      -fsS --max-time 30 -X POST "$EP" -H 'content-type: application/json' --data-binary @/q.json \
      >"$outdir/seq_$i.json" 2>/dev/null
  done
  # 25 concurrent. Helper script: the redirect must live INSIDE the spawned
  # shell, and BSD xargs rejects long inline -I{} commands.
  cat > "$WORK/byteid_curl.sh" <<HELPER
#!/bin/sh
docker run --rm --network $NET -v $QUERY_FILE:/q.json:ro curlimages/curl:latest -fsS --max-time 30 -X POST $EP -H 'content-type: application/json' --data-binary @/q.json > $outdir/conc_\$1.json 2>/dev/null
HELPER
  chmod +x "$WORK/byteid_curl.sh"
  seq 1 25 | xargs -P 25 -n 1 "$WORK/byteid_curl.sh"

  local hashes bytes nfiles
  hashes=$(shasum -a 256 "$outdir"/*.json | awk '{print $1}' | sort -u)
  bytes=$(wc -c < "$outdir/seq_1.json" | tr -d ' ')
  nfiles=$(ls "$outdir"/*.json | wc -l | tr -d ' ')
  # The gate is 25 sequential + 25 concurrent; a partial concurrent batch
  # (xargs failure, curl errors) must not pass silently.
  if [ "$nfiles" != 50 ]; then
    echo "BYTEID FAIL [$mode]: expected 50 response files, got $nfiles"; FAIL=1; return
  fi
  local nhashes; nhashes=$(echo "$hashes" | grep -c .)
  if [ "$nhashes" != 1 ]; then
    echo "BYTEID FAIL [$mode]: $nhashes distinct hashes within mode ($nfiles files)"; FAIL=1; return
  fi
  if [ "$bytes" != "$EXPECTED_BYTES" ]; then
    echo "BYTEID FAIL [$mode]: byte length $bytes != $EXPECTED_BYTES"; FAIL=1; return
  fi
  if [ -z "$BASE_HASH" ]; then
    BASE_HASH="$hashes"
  elif [ "$hashes" != "$BASE_HASH" ]; then
    echo "BYTEID FAIL [$mode]: hash differs from baseline"; FAIL=1; return
  fi
  echo "BYTEID OK [$mode]: $nfiles/$nfiles identical, sha256=${hashes:0:16}..., bytes=$bytes"
}

run_mode baseline  false false
run_mode dataflow  true  false
run_mode scheduler false true
run_mode both      true  true

cleanup; docker network rm "$NET" >/dev/null 2>&1
if [ "$FAIL" != 0 ]; then echo "BYTEID GATE: FAIL"; exit 1; fi
echo "BYTEID GATE: PASS (all 4 modes byte-identical, $EXPECTED_BYTES bytes)"
