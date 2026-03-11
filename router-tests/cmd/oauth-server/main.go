/*
Standalone OAuth 2.1 Authorization Server for local MCP development and testing.

Provides all endpoints needed by the official MCP TypeScript SDK's ClientCredentialsProvider:
  - /.well-known/oauth-authorization-server  (AS metadata, RFC 8414)
  - /.well-known/jwks.json                   (JWKS for token verification)
  - /token                                   (client_credentials + authorization_code)
  - /register                                (dynamic client registration, RFC 7591)
  - /authorize                               (auto-approve for testing)

Usage:

	go run ./cmd/oauth-server

	# or with options
	go run ./cmd/oauth-server -port 9099 -client-id test-mcp-client -client-secret test-mcp-secret -scopes "mcp:connect mcp:tools:read mcp:tools:write"

Then configure router/mcp.config.yaml:

	mcp:
	  oauth:
	    enabled: true
	    authorization_server_url: "http://localhost:9099"
	    jwks:
	      - url: "http://localhost:9099/.well-known/jwks.json"
	        refresh_interval: 1m
	        algorithms: ["RS256"]

Run with the MCP TypeScript SDK client:

	MCP_SERVER_URL=http://localhost:5025/mcp \
	MCP_CLIENT_ID=test-mcp-client \
	MCP_CLIENT_SECRET=test-mcp-secret \
	  pnpm test
*/
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/MicahParks/jwkset"
	"github.com/golang-jwt/jwt/v5"
	"github.com/wundergraph/cosmo/router-tests/jwks"
)

var (
	portFlag         = flag.String("port", "9099", "Port to listen on")
	clientIDFlag     = flag.String("client-id", "test-mcp-client", "Pre-registered client ID")
	clientSecretFlag = flag.String("client-secret", "test-mcp-secret", "Pre-registered client secret")
	scopesFlag       = flag.String("scopes", "mcp:connect mcp:tools:read mcp:tools:write", "Default scopes for the pre-registered client (space-separated)")
)

func main() {
	flag.Parse()

	srv, err := newOAuthServer(*portFlag, *clientIDFlag, *clientSecretFlag, *scopesFlag)
	if err != nil {
		log.Fatalf("Failed to create OAuth server: %v", err)
	}

	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("OAuth server listening on http://localhost:%s", *portFlag)
		log.Printf("  JWKS:     http://localhost:%s/.well-known/jwks.json", *portFlag)
		log.Printf("  Metadata: http://localhost:%s/.well-known/oauth-authorization-server", *portFlag)
		log.Printf("  Token:    http://localhost:%s/token", *portFlag)
		log.Printf("  Register: http://localhost:%s/register", *portFlag)
		log.Printf("  Client:   %s / %s (scopes: %s)", *clientIDFlag, *clientSecretFlag, *scopesFlag)

		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Print a sample token for manual testing
	token, err := srv.handler.createToken(*clientIDFlag, *scopesFlag)
	if err == nil {
		log.Printf("\nSample Bearer token (for manual curl/playground testing):\n%s\n", token)
	}

	<-sigs
	log.Println("Shutting down...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

type oauthHandler struct {
	provider jwks.Crypto
	keyID    string
	issuer   string
	jwksURL  string
	storage  jwkset.Storage

	mu      sync.RWMutex
	clients map[string]*client
	codes   map[string]*authCode
}

type client struct {
	id     string
	secret string
	scope  string
}

type authCode struct {
	clientID  string
	scope     string
	createdAt time.Time
}

type serverWithHandler struct {
	*http.Server
	handler *oauthHandler
}

func newOAuthServer(port, clientID, clientSecret, defaultScopes string) (*serverWithHandler, error) {
	cryptoProvider, err := jwks.NewRSACrypto("test_rsa", jwkset.AlgRS256, 2048)
	if err != nil {
		return nil, fmt.Errorf("RSA keygen: %w", err)
	}

	jwkStorage := jwkset.NewMemoryStorage()
	jwk, err := cryptoProvider.MarshalJWK()
	if err != nil {
		return nil, fmt.Errorf("marshal JWK: %w", err)
	}
	if err := jwkStorage.KeyWrite(context.Background(), jwk); err != nil {
		return nil, fmt.Errorf("store JWK: %w", err)
	}

	baseURL := fmt.Sprintf("http://localhost:%s", port)

	h := &oauthHandler{
		provider: cryptoProvider,
		keyID:    "test_rsa",
		issuer:   baseURL,
		jwksURL:  baseURL + "/.well-known/jwks.json",
		storage:  jwkStorage,
		clients:  make(map[string]*client),
		codes:    make(map[string]*authCode),
	}

	// Pre-register client
	h.clients[clientID] = &client{id: clientID, secret: clientSecret, scope: defaultScopes}

	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/jwks.json", h.handleJWKS)
	mux.HandleFunc("/.well-known/oauth-authorization-server", h.handleASMetadata)
	mux.HandleFunc("/token", h.handleToken)
	mux.HandleFunc("/register", h.handleRegister)
	mux.HandleFunc("/authorize", h.handleAuthorize)

	return &serverWithHandler{
		Server:  &http.Server{Addr: ":" + port, Handler: withCORS(mux)},
		handler: h,
	}, nil
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

func (h *oauthHandler) handleJWKS(w http.ResponseWriter, _ *http.Request) {
	raw, err := h.storage.JSON(context.Background())
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(raw)
}

func (h *oauthHandler) handleASMetadata(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"issuer":                                h.issuer,
		"token_endpoint":                        h.issuer + "/token",
		"authorization_endpoint":                h.issuer + "/authorize",
		"registration_endpoint":                 h.issuer + "/register",
		"jwks_uri":                              h.jwksURL,
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"client_credentials", "authorization_code"},
		"token_endpoint_auth_methods_supported": []string{"client_secret_basic", "client_secret_post"},
		"code_challenge_methods_supported":      []string{"S256"},
	})
}

func (h *oauthHandler) handleToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		tokenError(w, "invalid_request", "POST required", http.StatusMethodNotAllowed)
		return
	}
	_ = r.ParseForm()

	switch r.FormValue("grant_type") {
	case "client_credentials":
		h.handleClientCredentials(w, r)
	case "authorization_code":
		h.handleCodeExchange(w, r)
	default:
		tokenError(w, "unsupported_grant_type", "unsupported grant_type", http.StatusBadRequest)
	}
}

func (h *oauthHandler) handleClientCredentials(w http.ResponseWriter, r *http.Request) {
	clientID, clientSecret, ok := authenticateClient(r)
	if !ok {
		tokenError(w, "invalid_client", "client authentication failed", http.StatusUnauthorized)
		return
	}

	h.mu.RLock()
	c, exists := h.clients[clientID]
	h.mu.RUnlock()

	if !exists || c.secret != clientSecret {
		tokenError(w, "invalid_client", "unknown client or bad secret", http.StatusUnauthorized)
		return
	}

	scope := r.FormValue("scope")
	if scope == "" {
		scope = c.scope
	}

	h.issueTokenResponse(w, clientID, scope)
}

func (h *oauthHandler) handleCodeExchange(w http.ResponseWriter, r *http.Request) {
	code := r.FormValue("code")
	if code == "" {
		tokenError(w, "invalid_request", "missing code", http.StatusBadRequest)
		return
	}

	h.mu.Lock()
	pending, exists := h.codes[code]
	if exists {
		delete(h.codes, code)
	}
	h.mu.Unlock()

	if !exists || time.Since(pending.createdAt) > 60*time.Second {
		tokenError(w, "invalid_grant", "unknown or expired code", http.StatusBadRequest)
		return
	}

	clientID, clientSecret, ok := authenticateClient(r)
	if !ok {
		tokenError(w, "invalid_client", "client authentication failed", http.StatusUnauthorized)
		return
	}

	h.mu.RLock()
	c, clientExists := h.clients[clientID]
	h.mu.RUnlock()

	if !clientExists || c.secret != clientSecret || pending.clientID != clientID {
		tokenError(w, "invalid_client", "client mismatch", http.StatusUnauthorized)
		return
	}

	h.issueTokenResponse(w, clientID, pending.scope)
}

func (h *oauthHandler) handleAuthorize(w http.ResponseWriter, r *http.Request) {
	clientID := r.URL.Query().Get("client_id")
	redirectURI := r.URL.Query().Get("redirect_uri")
	scope := r.URL.Query().Get("scope")
	state := r.URL.Query().Get("state")

	if clientID == "" || redirectURI == "" {
		http.Error(w, "missing client_id or redirect_uri", http.StatusBadRequest)
		return
	}

	code := randomHex(32)
	h.mu.Lock()
	h.codes[code] = &authCode{clientID: clientID, scope: scope, createdAt: time.Now()}
	h.mu.Unlock()

	location := fmt.Sprintf("%s?code=%s", redirectURI, code)
	if state != "" {
		location += "&state=" + state
	}
	http.Redirect(w, r, location, http.StatusFound)
}

func (h *oauthHandler) handleRegister(w http.ResponseWriter, r *http.Request) {
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

	id := "dyn-" + randomHex(16)
	secret := "secret-" + randomHex(24)

	h.mu.Lock()
	h.clients[id] = &client{id: id, secret: secret, scope: req.Scope}
	h.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"client_id":                   id,
		"client_secret":              secret,
		"client_name":                req.ClientName,
		"grant_types":                req.GrantTypes,
		"redirect_uris":              req.RedirectURIs,
		"token_endpoint_auth_method": req.TokenEndpointAuthMethod,
	})
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

func (h *oauthHandler) issueTokenResponse(w http.ResponseWriter, sub, scope string) {
	accessToken, err := h.createToken(sub, scope)
	if err != nil {
		tokenError(w, "server_error", "token signing failed", http.StatusInternalServerError)
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

func (h *oauthHandler) createToken(sub, scope string) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"iss":       h.issuer,
		"aud":       "test-audience",
		"sub":       sub,
		"iat":       now.Unix(),
		"exp":       now.Add(1 * time.Hour).Unix(),
		"client_id": sub,
	}
	if scope != "" {
		claims["scope"] = scope
	}

	token := jwt.NewWithClaims(h.provider.SigningMethod(), claims)
	token.Header[jwkset.HeaderKID] = h.keyID
	return token.SignedString(h.provider.PrivateKey())
}

func authenticateClient(r *http.Request) (string, string, bool) {
	if authHeader := r.Header.Get("Authorization"); strings.HasPrefix(authHeader, "Basic ") {
		decoded, err := base64.StdEncoding.DecodeString(authHeader[6:])
		if err == nil {
			if parts := strings.SplitN(string(decoded), ":", 2); len(parts) == 2 {
				return parts[0], parts[1], true
			}
		}
	}
	id, secret := r.FormValue("client_id"), r.FormValue("client_secret")
	if id != "" && secret != "" {
		return id, secret, true
	}
	return "", "", false
}

func tokenError(w http.ResponseWriter, errCode, desc string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": errCode, "error_description": desc})
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// withCORS wraps an http.Handler with permissive CORS headers for browser-based
// MCP clients (e.g. MCP Inspector). The TypeScript SDK fetches
// /.well-known/oauth-authorization-server cross-origin from the browser.
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