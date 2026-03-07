package mcpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestExecuteGraphQL_ScopeChecking(t *testing.T) {
	t.Parallel()

	schema := parseTestSchema(t)
	fieldConfigs := testFieldConfigs()
	extractor := NewScopeExtractor(fieldConfigs, &schema)

	// Mock GraphQL backend that returns a simple response
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"ok":true}}`))
	}))
	t.Cleanup(backend.Close)

	makeServer := func(includeTokenScopes bool) *GraphQLSchemaServer {
		return &GraphQLSchemaServer{
			scopeExtractor:        extractor,
			routerGraphQLEndpoint: backend.URL,
			logger:                zap.NewNop(),
			httpClient:            backend.Client(),
			oauthConfig: &config.MCPOAuthConfiguration{
				ScopeChallengeIncludeTokenScopes: includeTokenScopes,
			},
		}
	}

	makeContext := func(scopes string) context.Context {
		claims := authentication.Claims{"sub": "test-user"}
		if scopes != "" {
			claims["scope"] = scopes
		}
		return context.WithValue(context.Background(), userClaimsContextKey, claims)
	}

	makeRequest := func(query string) *mcp.CallToolRequest {
		args, _ := json.Marshal(map[string]string{"query": query})
		return &mcp.CallToolRequest{
			Params: &mcp.CallToolParamsRaw{
				Name:      "execute_graphql",
				Arguments: args,
			},
		}
	}

	tests := []struct {
		name               string
		query              string
		tokenScopes        string
		includeTokenScopes bool
		wantError          bool
		wantContains       string
	}{
		{
			name:        "unscoped query passes",
			query:       `query { employees { id tag } }`,
			tokenScopes: "",
			wantError:   false,
		},
		{
			name:        "scoped query with matching scope passes",
			query:       `query { topSecretFederationFacts { ... on DirectiveFact { title } } }`,
			tokenScopes: "read:fact",
			wantError:   false,
		},
		{
			name:        "scoped query with alternative scope passes",
			query:       `query { topSecretFederationFacts { ... on DirectiveFact { title } } }`,
			tokenScopes: "read:all",
			wantError:   false,
		},
		{
			name:         "scoped query without scopes returns error with challenge",
			query:        `query { topSecretFederationFacts { ... on DirectiveFact { title } } }`,
			tokenScopes:  "",
			wantError:    true,
			wantContains: "read:fact",
		},
		{
			name:         "employee startDate requires AND scopes",
			query:        `query { employee(id: 1) { id startDate } }`,
			tokenScopes:  "read:employee",
			wantError:    true,
			wantContains: "read:employee read:private",
		},
		{
			name:        "employee startDate with read:all passes",
			query:       `query { employee(id: 1) { id startDate } }`,
			tokenScopes: "read:all",
			wantError:   false,
		},
		{
			name:         "empty token with AND group picks smallest group",
			query:        `query { employee(id: 1) { id startDate } }`,
			tokenScopes:  "",
			wantError:    true,
			wantContains: "read:all", // 1 missing vs 2 missing for ["read:employee", "read:private"]
		},
		{
			name:               "include token scopes in challenge",
			query:              `query { topSecretFederationFacts { ... on DirectiveFact { title } } }`,
			tokenScopes:        "mcp:connect",
			includeTokenScopes: true,
			wantError:          true,
			wantContains:       "mcp:connect read:fact",
		},
		{
			name:        "invalid query is not scope-checked",
			query:       `not a valid query {}`,
			tokenScopes: "",
			wantError:   false, // parse error means no scope check, falls through to executeGraphQLQuery
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := makeServer(tt.includeTokenScopes)
			ctx := makeContext(tt.tokenScopes)
			handler := srv.handleExecuteGraphQL()

			result, err := handler(ctx, makeRequest(tt.query))

			if tt.wantError {
				require.NoError(t, err, "handler should not return Go error for scope failures")
				require.NotNil(t, result)
				assert.True(t, result.IsError, "result should be marked as error")
				assert.Len(t, result.Content, 1)
				text := result.Content[0].(*mcp.TextContent).Text
				assert.Contains(t, text, "Insufficient scopes")
				if tt.wantContains != "" {
					assert.Contains(t, text, tt.wantContains)
				}
			} else {
				// For unscoped queries, the handler will try to call executeGraphQLQuery
				// which will fail since we don't have a real HTTP server. That's fine —
				// we just need to verify no scope error was returned.
				if result != nil && result.IsError {
					text := result.Content[0].(*mcp.TextContent).Text
					assert.NotContains(t, text, "Insufficient scopes",
						"should not fail with scope error")
				}
			}
		})
	}
}
