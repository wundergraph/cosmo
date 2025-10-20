package mcpserver

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestFilterHeaders(t *testing.T) {
	tests := []struct {
		name                    string
		forwardHeadersEnabled   bool
		forwardHeadersAllowList []string
		inputHeaders            http.Header
		expectedHeaders         http.Header
	}{
		{
			name:                    "disabled forwarding returns empty headers",
			forwardHeadersEnabled:   false,
			forwardHeadersAllowList: []string{"Authorization"},
			inputHeaders: http.Header{
				"Authorization": []string{"Bearer token123"},
				"X-Tenant-ID":   []string{"tenant-1"},
			},
			expectedHeaders: http.Header{},
		},
		{
			name:                    "empty allowlist returns empty headers",
			forwardHeadersEnabled:   true,
			forwardHeadersAllowList: []string{},
			inputHeaders: http.Header{
				"Authorization": []string{"Bearer token123"},
				"X-Tenant-ID":   []string{"tenant-1"},
			},
			expectedHeaders: http.Header{},
		},
		{
			name:                    "exact match case insensitive",
			forwardHeadersEnabled:   true,
			forwardHeadersAllowList: []string{"authorization", "x-tenant-id"},
			inputHeaders: http.Header{
				"Authorization": []string{"Bearer token123"},
				"X-Tenant-ID":   []string{"tenant-1"},
				"X-Trace-ID":    []string{"trace-123"},
			},
			expectedHeaders: http.Header{
				"Authorization": []string{"Bearer token123"},
				"X-Tenant-ID":   []string{"tenant-1"},
			},
		},
		{
			name:                    "regex pattern matching",
			forwardHeadersEnabled:   true,
			forwardHeadersAllowList: []string{"X-.*"},
			inputHeaders: http.Header{
				"Authorization": []string{"Bearer token123"},
				"X-Tenant-ID":   []string{"tenant-1"},
				"X-Trace-ID":    []string{"trace-123"},
				"X-Custom":      []string{"custom-value"},
			},
			expectedHeaders: http.Header{
				"X-Tenant-ID": []string{"tenant-1"},
				"X-Trace-ID":  []string{"trace-123"},
				"X-Custom":    []string{"custom-value"},
			},
		},
		{
			name:                    "mixed exact and regex patterns",
			forwardHeadersEnabled:   true,
			forwardHeadersAllowList: []string{"Authorization", "X-.*"},
			inputHeaders: http.Header{
				"Authorization": []string{"Bearer token123"},
				"X-Tenant-ID":   []string{"tenant-1"},
				"X-Trace-ID":    []string{"trace-123"},
				"Content-Type":  []string{"application/json"},
			},
			expectedHeaders: http.Header{
				"Authorization": []string{"Bearer token123"},
				"X-Tenant-ID":   []string{"tenant-1"},
				"X-Trace-ID":    []string{"trace-123"},
			},
		},
		{
			name:                    "multiple values for same header",
			forwardHeadersEnabled:   true,
			forwardHeadersAllowList: []string{"X-Custom"},
			inputHeaders: http.Header{
				"X-Custom": []string{"value1", "value2", "value3"},
			},
			expectedHeaders: http.Header{
				"X-Custom": []string{"value1", "value2", "value3"},
			},
		},
		{
			name:                    "no matching headers",
			forwardHeadersEnabled:   true,
			forwardHeadersAllowList: []string{"X-Missing"},
			inputHeaders: http.Header{
				"Authorization": []string{"Bearer token123"},
				"Content-Type":  []string{"application/json"},
			},
			expectedHeaders: http.Header{},
		},
		{
			name:                    "invalid regex treated as exact match",
			forwardHeadersEnabled:   true,
			forwardHeadersAllowList: []string{"[invalid"},
			inputHeaders: http.Header{
				"[invalid":     []string{"value1"},
				"Authorization": []string{"Bearer token123"},
			},
			expectedHeaders: http.Header{
				"[invalid": []string{"value1"},
			},
		},
		{
			name:                    "case insensitive regex matching",
			forwardHeadersEnabled:   true,
			forwardHeadersAllowList: []string{"x-.*"},
			inputHeaders: http.Header{
				"X-Tenant-ID": []string{"tenant-1"},
				"x-trace-id":  []string{"trace-123"},
				"X-CUSTOM":    []string{"custom-value"},
			},
			expectedHeaders: http.Header{
				"X-Tenant-ID": []string{"tenant-1"},
				"x-trace-id":  []string{"trace-123"},
				"X-CUSTOM":    []string{"custom-value"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := &GraphQLSchemaServer{
				forwardHeadersEnabled:   tt.forwardHeadersEnabled,
				forwardHeadersAllowList: tt.forwardHeadersAllowList,
				logger:                  zap.NewNop(),
			}

			result := server.filterHeaders(tt.inputHeaders)

			assert.Equal(t, len(tt.expectedHeaders), len(result), "number of headers should match")
			for key, expectedValues := range tt.expectedHeaders {
				actualValues, ok := result[key]
				assert.True(t, ok, "header %s should be present", key)
				assert.Equal(t, expectedValues, actualValues, "values for header %s should match", key)
			}

			// Ensure no extra headers are present
			for key := range result {
				_, ok := tt.expectedHeaders[key]
				assert.True(t, ok, "unexpected header %s in result", key)
			}
		})
	}
}

func TestWithForwardHeaders(t *testing.T) {
	tests := []struct {
		name        string
		enabled     bool
		allowList   []string
		wantEnabled bool
		wantList    []string
	}{
		{
			name:        "enabled with allowlist",
			enabled:     true,
			allowList:   []string{"Authorization", "X-Tenant-ID"},
			wantEnabled: true,
			wantList:    []string{"Authorization", "X-Tenant-ID"},
		},
		{
			name:        "disabled with allowlist",
			enabled:     false,
			allowList:   []string{"Authorization"},
			wantEnabled: false,
			wantList:    []string{"Authorization"},
		},
		{
			name:        "enabled with empty allowlist",
			enabled:     true,
			allowList:   []string{},
			wantEnabled: true,
			wantList:    []string{},
		},
		{
			name:        "enabled with nil allowlist",
			enabled:     true,
			allowList:   nil,
			wantEnabled: true,
			wantList:    nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			opts := &Options{}
			optFunc := WithForwardHeaders(tt.enabled, tt.allowList)
			optFunc(opts)

			assert.Equal(t, tt.wantEnabled, opts.ForwardHeadersEnabled)
			assert.Equal(t, tt.wantList, opts.ForwardHeadersAllowList)
		})
	}
}

func TestNewGraphQLSchemaServer_ForwardHeadersDefaults(t *testing.T) {
	server, err := NewGraphQLSchemaServer("http://localhost:3000/graphql")
	require.NoError(t, err)
	require.NotNil(t, server)

	// Check that forward headers are disabled by default
	assert.False(t, server.forwardHeadersEnabled)
	assert.Nil(t, server.forwardHeadersAllowList)
}

func TestNewGraphQLSchemaServer_WithForwardHeaders(t *testing.T) {
	allowList := []string{"Authorization", "X-Tenant-ID", "X-.*"}
	server, err := NewGraphQLSchemaServer(
		"http://localhost:3000/graphql",
		WithForwardHeaders(true, allowList),
	)
	require.NoError(t, err)
	require.NotNil(t, server)

	assert.True(t, server.forwardHeadersEnabled)
	assert.Equal(t, allowList, server.forwardHeadersAllowList)
}

func TestHeadersFromContext(t *testing.T) {
	tests := []struct {
		name           string
		setupContext   func() http.Header
		expectedOk     bool
		expectedHeader http.Header
	}{
		{
			name: "headers present in context",
			setupContext: func() http.Header {
				return http.Header{
					"Authorization": []string{"Bearer token123"},
					"X-Tenant-Id":   []string{"tenant-1"}, // Note: Go canonicalizes to X-Tenant-Id
				}
			},
			expectedOk: true,
			expectedHeader: http.Header{
				"Authorization": []string{"Bearer token123"},
				"X-Tenant-Id":   []string{"tenant-1"}, // Note: Go canonicalizes to X-Tenant-Id
			},
		},
		{
			name: "empty headers in context",
			setupContext: func() http.Header {
				return http.Header{}
			},
			expectedOk:     true,
			expectedHeader: http.Header{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			headers := tt.setupContext()
			req, err := http.NewRequest("GET", "http://example.com", nil)
			require.NoError(t, err)

			for key, values := range headers {
				for _, value := range values {
					req.Header.Add(key, value)
				}
			}

			ctx := headersFromRequest(req.Context(), req)
			retrievedHeaders, ok := headersFromContext(ctx)

			assert.Equal(t, tt.expectedOk, ok)
			if tt.expectedOk {
				assert.Equal(t, tt.expectedHeader, retrievedHeaders)
			}
		})
	}
}