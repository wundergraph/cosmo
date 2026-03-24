package mcpserver

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestMCPAuthMiddleware_ExecuteGraphQLScopes(t *testing.T) {
	t.Parallel()

	const testMetadataURL = "http://localhost:5025/.well-known/oauth-protected-resource/mcp"

	schema := parseTestSchema(t)
	fieldConfigs := testFieldConfigs()
	extractor := NewScopeExtractor(fieldConfigs, &schema)

	validDecoder := &mockTokenDecoder{
		decodeFunc: func(token string) (authentication.Claims, error) {
			switch token {
			case "no-extra-scopes":
				return authentication.Claims{"sub": "user1", "scope": "mcp:connect mcp:tools:write"}, nil
			case "has-read-fact":
				return authentication.Claims{"sub": "user2", "scope": "mcp:connect mcp:tools:write read:fact"}, nil
			case "has-read-all":
				return authentication.Claims{"sub": "user3", "scope": "mcp:connect mcp:tools:write read:all"}, nil
			case "has-read-employee":
				return authentication.Claims{"sub": "user4", "scope": "mcp:connect mcp:tools:write read:employee"}, nil
			case "has-read-employee-private":
				return authentication.Claims{"sub": "user5", "scope": "mcp:connect mcp:tools:write read:employee read:private"}, nil
			case "has-mcp-connect":
				return authentication.Claims{"sub": "user6", "scope": "mcp:connect mcp:tools:write"}, nil
			default:
				return nil, errors.New("invalid token")
			}
		},
	}

	scopes := config.MCPOAuthScopesConfiguration{
		Initialize: []string{"mcp:connect"},
		ToolsCall:  []string{"mcp:tools:write"},
	}

	makeBody := func(query string) string {
		// Escape quotes in query for JSON
		escaped := strings.ReplaceAll(query, `"`, `\"`)
		return `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_graphql","arguments":{"query":"` + escaped + `"}}}`
	}

	tests := []struct {
		name                             string
		token                            string
		query                            string
		scopeChallengeIncludeTokenScopes bool
		wantStatusCode                   int
		wantScope                        string
		wantContains                     string
	}{
		{
			name:           "unscoped query passes",
			token:          "no-extra-scopes",
			query:          `query { employees { id tag } }`,
			wantStatusCode: 200,
		},
		{
			name:           "scoped query with matching scope passes",
			token:          "has-read-fact",
			query:          `query { topSecretFederationFacts { ... on DirectiveFact { title } } }`,
			wantStatusCode: 200,
		},
		{
			name:           "scoped query with alternative scope (read:all) passes",
			token:          "has-read-all",
			query:          `query { topSecretFederationFacts { ... on DirectiveFact { title } } }`,
			wantStatusCode: 200,
		},
		{
			name:           "scoped query without required scope returns 403",
			token:          "no-extra-scopes",
			query:          `query { topSecretFederationFacts { ... on DirectiveFact { title } } }`,
			wantStatusCode: 403,
			wantScope:      `scope="read:fact"`,
			wantContains:   `error_description="insufficient scopes for tool execute_graphql"`,
		},
		{
			name:           "AND scopes - token has one of two required",
			token:          "has-read-employee",
			query:          `query { employee(id: 1) { id startDate } }`,
			wantStatusCode: 403,
			wantScope:      `scope="read:employee read:private"`,
		},
		{
			name:           "AND scopes - token satisfies full AND group",
			token:          "has-read-employee-private",
			query:          `query { employee(id: 1) { id startDate } }`,
			wantStatusCode: 200,
		},
		{
			name:           "AND scopes - read:all satisfies alternative group",
			token:          "has-read-all",
			query:          `query { employee(id: 1) { id startDate } }`,
			wantStatusCode: 200,
		},
		{
			name:           "empty relevant scopes picks smallest group",
			token:          "no-extra-scopes",
			query:          `query { employee(id: 1) { id startDate } }`,
			wantStatusCode: 403,
			// Group 1: 2 missing, Group 2: 1 missing → Group 2 wins
			wantScope: `scope="read:all"`,
		},
		{
			name:                             "include token scopes in challenge",
			token:                            "has-mcp-connect",
			query:                            `query { topSecretFederationFacts { ... on DirectiveFact { title } } }`,
			scopeChallengeIncludeTokenScopes: true,
			wantStatusCode:                   403,
			wantScope:                        `scope="mcp:connect mcp:tools:write read:fact"`,
		},
		{
			name:           "invalid query passes through (not scope-checked)",
			token:          "no-extra-scopes",
			query:          `not a valid query {}`,
			wantStatusCode: 200,
		},
		{
			name:           "empty query passes through",
			token:          "no-extra-scopes",
			query:          ``,
			wantStatusCode: 200,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			middleware, err := NewMCPAuthMiddleware(validDecoder, testMetadataURL, scopes, tt.scopeChallengeIncludeTokenScopes)
			assert.NoError(t, err)

			// Set scope extractor for execute_graphql runtime checking
			middleware.SetScopeExtractor(extractor)

			handler := middleware.HTTPMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(200)
			}))

			req, _ := http.NewRequest("POST", "/mcp", strings.NewReader(makeBody(tt.query)))
			req.Header.Set("Authorization", "Bearer "+tt.token)
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)

			assert.Equal(t, tt.wantStatusCode, rr.Code)
			if tt.wantScope != "" {
				wwwAuth := rr.Header().Get("WWW-Authenticate")
				assert.Contains(t, wwwAuth, tt.wantScope, "WWW-Authenticate header should contain expected scope")
			}
			if tt.wantContains != "" {
				wwwAuth := rr.Header().Get("WWW-Authenticate")
				assert.Contains(t, wwwAuth, tt.wantContains, "WWW-Authenticate header should contain expected string")
			}
		})
	}
}

func TestMCPAuthMiddleware_ExecuteGraphQLNoExtractor(t *testing.T) {
	t.Parallel()

	const testMetadataURL = "http://localhost:5025/.well-known/oauth-protected-resource/mcp"

	decoder := &mockTokenDecoder{
		decodeFunc: func(token string) (authentication.Claims, error) {
			return authentication.Claims{"sub": "user1", "scope": "mcp:connect mcp:tools:write"}, nil
		},
	}

	scopes := config.MCPOAuthScopesConfiguration{
		Initialize: []string{"mcp:connect"},
		ToolsCall:  []string{"mcp:tools:write"},
	}

	middleware, err := NewMCPAuthMiddleware(decoder, testMetadataURL, scopes, false)
	assert.NoError(t, err)
	// Deliberately NOT setting a scope extractor

	handler := middleware.HTTPMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))

	// Scoped query should pass through when no extractor is set
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_graphql","arguments":{"query":"query { topSecretFederationFacts { ... on DirectiveFact { title } } }"}}}`
	req, _ := http.NewRequest("POST", "/mcp", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer test")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	assert.Equal(t, 200, rr.Code, "should pass through when no scope extractor is configured")
}
