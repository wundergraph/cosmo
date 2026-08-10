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
