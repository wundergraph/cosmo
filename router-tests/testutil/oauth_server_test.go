package testutil

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOAuthTestServer_ASMetadata(t *testing.T) {
	srv, err := NewOAuthTestServer(t, nil)
	require.NoError(t, err)
	defer srv.Close()

	resp, err := http.Get(srv.Issuer() + "/.well-known/oauth-authorization-server")
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var meta map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&meta))

	assert.Equal(t, srv.Issuer(), meta["issuer"])
	assert.Equal(t, srv.Issuer()+"/token", meta["token_endpoint"])
	assert.Equal(t, srv.Issuer()+"/register", meta["registration_endpoint"])
	assert.Equal(t, srv.Issuer()+"/authorize", meta["authorization_endpoint"])
	assert.Equal(t, srv.JWKSURL(), meta["jwks_uri"])
}

func TestOAuthTestServer_ClientCredentials(t *testing.T) {
	srv, err := NewOAuthTestServer(t, &OAuthTestServerOptions{
		PreRegisteredClients: []*OAuthClient{
			{
				ClientID:     "test-client",
				ClientSecret: "test-secret",
				GrantTypes:   []string{"client_credentials"},
				Scope:        "mcp:tools:read mcp:tools:write",
			},
		},
	})
	require.NoError(t, err)
	defer srv.Close()

	t.Run("valid credentials with Basic auth", func(t *testing.T) {
		form := url.Values{"grant_type": {"client_credentials"}}
		req, err := http.NewRequest(http.MethodPost, srv.TokenEndpoint(), strings.NewReader(form.Encode()))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.SetBasicAuth("test-client", "test-secret")

		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var tokenResp map[string]any
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&tokenResp))

		assert.Equal(t, "Bearer", tokenResp["token_type"])
		assert.NotEmpty(t, tokenResp["access_token"])
		assert.Equal(t, "mcp:tools:read mcp:tools:write", tokenResp["scope"])
	})

	t.Run("valid credentials with POST body", func(t *testing.T) {
		form := url.Values{
			"grant_type":    {"client_credentials"},
			"client_id":     {"test-client"},
			"client_secret": {"test-secret"},
		}
		resp, err := http.Post(srv.TokenEndpoint(), "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode)
	})

	t.Run("scope override", func(t *testing.T) {
		form := url.Values{
			"grant_type":    {"client_credentials"},
			"client_id":     {"test-client"},
			"client_secret": {"test-secret"},
			"scope":         {"mcp:admin"},
		}
		resp, err := http.Post(srv.TokenEndpoint(), "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
		require.NoError(t, err)
		defer resp.Body.Close()

		var tokenResp map[string]any
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&tokenResp))
		assert.Equal(t, "mcp:admin", tokenResp["scope"])
	})

	t.Run("bad secret rejected", func(t *testing.T) {
		form := url.Values{
			"grant_type":    {"client_credentials"},
			"client_id":     {"test-client"},
			"client_secret": {"wrong"},
		}
		resp, err := http.Post(srv.TokenEndpoint(), "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	})

	t.Run("unknown client rejected", func(t *testing.T) {
		form := url.Values{
			"grant_type":    {"client_credentials"},
			"client_id":     {"ghost"},
			"client_secret": {"nope"},
		}
		resp, err := http.Post(srv.TokenEndpoint(), "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	})
}

func TestOAuthTestServer_DynamicRegistration(t *testing.T) {
	srv, err := NewOAuthTestServer(t, nil)
	require.NoError(t, err)
	defer srv.Close()

	// Register a client dynamically
	body := `{"client_name":"my-test","grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic"}`
	resp, err := http.Post(srv.Issuer()+"/register", "application/json", strings.NewReader(body))
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusCreated, resp.StatusCode)

	var regResp map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&regResp))

	clientID, _ := regResp["client_id"].(string)
	clientSecret, _ := regResp["client_secret"].(string)
	require.NotEmpty(t, clientID)
	require.NotEmpty(t, clientSecret)

	// Use the dynamically registered client to get a token
	form := url.Values{"grant_type": {"client_credentials"}}
	req, err := http.NewRequest(http.MethodPost, srv.TokenEndpoint(), strings.NewReader(form.Encode()))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(clientID, clientSecret)

	tokenResp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer tokenResp.Body.Close()

	assert.Equal(t, http.StatusOK, tokenResp.StatusCode)
}

func TestOAuthTestServer_AuthorizationCodeFlow(t *testing.T) {
	srv, err := NewOAuthTestServer(t, &OAuthTestServerOptions{
		PreRegisteredClients: []*OAuthClient{
			{
				ClientID:     "authcode-client",
				ClientSecret: "authcode-secret",
				GrantTypes:   []string{"authorization_code"},
				Scope:        "openid",
			},
		},
	})
	require.NoError(t, err)
	defer srv.Close()

	// Step 1: Hit /authorize — should redirect with a code
	authURL := fmt.Sprintf("%s/authorize?client_id=authcode-client&redirect_uri=http://localhost:9999/callback&scope=openid&state=xyz123", srv.Issuer())

	client := &http.Client{CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse // don't follow redirects
	}}

	resp, err := client.Get(authURL)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusFound, resp.StatusCode)

	loc, err := resp.Location()
	require.NoError(t, err)

	code := loc.Query().Get("code")
	state := loc.Query().Get("state")
	require.NotEmpty(t, code)
	assert.Equal(t, "xyz123", state)

	// Step 2: Exchange code for token
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"client_id":     {"authcode-client"},
		"client_secret": {"authcode-secret"},
	}
	tokenResp, err := http.Post(srv.TokenEndpoint(), "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
	require.NoError(t, err)
	defer tokenResp.Body.Close()

	assert.Equal(t, http.StatusOK, tokenResp.StatusCode)

	var tokens map[string]any
	require.NoError(t, json.NewDecoder(tokenResp.Body).Decode(&tokens))
	assert.NotEmpty(t, tokens["access_token"])

	// Step 3: Code cannot be reused
	tokenResp2, err := http.Post(srv.TokenEndpoint(), "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
	require.NoError(t, err)
	defer tokenResp2.Body.Close()

	assert.Equal(t, http.StatusBadRequest, tokenResp2.StatusCode)
}

func TestOAuthTestServer_CreateTokenDirectly(t *testing.T) {
	srv, err := NewOAuthTestServer(t, nil)
	require.NoError(t, err)
	defer srv.Close()

	token, err := srv.CreateTokenWithScopes("test-user", []string{"mcp:connect", "mcp:tools:read"})
	require.NoError(t, err)
	require.NotEmpty(t, token)

	// Token should be a valid JWT (3 dot-separated parts)
	parts := strings.Split(token, ".")
	assert.Len(t, parts, 3)
}