package mcpserver

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestOperationAuthorizationReload(t *testing.T) {
	t.Parallel()

	t.Run("denies newly restricted operation after HTTP authorization and challenges the next request", func(t *testing.T) {
		t.Parallel()

		// This endpoint deliberately performs no GraphQL authorization: the test
		// proves the MCP guard prevents forwarding, not production GraphQL auth.
		var calls atomic.Int32
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls.Add(1)
			_, _ = w.Write([]byte(`{"data":{"employees":[]}}`))
		}))
		t.Cleanup(upstream.Close)

		manifest := map[string]string{"list": `query ListEmployees { employees { id } }`}
		srv, err := NewGraphQLSchemaServer(t.Context(), upstream.URL,
			WithManifestOperations(func() map[string]string { return manifest }),
			WithOmitToolNamePrefix(true))
		require.NoError(t, err)
		srv.oauthConfig = &config.MCPOAuthConfiguration{Enabled: true}
		srv.authMiddleware, err = NewMCPAuthMiddleware(&mockTokenDecoder{
			decodeFunc: func(token string) (authentication.Claims, error) {
				return authentication.Claims{"sub": "user", "scope": token}, nil
			},
		}, "https://example.com/metadata", config.MCPOAuthScopesConfiguration{}, false, nil)
		require.NoError(t, err)
		schema := testSchemaDoc(t)
		require.NoError(t, srv.Reload(&schema, []*nodev1.FieldConfiguration{{
			TypeName: "Employee", FieldName: "name",
			AuthorizationConfiguration: &nodev1.AuthorizationConfiguration{
				RequiredOrScopes: []*nodev1.Scopes{{RequiredAndScopes: []string{"admin"}}},
			},
		}}, "test"))
		require.Empty(t, srv.authMiddleware.getToolScopes("list_employees"))

		dispatch := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
			return srv.server
		}, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true})
		handler := srv.authMiddleware.HTTPMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// HTTP auth has accepted the old unscoped tool; replace it before
			// the real SDK selects the operation handler for this very request.
			manifest = map[string]string{"list": listEmployeesOp}
			srv.ManifestUpdated()
			dispatch.ServeHTTP(w, r)
		}))
		call := func(scope string) *httptest.ResponseRecorder {
			req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(
				`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_employees","arguments":{}}}`))
			req.Header.Set("Authorization", "Bearer "+scope)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "application/json, text/event-stream")
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, req)
			return recorder
		}

		raced := call("read")
		require.Equal(t, http.StatusOK, raced.Code, raced.Body.String())
		var response struct {
			Result *mcp.CallToolResult `json:"result"`
		}
		require.NoError(t, json.Unmarshal(raced.Body.Bytes(), &response))
		require.NotNil(t, response.Result, raced.Body.String())
		require.True(t, response.Result.IsError)
		require.Contains(t, raced.Body.String(), "Authorization error: insufficient scopes for operation")
		require.Zero(t, calls.Load(), "the raced request must never reach GraphQL")

		next := call("read")
		require.Equal(t, http.StatusForbidden, next.Code)
		require.Contains(t, next.Header().Get("WWW-Authenticate"), `scope="admin"`)
		require.Zero(t, calls.Load())

		allowed := call("admin")
		require.Equal(t, http.StatusOK, allowed.Code, allowed.Body.String())
		require.NoError(t, json.Unmarshal(allowed.Body.Bytes(), &response))
		require.NotNil(t, response.Result)
		require.False(t, response.Result.IsError)
		require.EqualValues(t, 1, calls.Load())
	})
}
