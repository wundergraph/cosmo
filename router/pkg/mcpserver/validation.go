package mcpserver

import (
	"fmt"
	"maps"
	"slices"

	"github.com/wundergraph/cosmo/router/pkg/config"
)

// ValidateServers checks the mcp.servers map before the router mounts anything.
//
// It only checks enabled servers, because the router never mounts a disabled
// one. Two servers may therefore share a path while one of them is off.
//
// Every mount path is an exact ServeMux pattern, so two distinct paths can
// never conflict on the mux. Checking for exact duplicates is therefore enough.
func ValidateServers(servers map[string]config.MCPServerEntry) error {
	// Sort the names so the same config always reports the same error.
	names := slices.Sorted(maps.Keys(servers))

	byPath := make(map[string]string, len(servers))

	for _, name := range names {
		server := servers[name]
		if !server.Enabled {
			continue
		}

		if err := ValidateMountPath(server.Path); err != nil {
			return fmt.Errorf("mcp server %q: %w", name, err)
		}

		if other, ok := byPath[server.Path]; ok {
			return fmt.Errorf("mcp servers %q and %q use the same path %q", other, name, server.Path)
		}

		byPath[server.Path] = name
	}

	return nil
}
