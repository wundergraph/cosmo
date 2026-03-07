package yokoclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClient_Generate_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "POST", r.Method)
		assert.Equal(t, "/v1/generate", r.URL.Path)
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))

		var req generateRequest
		require.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		assert.Equal(t, "find users", req.Prompt)
		assert.Equal(t, "hash123", req.SchemaHash)

		resp := generateResponse{
			Queries: []QueryResult{
				{
					Query:       "{ users { id name } }",
					Description: "Get all users",
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, AuthConfig{Type: "static", StaticToken: "tok"}, 5*time.Second, nil)
	results, err := c.Generate(context.Background(), "find users", "hash123")
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, "{ users { id name } }", results[0].Query)
	assert.Equal(t, "Get all users", results[0].Description)
}

func TestClient_Generate_BearerTokenSent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer my-token", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(generateResponse{Queries: []QueryResult{}})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, AuthConfig{Type: "static", StaticToken: "my-token"}, 5*time.Second, nil)
	_, err := c.Generate(context.Background(), "test", "hash")
	require.NoError(t, err)
}

func TestClient_Generate_EmptyPrompt(t *testing.T) {
	c := NewClient("http://unused", AuthConfig{}, 5*time.Second, nil)
	_, err := c.Generate(context.Background(), "", "hash")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "prompt cannot be empty")
}

func TestClient_Generate_WhitespacePrompt(t *testing.T) {
	c := NewClient("http://unused", AuthConfig{}, 5*time.Second, nil)
	_, err := c.Generate(context.Background(), "   \n\t  ", "hash")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "prompt cannot be empty")
}

func TestClient_Generate_Error400(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(errorResponse{
			Error:   "Could not generate query",
			Details: "No matching types",
		})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, AuthConfig{}, 5*time.Second, nil)
	_, err := c.Generate(context.Background(), "test", "hash")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "HTTP 400")
	assert.Contains(t, err.Error(), "Could not generate query")
	assert.Contains(t, err.Error(), "No matching types")
}

func TestClient_Generate_Error400_NoDetails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(errorResponse{Error: "Bad request"})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, AuthConfig{}, 5*time.Second, nil)
	_, err := c.Generate(context.Background(), "test", "hash")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Bad request")
	assert.NotContains(t, err.Error(), "—")
}

func TestClient_Generate_Error500(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal error"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, AuthConfig{}, 5*time.Second, nil)
	_, err := c.Generate(context.Background(), "test", "hash")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "HTTP 500")
}

func TestClient_Generate_NetworkError(t *testing.T) {
	c := NewClient("http://127.0.0.1:1", AuthConfig{}, 1*time.Second, nil)
	_, err := c.Generate(context.Background(), "test", "hash")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "request failed")
}

func TestClient_Generate_Timeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, AuthConfig{}, 100*time.Millisecond, nil)
	_, err := c.Generate(context.Background(), "test", "hash")
	require.Error(t, err)
}

func TestClient_Generate_ContextCancelled(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	c := NewClient(srv.URL, AuthConfig{}, 5*time.Second, nil)
	_, err := c.Generate(ctx, "test", "hash")
	require.Error(t, err)
}

func TestClient_Generate_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("not json"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, AuthConfig{}, 5*time.Second, nil)
	_, err := c.Generate(context.Background(), "test", "hash")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to parse response")
}

func TestClient_Generate_WithVariables(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := generateResponse{
			Queries: []QueryResult{
				{
					Query:       "query($id: ID!) { user(id: $id) { name } }",
					Variables:   map[string]any{"id": "123"},
					Description: "Get user by ID",
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, AuthConfig{}, 5*time.Second, nil)
	results, err := c.Generate(context.Background(), "find user 123", "hash")
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, "123", results[0].Variables["id"])
}

func TestClient_Generate_JWTAuth(t *testing.T) {
	// Token endpoint
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "application/x-www-form-urlencoded", r.Header.Get("Content-Type"))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"access_token": "jwt-token-abc",
			"expires_in":   3600,
		})
	}))
	defer tokenSrv.Close()

	// API endpoint
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer jwt-token-abc", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(generateResponse{Queries: []QueryResult{}})
	}))
	defer apiSrv.Close()

	c := NewClient(apiSrv.URL, AuthConfig{
		Type:          "jwt",
		TokenEndpoint: tokenSrv.URL,
		ClientID:      "client-id",
		ClientSecret:  "client-secret",
	}, 5*time.Second, nil)

	_, err := c.Generate(context.Background(), "test", "hash")
	require.NoError(t, err)
}

func TestClient_Generate_JWTAuth_TokenCached(t *testing.T) {
	var tokenRequests int32

	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&tokenRequests, 1)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"access_token": "cached-token",
			"expires_in":   3600,
		})
	}))
	defer tokenSrv.Close()

	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(generateResponse{Queries: []QueryResult{}})
	}))
	defer apiSrv.Close()

	c := NewClient(apiSrv.URL, AuthConfig{
		Type:          "jwt",
		TokenEndpoint: tokenSrv.URL,
		ClientID:      "cid",
		ClientSecret:  "csec",
	}, 5*time.Second, nil)

	// Make two requests — token should only be fetched once
	_, err := c.Generate(context.Background(), "test1", "hash")
	require.NoError(t, err)
	_, err = c.Generate(context.Background(), "test2", "hash")
	require.NoError(t, err)

	assert.Equal(t, int32(1), atomic.LoadInt32(&tokenRequests))
}

func TestClient_Generate_JWTAuth_NoTokenEndpoint(t *testing.T) {
	c := NewClient("http://unused", AuthConfig{
		Type: "jwt",
	}, 5*time.Second, nil)

	_, err := c.Generate(context.Background(), "test", "hash")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "token endpoint")
}

func TestClient_Generate_JWTAuth_TokenError(t *testing.T) {
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte("invalid credentials"))
	}))
	defer tokenSrv.Close()

	c := NewClient("http://unused", AuthConfig{
		Type:          "jwt",
		TokenEndpoint: tokenSrv.URL,
		ClientID:      "cid",
		ClientSecret:  "csec",
	}, 5*time.Second, nil)

	_, err := c.Generate(context.Background(), "test", "hash")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "token request failed")
}

func TestClient_Generate_UnsupportedAuthType(t *testing.T) {
	c := NewClient("http://unused", AuthConfig{
		Type: "oauth2",
	}, 5*time.Second, nil)

	_, err := c.Generate(context.Background(), "test", "hash")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported auth type")
}

func TestClient_Generate_TrailingSlashEndpoint(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1/generate", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(generateResponse{Queries: []QueryResult{}})
	}))
	defer srv.Close()

	c := NewClient(srv.URL+"/", AuthConfig{}, 5*time.Second, nil)
	_, err := c.Generate(context.Background(), "test", "hash")
	require.NoError(t, err)
}

func TestClient_Generate_EmptyStaticToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// No Authorization header when token is empty
		assert.Equal(t, "", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(generateResponse{Queries: []QueryResult{}})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, AuthConfig{Type: "static"}, 5*time.Second, nil)
	_, err := c.Generate(context.Background(), "test", "hash")
	require.NoError(t, err)
}

func TestClient_Generate_Error400_NonJSONBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("plain text error"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, AuthConfig{}, 5*time.Second, nil)
	_, err := c.Generate(context.Background(), "test", "hash")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "plain text error")
}
