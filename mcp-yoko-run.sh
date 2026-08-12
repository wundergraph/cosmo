#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

YOKO_HOST="${MCP_YOKO_HOST:-127.0.0.1}"
YOKO_PORT="${MCP_YOKO_PORT:-5055}"
CONTROLPLANE_HOST="${MCP_YOKO_CONTROLPLANE_HOST:-127.0.0.1}"
CONTROLPLANE_PORT="${MCP_YOKO_CONTROLPLANE_PORT:-3001}"
ROUTER_HOST="${MCP_YOKO_ROUTER_HOST:-127.0.0.1}"
ROUTER_PORT="${MCP_YOKO_ROUTER_PORT:-3002}"
MCP_HOST="${MCP_YOKO_MCP_HOST:-127.0.0.1}"
MCP_PORT="${MCP_YOKO_MCP_PORT:-5025}"
GRAPH_NAME="${MCP_YOKO_GRAPH_NAME:-mcp-yoko}"
NAMESPACE="${MCP_YOKO_NAMESPACE:-default}"
ORGANIZATION_SLUG="${MCP_YOKO_ORGANIZATION_SLUG:-wundergraph}"

FAKE_YOKO_ONLY=false
SKIP_INSTALL=false

usage() {
  cat <<'USAGE'
Usage: ./mcp-yoko-run.sh [options]

Starts the local Cosmo infrastructure, a source-built control plane and router,
the demo subgraphs, and a fake Yoko service backed by `codex exec`.

Options:
  --fake-yoko-only  Start only the fake Yoko HTTP service.
  --skip-install    Do not install/build the JavaScript workspaces.
  -h, --help        Show this help.

Useful environment variables:
  MCP_YOKO_CODEX_MODEL       Optional model passed to `codex exec`.
  MCP_YOKO_CODEX_REASONING   Reasoning effort (default: low).
  MCP_YOKO_CODEX_TIMEOUT     Codex timeout in seconds (default: 180).
  MCP_YOKO_PORT              Fake Yoko port (default: 5055).
  MCP_YOKO_MCP_PORT          Router MCP port (default: 5025).
  MCP_YOKO_GRAPH_NAME        Federated graph name (default: mcp-yoko).
  MCP_YOKO_FORCE_BUILD=1     Rebuild JavaScript workspaces even if present.
  MCP_YOKO_RUN_DIR           Directory in which to keep logs and run state.

The Compose infrastructure is intentionally left running when this script
exits. Stop it later with `make infra-down`.
USAGE
}

while (($# > 0)); do
  case "$1" in
    --fake-yoko-only)
      FAKE_YOKO_ONLY=true
      ;;
    --skip-install)
      SKIP_INSTALL=true
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

log() {
  printf '[mcp-yoko] %s\n' "$*"
}

die() {
  printf '[mcp-yoko] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command '$1' was not found."
}

validate_name() {
  [[ "$2" =~ ^[A-Za-z0-9._-]+$ ]] || die "$1 contains unsupported characters: $2"
}

validate_port() {
  [[ "$2" =~ ^[0-9]+$ ]] && ((10#$2 >= 1 && 10#$2 <= 65535)) || die "$1 must be a TCP port: $2"
}

validate_name "graph name" "$GRAPH_NAME"
validate_name "namespace" "$NAMESPACE"
validate_name "organization slug" "$ORGANIZATION_SLUG"
validate_port "Yoko port" "$YOKO_PORT"
validate_port "control-plane port" "$CONTROLPLANE_PORT"
validate_port "router port" "$ROUTER_PORT"
validate_port "MCP port" "$MCP_PORT"

require_command python3
require_command curl
require_command codex
codex login status >/dev/null 2>&1 || die "Codex is not authenticated. Run 'codex login' and rerun the script."

if [[ -n "${MCP_YOKO_RUN_DIR:-}" ]]; then
  RUN_DIR="$MCP_YOKO_RUN_DIR"
  mkdir -p "$RUN_DIR"
else
  RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cosmo-mcp-yoko.XXXXXX")"
fi
STATE_DIR="$RUN_DIR/yoko-state"
mkdir -p "$STATE_DIR"

PIDS=()
PROCESS_NAMES=()

remember_process() {
  PIDS+=("$1")
  PROCESS_NAMES+=("$2")
}

terminate_tree() {
  local pid="$1"
  local child

  if command -v pgrep >/dev/null 2>&1; then
    while IFS= read -r child; do
      [[ -n "$child" ]] && terminate_tree "$child"
    done < <(pgrep -P "$pid" 2>/dev/null || true)
  fi

  kill -TERM "$pid" 2>/dev/null || true
}

cleanup() {
  local status=$?
  local index

  trap - EXIT INT TERM HUP
  if ((${#PIDS[@]} > 0)); then
    log "Stopping local processes..."
    for ((index = ${#PIDS[@]} - 1; index >= 0; index--)); do
      terminate_tree "${PIDS[$index]}"
    done
    for index in "${!PIDS[@]}"; do
      wait "${PIDS[$index]}" 2>/dev/null || true
    done
  fi

  if ((status != 0)); then
    log "A process failed. Recent logs:"
    for index in "${!PROCESS_NAMES[@]}"; do
      if [[ -f "$RUN_DIR/${PROCESS_NAMES[$index]}.log" ]]; then
        printf '\n--- %s ---\n' "${PROCESS_NAMES[$index]}"
        tail -n 25 "$RUN_DIR/${PROCESS_NAMES[$index]}.log" || true
      fi
    done
  fi

  log "Logs and fake-Yoko state: $RUN_DIR"
  exit "$status"
}

trap cleanup EXIT
trap 'exit 0' INT TERM HUP

require_free_port() {
  local host="$1"
  local port="$2"
  local label="$3"

  python3 - "$host" "$port" <<'PY' || die "$label cannot bind to $host:$port; the port is already in use."
import socket
import sys

host, port = sys.argv[1], int(sys.argv[2])
family = socket.AF_INET6 if ":" in host else socket.AF_INET
with socket.socket(family, socket.SOCK_STREAM) as sock:
    sock.bind((host, port))
PY
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempts="${3:-120}"
  local attempt

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if curl --silent --show-error --fail --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  die "Timed out waiting for $label at $url"
}

monitor_processes() {
  local index
  while true; do
    for index in "${!PIDS[@]}"; do
      if ! kill -0 "${PIDS[$index]}" 2>/dev/null; then
        wait "${PIDS[$index]}" || true
        die "${PROCESS_NAMES[$index]} exited unexpectedly."
      fi
    done
    sleep 2
  done
}

start_fake_yoko() {
  require_free_port "$YOKO_HOST" "$YOKO_PORT" "fake Yoko"
  log "Starting fake Yoko on http://$YOKO_HOST:$YOKO_PORT"

  python3 -u - "$YOKO_HOST" "$YOKO_PORT" "$STATE_DIR" <<'PY' >"$RUN_DIR/fake-yoko.log" 2>&1 &
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

host, port, state_arg = sys.argv[1], int(sys.argv[2]), sys.argv[3]
state_dir = Path(state_arg).resolve()
index_dir = state_dir / "indexes"
index_dir.mkdir(parents=True, exist_ok=True)

output_schema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "additionalProperties": False,
    "required": ["resolution"],
    "properties": {
        "resolution": {
            "type": "object",
            "additionalProperties": False,
            "required": ["queries", "unsatisfied"],
            "properties": {
                "queries": {
                    "type": "array",
                    "maxItems": 1,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": [
                            "description",
                            "document",
                            "operationName",
                            "operationType",
                            "variablesSchema",
                        ],
                        "properties": {
                            "description": {"type": "string"},
                            "document": {"type": "string", "minLength": 1},
                            "operationName": {"type": "string", "minLength": 1},
                            "operationType": {
                                "type": "string",
                                "enum": ["query", "mutation", "subscription"],
                            },
                            "variablesSchema": {"type": "string"},
                        },
                    },
                },
                "unsatisfied": {
                    "type": "array",
                    "maxItems": 1,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["reason"],
                        "properties": {"reason": {"type": "string", "minLength": 1}},
                    },
                },
            },
        }
    },
}
schema_path = state_dir / "codex-output-schema.json"
schema_path.write_text(json.dumps(output_schema), encoding="utf-8")

codex_bin = os.environ.get("MCP_YOKO_CODEX_BIN", "codex")
codex_model = os.environ.get("MCP_YOKO_CODEX_MODEL", "").strip()
codex_reasoning = os.environ.get("MCP_YOKO_CODEX_REASONING", "low").strip()
codex_timeout = int(os.environ.get("MCP_YOKO_CODEX_TIMEOUT", "180"))
codex_slots = threading.BoundedSemaphore(int(os.environ.get("MCP_YOKO_CODEX_CONCURRENCY", "2")))


def resolution_error(reason):
    return {"resolution": {"queries": [], "unsatisfied": [{"reason": reason}]}}


def validate_resolution(value):
    if not isinstance(value, dict) or not isinstance(value.get("resolution"), dict):
        raise ValueError("Codex did not return a resolution object")

    resolution = value["resolution"]
    queries = resolution.get("queries")
    unsatisfied = resolution.get("unsatisfied")
    if not isinstance(queries, list) or not isinstance(unsatisfied, list):
        raise ValueError("Codex returned invalid resolution lists")
    if len(queries) + len(unsatisfied) != 1:
        raise ValueError("Codex must return exactly one query or one unsatisfied reason")

    if unsatisfied:
        reason = unsatisfied[0].get("reason") if isinstance(unsatisfied[0], dict) else None
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError("Codex returned an empty unsatisfied reason")
        return resolution_error(reason.strip())

    query = queries[0]
    if not isinstance(query, dict):
        raise ValueError("Codex returned an invalid query")
    for key in ("description", "document", "operationName", "operationType", "variablesSchema"):
        if not isinstance(query.get(key), str):
            raise ValueError(f"Codex query field {key} is not a string")
    if not query["document"].strip() or not re.fullmatch(r"[_A-Za-z][_0-9A-Za-z]*", query["operationName"]):
        raise ValueError("Codex returned an invalid GraphQL document or operation name")
    if query["operationType"] not in ("query", "mutation", "subscription"):
        raise ValueError("Codex returned an invalid operation type")
    try:
        variables_schema = json.loads(query["variablesSchema"] or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError("Codex returned an invalid variables JSON Schema") from exc
    if not isinstance(variables_schema, dict):
        raise ValueError("Codex variables JSON Schema is not an object")
    query["variablesSchema"] = json.dumps(variables_schema, separators=(",", ":"))
    query["description"] = query["description"].strip()
    query["document"] = query["document"].strip()
    return {"resolution": {"queries": [query], "unsatisfied": []}}


def generate_query(index_id, prompt):
    digest = index_id.removeprefix("sha256:")
    schema_file = index_dir / f"{digest}.graphql"
    if not re.fullmatch(r"[0-9a-fA-F]{64}", digest) or not schema_file.is_file():
        return resolution_error(f"No schema is indexed for {index_id}")

    graphql_schema = schema_file.read_text(encoding="utf-8")
    instructions = f"""You generate exactly one GraphQL operation from a natural-language request.

Use only fields and argument types present in the supplied schema. Give the operation a descriptive
GraphQL operation name. Return a JSON object matching the provided output schema. variablesSchema
must itself be a JSON-encoded JSON Schema object describing the operation variables; use \"{{}}\"
when there are no variables. If the request cannot be satisfied by the schema, return no queries and
one concise unsatisfied reason. Do not execute commands, inspect files, or explain the answer outside
the structured response.

<user_request>
{prompt}
</user_request>

<graphql_schema>
{graphql_schema}
</graphql_schema>
"""

    request_dir = Path(tempfile.mkdtemp(prefix="request-", dir=state_dir))
    output_file = request_dir / "result.json"
    command = [
        codex_bin,
        "exec",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--color",
        "never",
        "--output-schema",
        str(schema_path),
        "--output-last-message",
        str(output_file),
        "-C",
        str(request_dir),
    ]
    if codex_model:
        command.extend(["--model", codex_model])
    if codex_reasoning:
        command.extend(["--config", f"model_reasoning_effort={codex_reasoning}"])
    command.append("-")

    try:
        with codex_slots:
            completed = subprocess.run(
                command,
                input=instructions,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=codex_timeout,
                check=False,
            )
    except subprocess.TimeoutExpired:
        return resolution_error(f"Codex timed out after {codex_timeout} seconds")
    except OSError as exc:
        print(f"Could not start Codex: {exc}", flush=True)
        return resolution_error("The local Codex process could not be started")

    if completed.returncode != 0 or not output_file.is_file():
        print(f"Codex failed with exit code {completed.returncode}:\n{completed.stdout}", flush=True)
        return resolution_error("Codex failed to generate a query; inspect fake-yoko.log")

    try:
        return validate_resolution(json.loads(output_file.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"Invalid Codex response: {exc}\n{completed.stdout}", flush=True)
        return resolution_error("Codex returned an invalid query response; inspect fake-yoko.log")


class Handler(BaseHTTPRequestHandler):
    server_version = "FakeYokoCodex/1.0"

    def log_message(self, format_string, *args):
        print(f"{self.address_string()} - {format_string % args}", flush=True)

    def send_json(self, status, value):
        body = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Invalid Content-Length") from exc
        if length <= 0 or length > 32 * 1024 * 1024:
            raise ValueError("Request body is empty or too large")
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError as exc:
            raise ValueError("Request body is not valid JSON") from exc

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"status": "ok", "backend": "codex"})
            return
        self.send_json(404, {"error": "not found"})

    def do_POST(self):
        try:
            body = self.read_json()
            if not isinstance(body, dict):
                raise ValueError("Request body must be an object")

            if self.path == "/yoko.v1.YokoService/EnsureIndex":
                sdl = body.get("sdl")
                if not isinstance(sdl, str) or not sdl.strip():
                    raise ValueError("sdl must be a non-empty string")
                digest = hashlib.sha256(sdl.encode("utf-8")).hexdigest()
                index_id = f"sha256:{digest}"
                (index_dir / f"{digest}.graphql").write_text(sdl, encoding="utf-8")
                print(f"Indexed {index_id} ({len(sdl)} bytes)", flush=True)
                self.send_json(200, {"indexId": index_id})
                return

            if self.path == "/yoko.v1.YokoService/GenerateQuery":
                index_id = body.get("indexId")
                prompt = body.get("prompt")
                if not isinstance(index_id, str) or not index_id:
                    raise ValueError("indexId must be a non-empty string")
                if not isinstance(prompt, str) or not prompt.strip():
                    raise ValueError("prompt must be a non-empty string")
                print(f"Generating a query for {index_id}: {prompt.strip()}", flush=True)
                self.send_json(200, generate_query(index_id, prompt.strip()))
                return

            self.send_json(404, {"error": "not found"})
        except ValueError as exc:
            self.send_json(400, {"error": str(exc)})
        except BrokenPipeError:
            print("Client disconnected before the response was sent", flush=True)


server = ThreadingHTTPServer((host, port), Handler)
print(f"Fake Yoko listening on http://{host}:{port}", flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
PY

  remember_process "$!" "fake-yoko"
  wait_for_http "http://$YOKO_HOST:$YOKO_PORT/health" "fake Yoko" 30
}

start_fake_yoko

if [[ "$FAKE_YOKO_ONLY" == true ]]; then
  log "Fake Yoko is ready. Press Ctrl-C to stop it."
  log "Health: http://$YOKO_HOST:$YOKO_PORT/health"
  monitor_processes
fi

require_command make
require_command go
require_command docker

if command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  mkdir -p "$RUN_DIR/bin"
  python3 - "$RUN_DIR/bin/pnpm" <<'PY'
from pathlib import Path
import sys

wrapper = Path(sys.argv[1])
wrapper.write_text('#!/usr/bin/env bash\nexec corepack pnpm "$@"\n', encoding="utf-8")
wrapper.chmod(0o755)
PY
  export PATH="$RUN_DIR/bin:$PATH"
  PNPM=(pnpm)
else
  die "pnpm was not found, and corepack is not available to provide it."
fi

pnpm_run() {
  "${PNPM[@]}" "$@"
}

wgc() {
  pnpm_run --silent --filter ./cli wgc "$@"
}

docker info >/dev/null 2>&1 || die "Docker is installed but its daemon is not reachable. Start Docker and rerun the script."
docker compose version >/dev/null 2>&1 || die "The Docker Compose plugin is required."

for port_spec in \
  "$CONTROLPLANE_HOST:$CONTROLPLANE_PORT:control-plane" \
  "$ROUTER_HOST:$ROUTER_PORT:router" \
  "$MCP_HOST:$MCP_PORT:MCP" \
  "127.0.0.1:4001:employees-subgraph" \
  "127.0.0.1:4002:family-subgraph" \
  "127.0.0.1:4003:hobbies-subgraph" \
  "127.0.0.1:4004:products-subgraph" \
  "127.0.0.1:4006:test-subgraph" \
  "127.0.0.1:4007:availability-subgraph" \
  "127.0.0.1:4008:mood-subgraph" \
  "127.0.0.1:4009:countries-subgraph" \
  "127.0.0.1:4010:products-feature-subgraph"; do
  IFS=: read -r check_host check_port check_label <<<"$port_spec"
  require_free_port "$check_host" "$check_port" "$check_label"
done

if [[ ! -f "$ROOT_DIR/controlplane/.env" ]]; then
  cp "$ROOT_DIR/controlplane/.env.example" "$ROOT_DIR/controlplane/.env"
  log "Created controlplane/.env from its example."
fi
if [[ ! -f "$ROOT_DIR/cli/.env" ]]; then
  cp "$ROOT_DIR/cli/.env.example" "$ROOT_DIR/cli/.env"
  log "Created cli/.env from its example."
fi

needs_workspace_build=false
if [[ ! -d "$ROOT_DIR/node_modules" || ! -d "$ROOT_DIR/connect/dist" ]]; then
  needs_workspace_build=true
fi
if [[ "${MCP_YOKO_FORCE_BUILD:-0}" == "1" ]]; then
  needs_workspace_build=true
fi

if [[ "$SKIP_INSTALL" == false && "$needs_workspace_build" == true ]]; then
  log "Installing and building JavaScript workspaces (first run can take several minutes)..."
  (
    cd "$ROOT_DIR"
    pnpm_run install
    pnpm_run generate
    pnpm_run -r run --filter '!studio' build
  ) >"$RUN_DIR/workspace-build.log" 2>&1 || die "JavaScript workspace build failed; inspect $RUN_DIR/workspace-build.log"
elif [[ "$SKIP_INSTALL" == true ]]; then
  [[ -d "$ROOT_DIR/node_modules" && -d "$ROOT_DIR/connect/dist" ]] || die "--skip-install was used, but workspace dependencies/build output are missing."
  log "Skipping JavaScript install/build."
else
  log "Reusing existing JavaScript workspace dependencies and build output."
fi

log "Starting the repository's Compose development infrastructure..."
(
  cd "$ROOT_DIR"
  make infra-up
) >"$RUN_DIR/compose.log" 2>&1 || die "Compose startup failed; inspect $RUN_DIR/compose.log"

wait_for_http "http://127.0.0.1:8123/ping" "ClickHouse" 180
wait_for_http "http://127.0.0.1:8080/realms/cosmo" "Keycloak" 180
wait_for_http "http://127.0.0.1:11000/health" "CDN" 180

log "Running control-plane migrations and the idempotent local seed..."
(
  cd "$ROOT_DIR"
  make migrate
  make seed
) >"$RUN_DIR/bootstrap.log" 2>&1 || die "Migrations or seed failed; inspect $RUN_DIR/bootstrap.log"

psql_controlplane() {
  docker compose --file "$ROOT_DIR/docker-compose.yml" --profile dev exec -T postgres \
    psql -X -q -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-controlplane}" "$@"
}

log "Enabling the prompt-to-query organization feature..."
psql_controlplane <<SQL >"$RUN_DIR/feature-flag.log"
INSERT INTO organization_features (organization_id, feature, enabled)
SELECT id, 'prompt-to-query', TRUE
FROM organizations
WHERE slug = '$ORGANIZATION_SLUG'
ON CONFLICT (organization_id, feature)
DO UPDATE SET enabled = EXCLUDED.enabled;
SQL

feature_enabled="$(psql_controlplane -Atc "SELECT COUNT(*) FROM organization_features f JOIN organizations o ON o.id = f.organization_id WHERE o.slug = '$ORGANIZATION_SLUG' AND f.feature = 'prompt-to-query' AND f.enabled = TRUE;")"
[[ "$feature_enabled" == "1" ]] || die "Could not enable prompt-to-query for organization '$ORGANIZATION_SLUG'."

log "Starting the control plane with fake Yoko configured..."
(
  cd "$ROOT_DIR/controlplane"
  exec env \
    HOST="$CONTROLPLANE_HOST" \
    PORT="$CONTROLPLANE_PORT" \
    DEBUG_SQL=false \
    PROMPT_TO_QUERY_SERVICE_ENDPOINT="http://$YOKO_HOST:$YOKO_PORT" \
    "${PNPM[@]}" exec tsx src/index.ts
) >"$RUN_DIR/controlplane.log" 2>&1 &
remember_process "$!" "controlplane"
wait_for_http "http://$CONTROLPLANE_HOST:$CONTROLPLANE_PORT/health" "control plane" 180

export COSMO_API_KEY="cosmo_669b576aaadc10ee1ae81d9193425705"
export COSMO_API_URL="http://$CONTROLPLANE_HOST:$CONTROLPLANE_PORT"
export KC_API_URL="http://127.0.0.1:8080"
export CDN_URL="http://127.0.0.1:11000"
export DO_NOT_TRACK=1

target_exists() {
  local target_name="$1"
  local target_type="$2"
  local result

  result="$(psql_controlplane -Atc "SELECT EXISTS (SELECT 1 FROM targets t JOIN namespaces n ON n.id = t.namespace_id JOIN organizations o ON o.id = t.organization_id WHERE t.name = '$target_name' AND t.type = '$target_type' AND n.name = '$NAMESPACE' AND o.slug = '$ORGANIZATION_SLUG');")"
  [[ "$result" == "t" ]]
}

log "Creating or refreshing the isolated '$GRAPH_NAME' demo graph..."
if ! target_exists "$GRAPH_NAME" "federated"; then
  wgc federated-graph create "$GRAPH_NAME" \
    --namespace "$NAMESPACE" \
    --label-matcher team=A,team=B \
    --routing-url "http://$ROUTER_HOST:$ROUTER_PORT/graphql" \
    >>"$RUN_DIR/graph-setup.log" 2>&1
else
  wgc federated-graph update "$GRAPH_NAME" \
    --namespace "$NAMESPACE" \
    --label-matcher team=A,team=B \
    --routing-url "http://$ROUTER_HOST:$ROUTER_PORT/graphql" \
    >>"$RUN_DIR/graph-setup.log" 2>&1
fi

SUBGRAPH_NAMES=(employees family hobbies products availability mood)
SUBGRAPH_DIRS=(employees family hobbies products availability mood)
SUBGRAPH_PORTS=(4001 4002 4003 4004 4007 4008)
SUBGRAPH_TEAMS=(A A B B A B)

for index in "${!SUBGRAPH_NAMES[@]}"; do
  subgraph_name="${SUBGRAPH_NAMES[$index]}"
  if ! target_exists "$subgraph_name" "subgraph"; then
    wgc subgraph create "$subgraph_name" \
      --namespace "$NAMESPACE" \
      --label "team=${SUBGRAPH_TEAMS[$index]}" \
      --routing-url "http://127.0.0.1:${SUBGRAPH_PORTS[$index]}/graphql" \
      >>"$RUN_DIR/graph-setup.log" 2>&1
  else
    wgc subgraph update "$subgraph_name" \
      --namespace "$NAMESPACE" \
      --label "team=${SUBGRAPH_TEAMS[$index]}" \
      --routing-url "http://127.0.0.1:${SUBGRAPH_PORTS[$index]}/graphql" \
      >>"$RUN_DIR/graph-setup.log" 2>&1
  fi

  wgc subgraph publish "$subgraph_name" \
    --namespace "$NAMESPACE" \
    --schema "$ROOT_DIR/demo/pkg/subgraphs/${SUBGRAPH_DIRS[$index]}/subgraph/schema.graphqls" \
    >>"$RUN_DIR/graph-setup.log" 2>&1
done

wgc federated-graph recompose "$GRAPH_NAME" \
  --namespace "$NAMESPACE" \
  --fail-on-composition-error \
  >>"$RUN_DIR/graph-setup.log" 2>&1

token_name="mcp-yoko-run-$(date +%s)-$$"
router_token="$(wgc router token create "$token_name" --graph-name "$GRAPH_NAME" --namespace "$NAMESPACE" --raw | tail -n 1 | tr -d '\r')"
[[ -n "$router_token" && "$router_token" != *[[:space:]]* ]] || die "The router token command did not return a usable token."

log "Building the router and local demo subgraphs..."
(
  cd "$ROOT_DIR/router"
  CGO_ENABLED=0 go build -o "$RUN_DIR/router" ./cmd/router
) >"$RUN_DIR/router-build.log" 2>&1 || die "Router build failed; inspect $RUN_DIR/router-build.log"
(
  cd "$ROOT_DIR/demo"
  CGO_ENABLED=0 go build -o "$RUN_DIR/subgraphs" ./cmd/all
) >"$RUN_DIR/subgraphs-build.log" 2>&1 || die "Subgraph build failed; inspect $RUN_DIR/subgraphs-build.log"

log "Starting local demo subgraphs..."
"$RUN_DIR/subgraphs" >"$RUN_DIR/subgraphs.log" 2>&1 &
remember_process "$!" "subgraphs"
wait_for_http "http://127.0.0.1:4001/" "employees subgraph" 60

log "Starting the source-built router and MCP server..."
(
  cd "$ROOT_DIR/router"
  exec env \
    CONFIG_PATH=demo.config.yaml \
    DEV_MODE=true \
    LOG_LEVEL=info \
    JSON_LOG=false \
    LISTEN_ADDR="$ROUTER_HOST:$ROUTER_PORT" \
    CONTROLPLANE_URL="http://$CONTROLPLANE_HOST:$CONTROLPLANE_PORT" \
    CDN_URL="http://127.0.0.1:11000" \
    DEFAULT_TELEMETRY_ENDPOINT="http://127.0.0.1:4318" \
    GRAPHQL_METRICS_COLLECTOR_ENDPOINT="http://127.0.0.1:4005" \
    GRAPH_API_TOKEN="$router_token" \
    ROUTER_REGISTRATION=true \
    MCP_ENABLED=true \
    MCP_GRAPH_NAME="$GRAPH_NAME" \
    MCP_SERVER_LISTEN_ADDR="$MCP_HOST:$MCP_PORT" \
    "$RUN_DIR/router"
) >"$RUN_DIR/router.log" 2>&1 &
remember_process "$!" "router"

wait_for_http "http://$ROUTER_HOST:$ROUTER_PORT/health/ready" "router" 180

tools_response="$(curl --silent --show-error --fail \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  "http://$MCP_HOST:$MCP_PORT/mcp")" || die "The router started, but its MCP tools/list request failed."
[[ "$tools_response" == *'generate_query'* ]] || die "MCP tools/list did not expose generate_query; inspect $RUN_DIR/router.log"

cat <<EOF

Local prompt-to-query MCP is ready.

  MCP endpoint:   http://$MCP_HOST:$MCP_PORT/mcp
  Router GraphQL: http://$ROUTER_HOST:$ROUTER_PORT/graphql
  Fake Yoko:      http://$YOKO_HOST:$YOKO_PORT
  Graph:          $NAMESPACE/$GRAPH_NAME
  Logs:           $RUN_DIR

Add it to Claude Code:

  claude mcp add --transport http cosmo-yoko http://$MCP_HOST:$MCP_PORT/mcp

Or make an end-to-end call with MCP Inspector:

  npx @modelcontextprotocol/inspector --cli http://$MCP_HOST:$MCP_PORT/mcp --transport http --method tools/call --tool-name generate_query --tool-arg 'prompt=List the names of all employees' --format json

The first generate_query call can take a little while because fake Yoko starts a
fresh codex exec process. Press Ctrl-C here to stop Yoko, the control plane, subgraphs,
and router. The Compose infrastructure will remain running.
EOF

monitor_processes
