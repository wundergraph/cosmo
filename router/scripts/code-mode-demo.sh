#!/bin/bash
set -e

# Code Mode Demo Script
# Starts: (1) demo subgraphs, (2) yoko mock server, (3) router with Code Mode

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROUTER_DIR="$(dirname "$SCRIPT_DIR")"
REPO_DIR="$(dirname "$ROUTER_DIR")"
DEMO_DIR="$REPO_DIR/demo"

COMPOSE_CONFIG="$ROUTER_DIR/__schemas/code-mode-config.json"
SCHEMA_SDL="$ROUTER_DIR/__schemas/code-mode-schema.graphql"

cleanup() {
    echo ""
    echo "Shutting down..."
    [ -n "$SUBGRAPH_PID" ] && kill $SUBGRAPH_PID 2>/dev/null || true
    [ -n "$YOKO_PID" ] && kill $YOKO_PID 2>/dev/null || true
    [ -n "$ROUTER_PID" ] && kill $ROUTER_PID 2>/dev/null || true
    wait 2>/dev/null
    echo "Done."
}
trap cleanup EXIT INT TERM

echo "=== MCP Code Mode Demo ==="
echo ""

# Step 1: Compose the supergraph schema (using code-mode-graph.yaml which excludes
# subgraphs that require Kafka/NATS/Redis infrastructure)
echo "[1/4] Composing supergraph schema..."
cd "$DEMO_DIR"
wgc router compose -i "$SCRIPT_DIR/code-mode-graph.yaml" -o "$COMPOSE_CONFIG" 2>&1

# Extract the SDL from the composed config for the yoko mock
echo "[2/4] Extracting SDL for query generation..."
# The composed config is a JSON file with an engineConfig. We need the SDL.
# Use a simple Go script to extract it, or we can just pass the subgraph schemas.
# For simplicity, concatenate the demo subgraph schemas as SDL context.
cat \
    "$DEMO_DIR/pkg/subgraphs/employees/subgraph/schema.graphqls" \
    "$DEMO_DIR/pkg/subgraphs/family/subgraph/schema.graphqls" \
    "$DEMO_DIR/pkg/subgraphs/hobbies/subgraph/schema.graphqls" \
    "$DEMO_DIR/pkg/subgraphs/products/subgraph/schema.graphqls" \
    "$DEMO_DIR/pkg/subgraphs/availability/subgraph/schema.graphqls" \
    "$DEMO_DIR/pkg/subgraphs/mood/subgraph/schema.graphqls" \
    "$DEMO_DIR/pkg/subgraphs/countries/subgraph/schema.graphqls" \
    > "$SCHEMA_SDL"
echo "  SDL written to $SCHEMA_SDL"

# Step 2: Start demo subgraphs
echo "[3/4] Starting demo subgraphs..."
cd "$DEMO_DIR"
go run cmd/all/main.go &
SUBGRAPH_PID=$!
echo "  Subgraphs starting (PID: $SUBGRAPH_PID)"
sleep 3  # Give subgraphs time to start

# Step 3: Start yoko mock server
echo "[4/4] Starting Yoko mock server..."
cd "$ROUTER_DIR"
go run cmd/yoko-mock/main.go --addr localhost:5030 --schema "$SCHEMA_SDL" &
YOKO_PID=$!
echo "  Yoko mock server starting (PID: $YOKO_PID)"
sleep 1

# Step 4: Start the router with Code Mode
echo ""
echo "Starting router with Code Mode..."
echo ""
cd "$ROUTER_DIR"
EXECUTION_CONFIG_FILE_PATH="$COMPOSE_CONFIG" \
CONFIG_PATH=code-mode-demo.config.yaml \
LISTEN_ADDR=localhost:3002 \
LOG_LEVEL=info \
DEV_MODE=true \
go run cmd/router/main.go &
ROUTER_PID=$!

echo ""
echo "============================================"
echo " MCP Code Mode Demo Running"
echo "============================================"
echo ""
echo " Router GraphQL:     http://localhost:3002/graphql"
echo " MCP Code Mode Server: http://localhost:5027/mcp"
echo " MCP Tools Server:   http://localhost:5025/mcp"
echo " Yoko Mock Server:   http://localhost:5030"
echo ""
echo " To use with Claude Code, add this to your MCP config:"
echo ""
echo '   "cosmo-code-mode": {'
echo '     "type": "streamable-http",'
echo '     "url": "http://localhost:5027/mcp"'
echo '   }'
echo ""
echo " Press Ctrl+C to stop all services"
echo "============================================"
echo ""
echo " Example prompts to try:"
echo ""
echo '  1. "Prepare the Cosmo team for demo day: set everyone to'
echo '     available and happy, tag them demo-ready. Tell me what changed."'
echo ""
echo '  2. "Which SDK team members dont program in Go or TypeScript?'
echo '     Tag them needs-go-training."'
echo ""
echo '  3. "Rank employees for a Go conference in Germany. Score:'
echo '     programs in Go (+3), based in Germany (+2), has traveled (+1),'
echo '     available (+1)."'
echo ""
echo '  4. "Build a pet census: count by species, list exotic pets,'
echo '     and who has the most."'
echo ""
echo '  5. "For each programming language the team knows, list who'
echo '     knows it and which products they work on. Flag single'
echo '     points of failure."'
echo ""

wait
