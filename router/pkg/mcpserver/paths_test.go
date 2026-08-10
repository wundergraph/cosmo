package mcpserver

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidateMountPath(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name    string
		path    string
		wantErr string
	}{
		{name: "simple", path: "/mcp"},
		{name: "nested", path: "/billing/mcp"},
		{name: "root", path: "/"},
		{name: "empty", path: "", wantErr: "path is empty"},
		{name: "no leading slash", path: "mcp", wantErr: "must start with /"},
		{name: "trailing slash", path: "/mcp/", wantErr: "must not end with /"},
		{name: "wildcard", path: "/mcp/{id}", wantErr: "must not contain"},
		{name: "reserved metadata prefix", path: "/.well-known/oauth-protected-resource/x", wantErr: "reserved"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			err := ValidateMountPath(tc.path)
			if tc.wantErr == "" {
				require.NoError(t, err)
				return
			}
			require.ErrorContains(t, err, tc.wantErr)
		})
	}
}

func TestMetadataPath(t *testing.T) {
	t.Parallel()

	require.Equal(t, "/.well-known/oauth-protected-resource/mcp", MetadataPath("/mcp"))
	require.Equal(t, "/.well-known/oauth-protected-resource/billing/mcp", MetadataPath("/billing/mcp"))
	require.Equal(t, "/.well-known/oauth-protected-resource", MetadataPath("/"))
}

func TestResourceIdentifier(t *testing.T) {
	t.Parallel()

	require.Equal(t, "https://example.com/mcp", ResourceIdentifier("https://example.com", "/mcp"))
	require.Equal(t, "https://example.com/billing/mcp", ResourceIdentifier("https://example.com/", "/billing/mcp"))
	require.Equal(t, "https://example.com/", ResourceIdentifier("https://example.com", "/"))
}
