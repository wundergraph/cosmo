package testutil

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/MicahParks/jwkset"
	"github.com/golang-jwt/jwt/v5"
	"github.com/wundergraph/cosmo/router-tests/freeport"
	"github.com/wundergraph/cosmo/router-tests/jwks"
)

// JWKSTestServer provides JWT token generation for testing
type JWKSTestServer struct {
	t        *testing.T
	provider jwks.Crypto
	keyID    string
	issuer   string
	audience string
	jwksURL  string
	server   *http.Server
	storage  jwkset.Storage
}

// NewJWKSTestServer creates a new JWKS test server with RSA keys
// The server will automatically allocate a free port and return it when the test ends
func NewJWKSTestServer(t *testing.T) (*JWKSTestServer, error) {
	t.Helper()

	// Get a free port using the freeport package
	port := freeport.GetOne(t)
	portStr := fmt.Sprintf("%d", port)

	keyID := "test_rsa"
	provider, err := jwks.NewRSACrypto(keyID, jwkset.AlgRS256, 2048)
	if err != nil {
		return nil, fmt.Errorf("failed to create RSA crypto: %w", err)
	}

	storage := jwkset.NewMemoryStorage()
	ctx := context.Background()

	jwk, err := provider.MarshalJWK()
	if err != nil {
		return nil, fmt.Errorf("failed to marshal JWK: %w", err)
	}

	if err := storage.KeyWrite(ctx, jwk); err != nil {
		return nil, fmt.Errorf("failed to write key to storage: %w", err)
	}

	server := &JWKSTestServer{
		t:        t,
		provider: provider,
		keyID:    keyID,
		issuer:   fmt.Sprintf("http://localhost:%s", portStr),
		audience: "test-audience",
		jwksURL:  fmt.Sprintf("http://localhost:%s/.well-known/jwks.json", portStr),
		storage:  storage,
	}

	// Start HTTP server
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/jwks.json", server.handleJWKS)

	httpServer := &http.Server{
		Addr:    ":" + portStr,
		Handler: mux,
	}

	server.server = httpServer

	go func() {
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			t.Logf("JWKS server error: %v", err)
		}
	}()

	// Wait for server to start
	if err := server.waitForReady(5 * time.Second); err != nil {
		return nil, fmt.Errorf("JWKS server failed to start: %w", err)
	}

	t.Logf("JWKS test server started at %s", server.issuer)

	return server, nil
}

// waitForReady waits for the server to be ready
func (s *JWKSTestServer) waitForReady(timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("timeout waiting for JWKS server")
		case <-ticker.C:
			resp, err := http.Get(s.jwksURL)
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					return nil
				}
			}
		}
	}
}

// handleJWKS serves the JWKS JSON
func (s *JWKSTestServer) handleJWKS(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()
	rawJWKS, err := s.storage.JSON(ctx)
	if err != nil {
		s.t.Logf("Failed to get JWKS: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(rawJWKS)
}

// CreateToken creates a JWT token with the specified claims
// Default claims (iss, aud, iat, exp) are added automatically
func (s *JWKSTestServer) CreateToken(claims map[string]any) (string, error) {
	s.t.Helper()

	now := time.Now()
	tokenClaims := jwt.MapClaims{
		"iss": s.issuer,
		"aud": s.audience,
		"iat": now.Unix(),
		"exp": now.Add(1 * time.Hour).Unix(),
	}

	// Merge custom claims
	for k, v := range claims {
		tokenClaims[k] = v
	}

	token := jwt.NewWithClaims(s.provider.SigningMethod(), tokenClaims)
	token.Header[jwkset.HeaderKID] = s.keyID

	signed, err := token.SignedString(s.provider.PrivateKey())
	if err != nil {
		return "", fmt.Errorf("failed to sign token: %w", err)
	}

	return signed, nil
}

// CreateTokenWithScopes creates a token with specific OAuth scopes
func (s *JWKSTestServer) CreateTokenWithScopes(sub string, scopes []string) (string, error) {
	s.t.Helper()

	scopeStr := ""
	if len(scopes) > 0 {
		scopeStr = scopes[0]
		for i := 1; i < len(scopes); i++ {
			scopeStr += " " + scopes[i]
		}
	}

	return s.CreateToken(map[string]any{
		"sub":   sub,
		"scope": scopeStr,
	})
}

// JWKSURL returns the URL of the JWKS endpoint
func (s *JWKSTestServer) JWKSURL() string {
	return s.jwksURL
}

// Issuer returns the issuer URL
func (s *JWKSTestServer) Issuer() string {
	return s.issuer
}

// Close stops the JWKS server
func (s *JWKSTestServer) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return s.server.Shutdown(ctx)
}
