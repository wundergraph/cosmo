package integration

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// postServerDiscover sends a raw SEP-2575 server/discover JSON-RPC request to
// the MCP endpoint and returns the decoded JSON-RPC result object. The request
// is intentionally sessionless: server/discover is designed to be callable
// without the legacy initialize handshake.
func postServerDiscover(t *testing.T, xEnv *testenv.Environment) map[string]interface{} {
	t.Helper()

	discoverRequest := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "server/discover",
		"params": map[string]interface{}{
			"_meta": map[string]interface{}{
				"io.modelcontextprotocol/protocolVersion": "2026-07-28",
				"io.modelcontextprotocol/clientInfo": map[string]interface{}{
					"name":    "test-client",
					"version": "1.0.0",
				},
				"io.modelcontextprotocol/clientCapabilities": map[string]interface{}{},
			},
		},
	}

	requestBody, err := json.Marshal(discoverRequest)
	require.NoError(t, err)

	req, err := http.NewRequest("POST", xEnv.GetMCPServerAddr(), bytes.NewReader(requestBody))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("Mcp-Protocol-Version", "2026-07-28")
	req.Header.Set("Mcp-Method", "server/discover")

	resp, err := xEnv.RouterClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close() //nolint:errcheck

	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode, "server/discover should succeed, body: %s", string(body))

	// The streamable HTTP transport may reply with a plain JSON body or an SSE
	// stream depending on negotiation; support both.
	payload := string(body)
	if strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream") {
		for _, line := range strings.Split(payload, "\n") {
			if strings.HasPrefix(line, "data:") {
				payload = strings.TrimSpace(strings.TrimPrefix(line, "data:"))
				break
			}
		}
	}

	var rpcResponse struct {
		Result map[string]interface{} `json:"result"`
		Error  *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	require.NoError(t, json.Unmarshal([]byte(payload), &rpcResponse))
	require.Nil(t, rpcResponse.Error, "server/discover returned a JSON-RPC error")
	require.NotNil(t, rpcResponse.Result)

	return rpcResponse.Result
}

func TestMCPServerDiscover(t *testing.T) {
	t.Run("returns configured instructions", func(t *testing.T) {
		const instructions = "Prefer the operation tools over execute_graphql."

		testenv.Run(t, &testenv.Config{
			MCP: config.MCPConfiguration{
				Enabled: true,
				Server: config.MCPServer{
					Discover: config.MCPDiscoverConfig{
						Instructions: instructions,
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			result := postServerDiscover(t, xEnv)

			assert.Equal(t, instructions, result["instructions"])
		})
	})

	t.Run("returns mandatory discovery fields", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			MCP: config.MCPConfiguration{
				Enabled: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			result := postServerDiscover(t, xEnv)

			assert.Equal(t, "complete", result["resultType"])
			assert.NotEmpty(t, result["supportedVersions"])
			assert.Contains(t, result, "ttlMs")
			assert.Equal(t, "public", result["cacheScope"])
			assert.NotEmpty(t, result["capabilities"])
		})
	})

	t.Run("advertises protocol version 2026-07-28 in stateless mode", func(t *testing.T) {
		// The go-sdk streamable HTTP transport only serves protocol version
		// 2026-07-28 (which replaces sessions with per-request _meta) when the
		// server runs stateless; stateful servers cap at 2025-11-25.
		//
		// Note: testenv builds the config struct literally, so Session.Stateless
		// is Go's zero value (false = stateful) unless set here. Production
		// yaml/env config defaults to stateless: true, making 2026-07-28 the
		// out-of-the-box behavior.
		testenv.Run(t, &testenv.Config{
			MCP: config.MCPConfiguration{
				Enabled: true,
				Session: config.MCPSessionConfig{
					Stateless: true,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			result := postServerDiscover(t, xEnv)

			assert.Contains(t, result["supportedVersions"], "2026-07-28")
		})
	})
}

func TestMCPServerInfoVersion(t *testing.T) {
	t.Run("uses configured server version", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			MCP: config.MCPConfiguration{
				Enabled: true,
				Server: config.MCPServer{
					Version: "9.9.9",
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			result := postServerDiscover(t, xEnv)

			meta, ok := result["_meta"].(map[string]interface{})
			require.True(t, ok, "discover result should carry _meta")
			serverInfo, ok := meta["io.modelcontextprotocol/serverInfo"].(map[string]interface{})
			require.True(t, ok, "_meta should carry serverInfo")
			assert.Equal(t, "9.9.9", serverInfo["version"])
		})
	})

	t.Run("defaults to router version", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			MCP: config.MCPConfiguration{
				Enabled: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			result := postServerDiscover(t, xEnv)

			meta, ok := result["_meta"].(map[string]interface{})
			require.True(t, ok, "discover result should carry _meta")
			serverInfo, ok := meta["io.modelcontextprotocol/serverInfo"].(map[string]interface{})
			require.True(t, ok, "_meta should carry serverInfo")
			assert.Equal(t, core.Version, serverInfo["version"])
		})
	})
}
