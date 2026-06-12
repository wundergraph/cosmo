#!/usr/bin/env bash
# Skewed per-subgraph latency benchmark for ONE cosmo engine mode: the lat-proxy
# injects a DIFFERENT delay per subgraph path, then forwards to the subgraph
# container. This exposes the per-wave-barrier slack that uniform latency hides
# — the regime where the dataflow executor and the schedule-tree scheduler earn
# their keep.
#
# Usage: DELAYS="accounts=20,products=20,reviews=20,inventory=150" skew_bench.sh <cpus> <memg>
# Env:   ROUTER_IMAGE SUBGRAPHS_IMAGE LAT_PROXY_IMAGE COSMO_CFG_DIR (subgraph
#        URLs -> http://lat-proxy:8080) QUERY_FILE EXPECTED_BYTES LABEL
#        DATAFLOW SCHEDULE_TREE REP VUS DUR RES
set -uo pipefail
CPUS="$1"; MEMG="$2"; REP="${REP:-1}"; MEM="${MEMG}g"
VUS="${VUS:-1}"; DUR="${DUR:-20s}"; DELAYS="${DELAYS:-accounts=20,products=20,reviews=20,inventory=150}"
LABEL="${LABEL:-cosmo-baseline}"
ROUTER_IMAGE="${ROUTER_IMAGE:-bench-cosmo:local}"
SUBGRAPHS_IMAGE="${SUBGRAPHS_IMAGE:-bench-subgraphs:latest}"
LAT_PROXY_IMAGE="${LAT_PROXY_IMAGE:-lat-proxy:local}"
COSMO_CFG_DIR="${COSMO_CFG_DIR:?set COSMO_CFG_DIR to the dir with config.json + config.yaml (subgraph URLs -> http://lat-proxy:8080)}"
QUERY_FILE="${QUERY_FILE:?set QUERY_FILE to the federated query JSON body}"
EXPECTED_BYTES="${EXPECTED_BYTES:-87599}"
K6JS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/k6.js"
RES="${RES:?set RES to the results jsonl path}"
GOMEM_MIB="$(( MEMG * 1024 * 80 / 100 ))MiB"
CPUSET="0-$((CPUS-1))"; [ "$CPUS" = "1" ] && CPUSET="0"
NET=bench-net; SG=bench-sg; PX=lat-proxy; GWC=bench-gw
mkdir -p "$(dirname "$RES")"
cleanup(){ pkill -9 -f "docker stats" >/dev/null 2>&1; docker rm -f "$GWC" "$SG" "$PX" bench-k6 >/dev/null 2>&1; }
cleanup
for i in $(seq 1 30); do docker ps -aq --filter "name=$GWC" --filter "name=$SG" --filter "name=$PX" | grep -q . || break; sleep 0.5; done
docker network rm "$NET" >/dev/null 2>&1; sleep 1; docker network create "$NET" >/dev/null 2>&1

docker run -d --name "$SG" --network "$NET" "$SUBGRAPHS_IMAGE" >/dev/null 2>&1
for i in $(seq 1 60); do docker run --rm --network "$NET" curlimages/curl:latest -fsS --max-time 1 -X POST http://$SG:4200/products -H 'content-type: application/json' -d '{"query":"{topProducts{upc}}"}' >/dev/null 2>&1 && break; sleep 0.5; done
# latency proxy in front of the subgraphs
docker run -d --name "$PX" --network "$NET" -e UPSTREAM="http://$SG:4200" -e DELAYS="$DELAYS" "$LAT_PROXY_IMAGE" >/dev/null 2>&1
for i in $(seq 1 30); do docker run --rm --network "$NET" curlimages/curl:latest -fsS --max-time 2 -X POST http://$PX:8080/products -H 'content-type: application/json' -d '{"query":"{topProducts{upc}}"}' >/dev/null 2>&1 && break; sleep 0.5; done

docker run -d --name "$GWC" --network "$NET" --cpuset-cpus="$CPUSET" --memory="$MEM" \
  -e GOMAXPROCS="$CPUS" -e GOMEMLIMIT="$GOMEM_MIB" -e LISTEN_ADDR=0.0.0.0:4000 -e LOG_LEVEL=fatal \
  -e TRACING_ENABLED=false -e METRICS_ENABLED=false -e METRICS_OTLP_ENABLED=false \
  -e GRAPHQL_METRICS_ENABLED=false -e PROMETHEUS_ENABLED=false -e ACCESS_LOGS_ENABLED=false \
  -e ENGINE_ENABLE_DATAFLOW="${DATAFLOW:-false}" -e ENGINE_ENABLE_SCHEDULE_TREE="${SCHEDULE_TREE:-false}" \
  -e ROUTER_CONFIG_PATH=/etc/cosmo/config.json -e CONFIG_PATH=/etc/cosmo/config.yaml \
  -v "$COSMO_CFG_DIR:/etc/cosmo:ro" "$ROUTER_IMAGE" >/dev/null 2>&1

EP="http://$GWC:4000/graphql"
up=0
for i in $(seq 1 120); do docker run --rm --network "$NET" curlimages/curl:latest -fsS --max-time 3 -X POST "$EP" -H 'content-type: application/json' -d '{"query":"{__typename}"}' >/dev/null 2>&1 && { up=1; break; }; docker ps --filter "name=$GWC" --filter status=running -q | grep -q . || { sleep 0.5; continue; }; sleep 0.5; done
if [ "$up" != 1 ]; then echo "{\"rep\":$REP,\"label\":\"$LABEL\",\"delays\":\"$DELAYS\",\"error\":\"no up\"}" | tee -a "$RES"; cleanup; exit 1; fi
ready=0
for i in $(seq 1 30); do rb=$(docker run --rm --network "$NET" -v "$QUERY_FILE:/q.json:ro" curlimages/curl:latest -fsS --max-time 20 -X POST "$EP" -H 'content-type: application/json' --data-binary @/q.json 2>/dev/null | wc -c | tr -d ' '); [ "${rb:-0}" -ge $(( EXPECTED_BYTES * 99 / 100 )) ] && { ready=1; break; }; sleep 0.5; done
if [ "$ready" != 1 ]; then echo "{\"rep\":$REP,\"label\":\"$LABEL\",\"delays\":\"$DELAYS\",\"error\":\"not federating\"}" | tee -a "$RES"; cleanup; exit 1; fi
VB=$(docker run --rm --network "$NET" -v "$QUERY_FILE:/q.json:ro" curlimages/curl:latest -fsS --max-time 20 -X POST "$EP" -H 'content-type: application/json' --data-binary @/q.json 2>/dev/null | wc -c | tr -d ' ')

STATF=$(mktemp); : > "$STATF"
docker stats --format '{{.CPUPerc}}|{{.MemUsage}}' "$GWC" >>"$STATF" 2>/dev/null & SAMP=$!

K6OUT=$(mktemp -d); rm -f "$K6OUT/k6_summary.json"
docker run --rm --network "$NET" -v "$K6JS:/k6.js:ro" -v "$K6OUT:/out" \
  -e GATEWAY_ENDPOINT="$EP" -e MODE=constant -e BENCH_VUS="$VUS" -e BENCH_OVER_TIME="$DUR" -e SUMMARY_PATH=/out -e K6_SETUP_TIMEOUT=600s \
  grafana/k6:latest run /k6.js >/dev/null 2>&1
kill -9 "$SAMP" >/dev/null 2>&1; wait "$SAMP" 2>/dev/null
J="$K6OUT/k6_summary.json"
RPS=$(jq -r '.metrics.http_reqs.values.rate|floor' "$J" 2>/dev/null); SUCC=$(jq -r '.metrics.success_rate.values.rate' "$J" 2>/dev/null)
MIN=$(jq -r '.metrics.http_req_duration.values.min' "$J" 2>/dev/null); MED=$(jq -r '.metrics.http_req_duration.values.med' "$J" 2>/dev/null)
P90=$(jq -r '.metrics.http_req_duration.values["p(90)"]' "$J" 2>/dev/null); P999=$(jq -r '.metrics.http_req_duration.values["p(99.9)"]' "$J" 2>/dev/null)
P95=$(jq -r '.metrics.http_req_duration.values["p(95)"]' "$J" 2>/dev/null)
read CPUAVG CPUMAX MEMMAX <<<"$(tr -d '\r' < "$STATF" | sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' | awk -F'|' '{gsub(/%/,"",$1);c=$1+0;if(c>cm)cm=c;cs+=c;n++;split($2,a,"/");m=a[1];gsub(/[^0-9.A-Za-z]/,"",m);v=m+0;if(m~/GiB/)v*=1024;if(m~/KiB/)v/=1024;if(v>mm)mm=v} END{if(n)printf "%.0f %.0f %.0f",cs/n,cm,mm;else print "0 0 0"}')"
rm -rf "$STATF" "$K6OUT"
echo "{\"rep\":$REP,\"label\":\"$LABEL\",\"dataflow\":\"${DATAFLOW:-false}\",\"schedule_tree\":\"${SCHEDULE_TREE:-false}\",\"delays\":\"$DELAYS\",\"vus\":$VUS,\"rps\":${RPS:-0},\"success\":${SUCC:-0},\"min_ms\":${MIN:-0},\"med_ms\":${MED:-0},\"p90_ms\":${P90:-0},\"p95_ms\":${P95:-0},\"p999_ms\":${P999:-0},\"cpu_avg_pct\":${CPUAVG:-0},\"cpu_max_pct\":${CPUMAX:-0},\"mem_max_mib\":${MEMMAX:-0},\"valid_bytes\":${VB:-0}}" | tee -a "$RES"
cleanup
