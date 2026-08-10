package mcpserver

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestValidateServers(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name    string
		servers map[string]config.MCPServerEntry
		wantErr string
	}{
		{
			name: "distinct paths",
			servers: map[string]config.MCPServerEntry{
				"support": {Enabled: true, Path: "/mcp/support"},
				"billing": {Enabled: true, Path: "/billing/mcp"},
			},
		},
		{
			name: "duplicate paths",
			servers: map[string]config.MCPServerEntry{
				"support": {Enabled: true, Path: "/mcp"},
				"billing": {Enabled: true, Path: "/mcp"},
			},
			wantErr: `use the same path "/mcp"`,
		},
		{
			name: "duplicate path is allowed when one server is disabled",
			servers: map[string]config.MCPServerEntry{
				"support": {Enabled: true, Path: "/mcp"},
				"billing": {Enabled: false, Path: "/mcp"},
			},
		},
		{
			name: "missing path",
			servers: map[string]config.MCPServerEntry{
				"support": {Enabled: true},
			},
			wantErr: "path is empty",
		},
		{
			name: "trailing slash",
			servers: map[string]config.MCPServerEntry{
				"support": {Enabled: true, Path: "/mcp/"},
			},
			wantErr: "must not end with /",
		},
		{
			name:    "empty map",
			servers: map[string]config.MCPServerEntry{},
		},
		{
			name: "all servers disabled",
			servers: map[string]config.MCPServerEntry{
				"support": {Enabled: false},
				"billing": {Enabled: false, Path: "/mcp/"},
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			err := ValidateServers(tc.servers)
			if tc.wantErr == "" {
				require.NoError(t, err)
				return
			}
			require.ErrorContains(t, err, tc.wantErr)
		})
	}
}

// TestValidateServers_DeterministicOrder guards the doc comment's promise
// that ValidateServers reports the same error every time for the same
// config, even though Go randomizes map iteration order. Two enabled
// servers each have a distinct, unrelated problem, so only sorted name
// order decides which one is reported first: "alpha" sorts before "zeta",
// so alpha's trailing-slash error must always win.
//
// A single call can pass by luck against an unsorted implementation, since
// Go does not guarantee a different order on every range statement. Calling
// ValidateServers many times turns that coin flip into a near-certain
// failure for a naive `for name := range servers` implementation.
func TestValidateServers_DeterministicOrder(t *testing.T) {
	t.Parallel()

	servers := map[string]config.MCPServerEntry{
		"alpha": {Enabled: true, Path: "/mcp/"},
		"zeta":  {Enabled: true},
	}

	const wantErr = `mcp server "alpha": path "/mcp/" must not end with /`

	for i := 0; i < 100; i++ {
		err := ValidateServers(servers)
		require.EqualError(t, err, wantErr)
	}
}
