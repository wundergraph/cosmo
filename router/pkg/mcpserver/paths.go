package mcpserver

import (
	"fmt"
	"strings"
)

const (
	// MetadataPathPrefix is the RFC 9728 well-known prefix for OAuth 2.0
	// Protected Resource Metadata. The resource path is appended to it.
	MetadataPathPrefix = "/.well-known/oauth-protected-resource"

	// DefaultMountPath is the path an MCP server uses when the config sets none.
	DefaultMountPath = "/mcp"
)

// ValidateMountPath reports why p cannot serve as an MCP mount path.
//
// Mount paths must be exact ServeMux patterns. A trailing slash would make a
// subtree pattern, and a wildcard would make a conflicting pattern; either can
// capture the requests of another server sharing the mux.
func ValidateMountPath(p string) error {
	if p == "" {
		return fmt.Errorf("path is empty")
	}
	if !strings.HasPrefix(p, "/") {
		return fmt.Errorf("path %q must start with /", p)
	}
	if strings.HasPrefix(p, "//") {
		return fmt.Errorf("path %q must not start with //", p)
	}
	if len(p) > 1 && strings.HasSuffix(p, "/") {
		return fmt.Errorf("path %q must not end with /", p)
	}
	if strings.ContainsAny(p, "{}*") {
		return fmt.Errorf("path %q must not contain a wildcard", p)
	}
	if p == MetadataPathPrefix || strings.HasPrefix(p, MetadataPathPrefix+"/") {
		return fmt.Errorf("path %q is reserved for OAuth metadata", p)
	}
	return nil
}

// MetadataPath returns the RFC 9728 metadata path for a mount path.
func MetadataPath(mountPath string) string {
	if mountPath == "/" {
		return MetadataPathPrefix
	}
	return MetadataPathPrefix + mountPath
}

// ResourceIdentifier returns the OAuth 2.0 resource identifier a server
// publishes: its external origin joined to its mount path.
func ResourceIdentifier(baseURL, mountPath string) string {
	base := strings.TrimRight(baseURL, "/")
	if mountPath == "/" {
		return base + "/"
	}
	return base + mountPath
}
