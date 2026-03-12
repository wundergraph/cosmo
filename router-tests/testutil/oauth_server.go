package testutil

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/MicahParks/jwkset"
	"github.com/golang-jwt/jwt/v5"
	"github.com/wundergraph/cosmo/router-tests/freeport"
	"github.com/wundergraph/cosmo/router-tests/jwks"
)

// OAuthClient represents a registered OAuth client.
type OAuthClient struct {
	ClientID     string   `json:"client_id"`
	ClientSecret string   `json:"client_secret"`
	GrantTypes   []string `json:"grant_types"`
	Scope        string   `json:"scope,omitempty"`
}

// authCode is a pending authorization code waiting to be exchanged.
type authCode struct {
	clientID    string
	scope       string
	redirectURI string
	createdAt   time.Time
}

// OAuthTestServer is a minimal OAuth 2.1 Authorization Server for integration tests.
//
// Supported endpoints:
//   - GET  /.well-known/jwks.json                   — JWKS for token verification
//   - GET  /.well-known/oauth-authorization-server   — AS metadata (RFC 8414)
//   - POST /token                                    — Token endpoint (client_credentials + authorization_code)
//   - POST /register                                 — Dynamic client registration (RFC 7591)
//   - GET  /authorize                                — Authorization endpoint (auto-approves for testing)
//
// The server issues real signed JWTs that can be validated by any consumer
// fetching the JWKS endpoint, making it suitable for end-to-end testing with
// the official MCP TypeScript SDK's ClientCredentialsProvider.
type OAuthTestServer struct {
	t        *testing.T
	provider jwks.Crypto
	keyID    string
	issuer   string
	audience string
	jwksURL  string
	server   *http.Server
	storage  jwkset.Storage

	mu      sync.RWMutex
	clients map[string]*OAuthClient // clientID → client
	codes   map[string]*authCode    // code → pending auth code

	// DefaultScopes assigned to tokens when the client doesn't request specific scopes.
	DefaultScopes string
}

// OAuthTestServerOptions configures the test OAuth server.
type OAuthTestServerOptions struct {
	DefaultScopes        string
	PreRegisteredClients []*OAuthClient
}

// NewOAuthTestServer creates and starts a minimal OAuth 2.1 AS on a random port.
func NewOAuthTestServer(t *testing.T, opts *OAuthTestServerOptions) (*OAuthTestServer, error) {
	t.Helper()

	if opts == nil {
		opts = &OAuthTestServerOptions{}
	}

	port := freeport.GetOne(t)
	portStr := fmt.Sprintf("%d", port)

	cryptoProvider, err := jwks.NewRSACrypto("test_rsa", jwkset.AlgRS256, 2048)
	if err != nil {
		return nil, fmt.Errorf("failed to create RSA crypto: %w", err)
	}

	jwkStorage := jwkset.NewMemoryStorage()
	jwk, err := cryptoProvider.MarshalJWK()
	if err != nil {
		return nil, fmt.Errorf("failed to marshal JWK: %w", err)
	}
	if err := jwkStorage.KeyWrite(context.Background(), jwk); err != nil {
		return nil, fmt.Errorf("failed to write key to storage: %w", err)
	}

	baseURL := fmt.Sprintf("http://localhost:%s", portStr)

	s := &OAuthTestServer{
		t:             t,
		provider:      cryptoProvider,
		keyID:         "test_rsa",
		issuer:        baseURL,
		audience:      "test-audience",
		jwksURL:       baseURL + "/.well-known/jwks.json",
		storage:       jwkStorage,
		clients:       make(map[string]*OAuthClient),
		codes:         make(map[string]*authCode),
		DefaultScopes: opts.DefaultScopes,
	}

	for _, c := range opts.PreRegisteredClients {
		s.clients[c.ClientID] = c
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/jwks.json", s.handleJWKS)
	mux.HandleFunc("/.well-known/oauth-authorization-server", s.handleASMetadata)
	mux.HandleFunc("/token", s.handleToken)
	mux.HandleFunc("/register", s.handleRegister)
	mux.HandleFunc("/authorize", s.handleAuthorize)

	httpServer := &http.Server{
		Addr:    ":" + portStr,
		Handler: withCORS(mux),
	}
	s.server = httpServer

	go func() {
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			t.Logf("OAuth server error: %v", err)
		}
	}()

	if err := s.waitForReady(5 * time.Second); err != nil {
		return nil, fmt.Errorf("OAuth server failed to start: %w", err)
	}

	t.Logf("OAuth test server started at %s", s.issuer)
	return s, nil
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

func (s *OAuthTestServer) handleJWKS(w http.ResponseWriter, _ *http.Request) {
	rawJWKS, err := s.storage.JSON(context.Background())
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(rawJWKS)
}

// handleASMetadata serves RFC 8414 Authorization Server Metadata.
func (s *OAuthTestServer) handleASMetadata(w http.ResponseWriter, _ *http.Request) {
	meta := map[string]any{
		"issuer":                                s.issuer,
		"token_endpoint":                        s.issuer + "/token",
		"authorization_endpoint":                s.issuer + "/authorize",
		"registration_endpoint":                 s.issuer + "/register",
		"jwks_uri":                              s.jwksURL,
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"client_credentials", "authorization_code"},
		"token_endpoint_auth_methods_supported": []string{"client_secret_basic", "client_secret_post"},
		"code_challenge_methods_supported":      []string{"S256"},
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(meta)
}

// handleToken handles client_credentials and authorization_code grants.
func (s *OAuthTestServer) handleToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		s.tokenError(w, "invalid_request", "POST required", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseForm(); err != nil {
		s.tokenError(w, "invalid_request", "bad form body", http.StatusBadRequest)
		return
	}

	switch r.FormValue("grant_type") {
	case "client_credentials":
		s.handleClientCredentials(w, r)
	case "authorization_code":
		s.handleAuthorizationCodeExchange(w, r)
	default:
		s.tokenError(w, "unsupported_grant_type",
			fmt.Sprintf("unsupported grant_type %q", r.FormValue("grant_type")),
			http.StatusBadRequest)
	}
}

func (s *OAuthTestServer) handleClientCredentials(w http.ResponseWriter, r *http.Request) {
	clientID, clientSecret, ok := s.authenticateClient(r)
	if !ok {
		s.tokenError(w, "invalid_client", "client authentication failed", http.StatusUnauthorized)
		return
	}

	s.mu.RLock()
	client, exists := s.clients[clientID]
	s.mu.RUnlock()

	if !exists || client.ClientSecret != clientSecret {
		s.tokenError(w, "invalid_client", "unknown client or bad secret", http.StatusUnauthorized)
		return
	}

	scope := r.FormValue("scope")
	if scope == "" {
		scope = client.Scope
	}
	if scope == "" {
		scope = s.DefaultScopes
	}

	s.issueTokenResponse(w, clientID, scope)
}

func (s *OAuthTestServer) handleAuthorizationCodeExchange(w http.ResponseWriter, r *http.Request) {
	code := r.FormValue("code")
	if code == "" {
		s.tokenError(w, "invalid_request", "missing code", http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	pending, exists := s.codes[code]
	if exists {
		delete(s.codes, code) // one-time use
	}
	s.mu.Unlock()

	if !exists {
		s.tokenError(w, "invalid_grant", "unknown or expired code", http.StatusBadRequest)
		return
	}

	// Codes expire after 60 seconds
	if time.Since(pending.createdAt) > 60*time.Second {
		s.tokenError(w, "invalid_grant", "code expired", http.StatusBadRequest)
		return
	}

	// Authenticate the client
	clientID, clientSecret, ok := s.authenticateClient(r)
	if !ok {
		s.tokenError(w, "invalid_client", "client authentication failed", http.StatusUnauthorized)
		return
	}

	s.mu.RLock()
	client, clientExists := s.clients[clientID]
	s.mu.RUnlock()

	if !clientExists || client.ClientSecret != clientSecret {
		s.tokenError(w, "invalid_client", "unknown client or bad secret", http.StatusUnauthorized)
		return
	}

	if pending.clientID != clientID {
		s.tokenError(w, "invalid_grant", "code was issued to a different client", http.StatusBadRequest)
		return
	}

	s.issueTokenResponse(w, clientID, pending.scope)
}

// handleAuthorize is a simplified authorization endpoint that auto-approves.
// For interactive testing it returns a minimal HTML page; for automated tests
// it immediately redirects with a code.
func (s *OAuthTestServer) handleAuthorize(w http.ResponseWriter, r *http.Request) {
	clientID := r.URL.Query().Get("client_id")
	redirectURI := r.URL.Query().Get("redirect_uri")
	scope := r.URL.Query().Get("scope")

	if clientID == "" || redirectURI == "" {
		http.Error(w, "missing client_id or redirect_uri", http.StatusBadRequest)
		return
	}

	// Generate authorization code
	code := randomString(32)

	s.mu.Lock()
	s.codes[code] = &authCode{
		clientID:    clientID,
		scope:       scope,
		redirectURI: redirectURI,
		createdAt:   time.Now(),
	}
	s.mu.Unlock()

	// Preserve the state parameter for PKCE / CSRF
	state := r.URL.Query().Get("state")
	location := fmt.Sprintf("%s?code=%s", redirectURI, code)
	if state != "" {
		location += "&state=" + state
	}

	http.Redirect(w, r, location, http.StatusFound)
}

// handleRegister implements RFC 7591 Dynamic Client Registration.
func (s *OAuthTestServer) handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ClientName              string   `json:"client_name"`
		GrantTypes              []string `json:"grant_types"`
		RedirectURIs            []string `json:"redirect_uris"`
		TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
		Scope                   string   `json:"scope"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad JSON", http.StatusBadRequest)
		return
	}

	clientID := "dyn-" + randomString(16)
	clientSecret := "secret-" + randomString(24)

	client := &OAuthClient{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		GrantTypes:   req.GrantTypes,
		Scope:        req.Scope,
	}

	s.mu.Lock()
	s.clients[clientID] = client
	s.mu.Unlock()

	resp := map[string]any{
		"client_id":                    clientID,
		"client_secret":               clientSecret,
		"client_name":                 req.ClientName,
		"grant_types":                 req.GrantTypes,
		"redirect_uris":               req.RedirectURIs,
		"token_endpoint_auth_method":  req.TokenEndpointAuthMethod,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(resp)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// authenticateClient extracts client credentials via Basic auth or POST body.
func (s *OAuthTestServer) authenticateClient(r *http.Request) (clientID, clientSecret string, ok bool) {
	// client_secret_basic
	if authHeader := r.Header.Get("Authorization"); strings.HasPrefix(authHeader, "Basic ") {
		decoded, err := base64.StdEncoding.DecodeString(authHeader[6:])
		if err == nil {
			if parts := strings.SplitN(string(decoded), ":", 2); len(parts) == 2 {
				return parts[0], parts[1], true
			}
		}
	}

	// client_secret_post
	id, secret := r.FormValue("client_id"), r.FormValue("client_secret")
	if id != "" && secret != "" {
		return id, secret, true
	}

	return "", "", false
}

func (s *OAuthTestServer) issueTokenResponse(w http.ResponseWriter, sub, scope string) {
	now := time.Now()
	claims := jwt.MapClaims{
		"iss":       s.issuer,
		"aud":       s.audience,
		"sub":       sub,
		"iat":       now.Unix(),
		"exp":       now.Add(1 * time.Hour).Unix(),
		"client_id": sub,
	}
	if scope != "" {
		claims["scope"] = scope
	}

	token := jwt.NewWithClaims(s.provider.SigningMethod(), claims)
	token.Header[jwkset.HeaderKID] = s.keyID

	accessToken, err := token.SignedString(s.provider.PrivateKey())
	if err != nil {
		s.t.Logf("Failed to sign token: %v", err)
		s.tokenError(w, "server_error", "token signing failed", http.StatusInternalServerError)
		return
	}

	resp := map[string]any{
		"access_token": accessToken,
		"token_type":   "Bearer",
		"expires_in":   3600,
	}
	if scope != "" {
		resp["scope"] = scope
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(resp)
}

func (s *OAuthTestServer) tokenError(w http.ResponseWriter, errCode, description string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error":             errCode,
		"error_description": description,
	})
}

func (s *OAuthTestServer) waitForReady(timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("timeout waiting for OAuth server")
		case <-ticker.C:
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.jwksURL, nil)
			if err != nil {
				continue
			}
			resp, err := http.DefaultClient.Do(req)
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					return nil
				}
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Public API for tests
// ---------------------------------------------------------------------------

// CreateToken creates a signed JWT with the given claims (for direct test use).
func (s *OAuthTestServer) CreateToken(claims map[string]any) (string, error) {
	s.t.Helper()

	now := time.Now()
	tokenClaims := jwt.MapClaims{
		"iss": s.issuer,
		"aud": s.audience,
		"iat": now.Unix(),
		"exp": now.Add(1 * time.Hour).Unix(),
	}
	for k, v := range claims {
		tokenClaims[k] = v
	}

	token := jwt.NewWithClaims(s.provider.SigningMethod(), tokenClaims)
	token.Header[jwkset.HeaderKID] = s.keyID

	return token.SignedString(s.provider.PrivateKey())
}

// CreateTokenWithScopes creates a signed JWT with specific OAuth scopes.
func (s *OAuthTestServer) CreateTokenWithScopes(sub string, scopes []string) (string, error) {
	s.t.Helper()
	return s.CreateToken(map[string]any{
		"sub":   sub,
		"scope": strings.Join(scopes, " "),
	})
}

// RegisterClient pre-registers a client (bypass dynamic registration).
func (s *OAuthTestServer) RegisterClient(clientID, clientSecret, scope string) *OAuthClient {
	client := &OAuthClient{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		GrantTypes:   []string{"client_credentials"},
		Scope:        scope,
	}
	s.mu.Lock()
	s.clients[clientID] = client
	s.mu.Unlock()
	return client
}

// JWKSURL returns the JWKS endpoint URL.
func (s *OAuthTestServer) JWKSURL() string { return s.jwksURL }

// Issuer returns the base URL / issuer of the OAuth server.
func (s *OAuthTestServer) Issuer() string { return s.issuer }

// TokenEndpoint returns the token endpoint URL.
func (s *OAuthTestServer) TokenEndpoint() string { return s.issuer + "/token" }

// Close stops the server.
func (s *OAuthTestServer) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return s.server.Shutdown(ctx)
}

func randomString(nBytes int) string {
	b := make([]byte, nBytes)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// withCORS wraps an http.Handler with permissive CORS headers for browser-based
// MCP clients (e.g. MCP Inspector). This is required because the TypeScript SDK
// fetches /.well-known/oauth-authorization-server cross-origin from the browser.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, MCP-Protocol-Version")
		w.Header().Set("Access-Control-Max-Age", "86400")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}