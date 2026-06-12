#!/usr/bin/env bash
# Uniform-latency benchmark for ONE cosmo engine mode: identical artificial
# subgraph latency via `tc netem` on the subgraph container's egress (a
# privileged netshoot sidecar sharing its netns).
#
# Semantics: netem egress delay X delays every subgraph RESPONSE by X. With the
# router's keep-alive pools this is ~X ms added per fetch round trip; a query
# with W sequential fetch waves gains ~W*X ms. `limit 100000` prevents netem's
# default 1000-packet queue from dropping under load (an artifact, not real
# behavior). The qdisc is verified present after adding, else this run is
# recorded as an error row.
#
# Usage: DELAY=<ms> uniform_bench.sh <cpus> <memg>
# Env:   ROUTER_IMAGE SUBGRAPHS_IMAGE COSMO_CFG_DIR QUERY_FILE EXPECTED_BYTES
#        LABEL DATAFLOW SCHEDULE_TREE REP VUS DUR RES
set -uo pipefail
CPUS="$1"; MEMG="$2"; REP="${REP:-1}"; MEM="${MEMG}g"
DELAY="${DELAY:-0}"; VUS="${VUS:-64}"; DUR="${DUR:-30s}"
LABEL="${LABEL:-cosmo-baseline}"
ROUTER_IMAGE="${ROUTER_IMAGE:-bench-cosmo:local}"
SUBGRAPHS_IMAGE="${SUBGRAPHS_IMAGE:-bench-subgraphs:latest}"
COSMO_CFG_DIR="${COSMO_CFG_DIR:?set COSMO_CFG_DIR to the dir with config.json + config.yaml (subgraph URLs -> http://bench-sg:4200)}"
QUERY_FILE="${QUERY_FILE:?set QUERY_FILE to the federated query JSON body}"
EXPECTED_BYTES="${EXPECTED_BYTES:-87599}"
K6JS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/k6.js"
RES="${RES:?set RES to the results jsonl path}"
GOMEM_MIB="$(( MEMG * 1024 * 80 / 100 ))MiB"
if [ "$CPUS" = "1" ]; then CPUSET="0"; else CPUSET="0-$((CPUS-1))"; fi
NET=bench-net; SG=bench-sg; GWC=bench-gw
mkdir -p "$(dirname "$RES")"

cleanup(){ pkill -9 -f "docker stats" >/dev/null 2>&1; docker rm -f "$GWC" "$SG" bench-k6 >/dev/null 2>&1; }
cleanup
for i in $(seq 1 30); do docker ps -aq --filter "name=$GWC" --filter "name=$SG" | grep -q . || break; sleep 0.5; done
docker network rm "$NET" >/dev/null 2>&1
for i in $(seq 1 20); do docker network ls --filter "name=$NET" -q | grep -q . || break; docker network rm "$NET" >/dev/null 2>&1; sleep 0.5; done
docker network create "$NET" >/dev/null 2>&1

# subgraphs on the network (not CPU-limited)
docker run -d --name "$SG" --network "$NET" "$SUBGRAPHS_IMAGE" >/dev/null 2>&1
for i in $(seq 1 60); do
  docker run --rm --network "$NET" curlimages/curl:latest -fsS --max-time 1 -X POST http://$SG:4200/products -H 'content-type: application/json' -d '{"query":"{topProducts{upc}}"}' >/dev/null 2>&1 && break
  sleep 0.5
done

# inject artificial latency on the subgraphs' egress
NETEM_OK=1
if [ "$DELAY" != "0" ]; then
  docker run --rm --net "container:$SG" --cap-add NET_ADMIN nicolaka/netshoot:latest \
    sh -c "tc qdisc add dev eth0 root netem delay ${DELAY}ms limit 100000" >/dev/null 2>&1 || NETEM_OK=0
  docker run --rm --net "container:$SG" --cap-add NET_ADMIN nicolaka/netshoot:latest \
    tc qdisc show dev eth0 2>/dev/null | grep -q "netem.*delay ${DELAY}ms" || NETEM_OK=0
fi
if [ "$NETEM_OK" != 1 ]; then echo "{\"rep\":$REP,\"label\":\"$LABEL\",\"delay_ms\":$DELAY,\"vus\":$VUS,\"error\":\"netem failed\"}" | tee -a "$RES"; cleanup; docker network rm "$NET" >/dev/null 2>&1; exit 1; fi

docker run -d --name "$GWC" --network "$NET" --cpuset-cpus="$CPUSET" --memory="$MEM" \
  -e GOMAXPROCS="$CPUS" -e GOMEMLIMIT="$GOMEM_MIB" -e LISTEN_ADDR=0.0.0.0:4000 -e LOG_LEVEL=fatal \
  -e TRACING_ENABLED=false -e METRICS_ENABLED=false -e METRICS_OTLP_ENABLED=false \
  -e GRAPHQL_METRICS_ENABLED=false -e PROMETHEUS_ENABLED=false -e ACCESS_LOGS_ENABLED=false \
  -e ENGINE_ENABLE_DATAFLOW="${DATAFLOW:-false}" -e ENGINE_ENABLE_SCHEDULE_TREE="${SCHEDULE_TREE:-false}" \
  -e ROUTER_CONFIG_PATH=/etc/cosmo/config.json -e CONFIG_PATH=/etc/cosmo/config.yaml \
  -v "$COSMO_CFG_DIR:/etc/cosmo:ro" "$ROUTER_IMAGE" >/dev/null 2>&1

EP="http://$GWC:4000/graphql"
up=0
for i in $(seq 1 120); do
  docker run --rm --network "$NET" curlimages/curl:latest -fsS --max-time 3 -X POST "$EP" -H 'content-type: application/json' -d '{"query":"{__typename}"}' >/dev/null 2>&1 && { up=1; break; }
  docker ps --filter "name=$GWC" --filter status=running -q | grep -q . || { sleep 0.5; continue; }
  sleep 0.5
done
if [ "$up" != 1 ]; then echo "{\"rep\":$REP,\"label\":\"$LABEL\",\"delay_ms\":$DELAY,\"vus\":$VUS,\"error\":\"no up\"}" | tee -a "$RES"; cleanup; docker network rm "$NET" >/dev/null 2>&1; exit 1; fi
# readiness: require a REAL federated response before measuring
ready=0
for i in $(seq 1 30); do
  rb=$(docker run --rm --network "$NET" -v "$QUERY_FILE:/q.json:ro" curlimages/curl:latest -fsS --max-time 20 -X POST "$EP" -H 'content-type: application/json' --data-binary @/q.json 2>/dev/null | wc -c | tr -d ' ')
  [ "${rb:-0}" -ge $(( EXPECTED_BYTES * 99 / 100 )) ] && { ready=1; break; }
  sleep 0.5
done
if [ "$ready" != 1 ]; then echo "{\"rep\":$REP,\"label\":\"$LABEL\",\"delay_ms\":$DELAY,\"vus\":$VUS,\"error\":\"not federating\"}" | tee -a "$RES"; cleanup; docker network rm "$NET" >/dev/null 2>&1; exit 1; fi
VB=$(docker run --rm --network "$NET" -v "$QUERY_FILE:/q.json:ro" curlimages/curl:latest -fsS --max-time 20 -X POST "$EP" -H 'content-type: application/json' --data-binary @/q.json 2>/dev/null | wc -c | tr -d ' ')

# stats sampler
STATF=$(mktemp); : > "$STATF"
docker stats --format '{{.CPUPerc}}|{{.MemUsage}}' "$GWC" >>"$STATF" 2>/dev/null & SAMP=$!

K6OUT=$(mktemp -d); rm -f "$K6OUT/k6_summary.json"
docker run --rm --network "$NET" -v "$K6JS:/k6.js:ro" -v "$K6OUT:/out" \
  -e GATEWAY_ENDPOINT="$EP" -e MODE=constant -e BENCH_VUS="$VUS" -e BENCH_OVER_TIME="$DUR" -e SUMMARY_PATH=/out \
  -e K6_SETUP_TIMEOUT=600s \
  grafana/k6:latest run /k6.js >/dev/null 2>&1
kill -9 "$SAMP" >/dev/null 2>&1; wait "$SAMP" 2>/dev/null

J="$K6OUT/k6_summary.json"
RPS=$(jq -r '.metrics.http_reqs.values.rate|floor' "$J" 2>/dev/null)
SUCC=$(jq -r '.metrics.success_rate.values.rate' "$J" 2>/dev/null)
MIN=$(jq -r '.metrics.http_req_duration.values.min'   "$J" 2>/dev/null)
MED=$(jq -r '.metrics.http_req_duration.values.med'   "$J" 2>/dev/null)
P90=$(jq -r '.metrics.http_req_duration.values["p(90)"]' "$J" 2>/dev/null)
P95=$(jq -r '.metrics.http_req_duration.values["p(95)"]' "$J" 2>/dev/null)
P999=$(jq -r '.metrics.http_req_duration.values["p(99.9)"]' "$J" 2>/dev/null)
read CPUAVG CPUMAX MEMMAX <<<"$(tr -d '\r' < "$STATF" | sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' | awk -F'|' '{gsub(/%/,"",$1);c=$1+0;if(c>cm)cm=c;cs+=c;n++;split($2,a,"/");m=a[1];gsub(/[^0-9.A-Za-z]/,"",m);v=m+0;if(m~/GiB/)v*=1024;if(m~/KiB/)v/=1024;if(v>mm)mm=v} END{if(n)printf "%.0f %.0f %.0f",cs/n,cm,mm;else print "0 0 0"}')"
rm -rf "$STATF" "$K6OUT"

echo "{\"rep\":$REP,\"label\":\"$LABEL\",\"dataflow\":\"${DATAFLOW:-false}\",\"schedule_tree\":\"${SCHEDULE_TREE:-false}\",\"delay_ms\":$DELAY,\"vus\":$VUS,\"cpus\":$CPUS,\"rps\":${RPS:-0},\"success\":${SUCC:-0},\"min_ms\":${MIN:-0},\"med_ms\":${MED:-0},\"p90_ms\":${P90:-0},\"p95_ms\":${P95:-0},\"p999_ms\":${P999:-0},\"cpu_avg_pct\":${CPUAVG:-0},\"cpu_max_pct\":${CPUMAX:-0},\"mem_max_mib\":${MEMMAX:-0},\"valid_bytes\":${VB:-0}}" | tee -a "$RES"
cleanup; docker network rm "$NET" >/dev/null 2>&1
exit 0
