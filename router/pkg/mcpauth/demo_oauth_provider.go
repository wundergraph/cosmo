package mcpauth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"sync"
	"time"

	"go.uber.org/zap"
)

// Demo OAuth Provider for MCP Authentication
//
// This file implements a complete in-memory OAuth 2.1 + PKCE server for development
// and testing. It provides all the functionality needed to test MCP authentication
// flows without requiring external OAuth infrastructure.
//
// ⚠️  DEMO ONLY - NOT FOR PRODUCTION USE
//
// Features:
//   - Full OAuth 2.1 + PKCE authorization code flow
//   - Dynamic client registration (RFC 7591)
//   - Token revocation (RFC 7009)
//   - Pre-configured test clients for common editors
//   - In-memory storage (no persistence between restarts)
//   - Automatic token cleanup

// DemoInMemoryClientsStore implements an in-memory client store for testing
// 🚨 DEMO ONLY - NOT FOR PRODUCTION
type DemoInMemoryClientsStore struct {
	mu      sync.RWMutex
	clients map[*string]*OAuthClientInformationFull
}

// NewDemoInMemoryClientsStore creates a new in-memory client store
func NewDemoInMemoryClientsStore() *DemoInMemoryClientsStore {
	return &DemoInMemoryClientsStore{
		clients: make(map[*string]*OAuthClientInformationFull),
	}
}

// GetClient retrieves a client by ID
func (s *DemoInMemoryClientsStore) GetClient(ctx context.Context, clientID string) (*OAuthClientInformationFull, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	client, exists := s.clients[stringPtr(clientID)]
	if !exists {
		return nil, fmt.Errorf("client not found")
	}

	return client, nil
}

// RegisterClient registers a new client
func (s *DemoInMemoryClientsStore) RegisterClient(ctx context.Context, client *OAuthClientInformationFull) (*OAuthClientInformationFull, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.clients[client.ClientID] = client
	return client, nil
}

// AddTestClient is a helper method to add predefined test clients
func (s *DemoInMemoryClientsStore) AddTestClient(clientID string, redirectURIs []string, scopes []string) *OAuthClientInformationFull {
	s.mu.Lock()
	defer s.mu.Unlock()

	client := &OAuthClientInformationFull{
		OAuthClientInformation: OAuthClientInformation{
			ClientID: stringPtr(clientID),
		},
		OAuthClientMetadata: OAuthClientMetadata{
			RedirectURIs:  redirectURIs,
			GrantTypes:    []string{GrantTypeAuthorizationCode, GrantTypeRefreshToken},
			ResponseTypes: []string{"code"},
		},
	}

	if len(scopes) > 0 {
		scopeStr := ""
		for i, scope := range scopes {
			if i > 0 {
				scopeStr += " "
			}
			scopeStr += scope
		}
		client.Scope = &scopeStr
	}

	s.clients[stringPtr(clientID)] = client
	return client
}

// DemoInMemoryAuthProvider implements an in-memory OAuth provider for testing
// 🚨 DEMO ONLY - NOT FOR PRODUCTION
//
// This example demonstrates MCP OAuth flow but lacks some of the features required for production use,
// for example:
// - Persistent token storage
// - Rate limiting
// - Proper security measures
type DemoInMemoryAuthProvider struct {
	clientsStore *DemoInMemoryClientsStore
	mu           sync.RWMutex
	codes        map[string]*authCodeData
	tokens       map[string]*AuthInfo
	logger       *zap.Logger
}

type authCodeData struct {
	params *AuthorizationParams
	client *OAuthClientInformationFull
	issued time.Time
}

// NewDemoInMemoryAuthProvider creates a new demo OAuth 2.1 + PKCE provider for testing.
// This provider implements a complete OAuth server in memory, suitable for development
// and testing MCP authentication flows.
//
// Usage:
//
//	provider := NewDemoInMemoryAuthProvider(logger)
//	provider.AddDefaultTestClients() // Adds VS Code, Cursor, and test clients
//
//	authRouter := mcpauth.NewAuthRouter(mcpauth.AuthRouterOptions{
//	    Provider: provider,
//	    IssuerURL: mustParse("http://localhost:5025/oauth"),
//	    ScopesSupported: []string{"mcp:read", "mcp:write"},
//	    ClientSecretExpiryTime: 24 * time.Hour, // 1 day for testing
//	})
//
// ⚠️  For testing only - tokens are lost on restart!
func NewDemoInMemoryAuthProvider(logger *zap.Logger) *DemoInMemoryAuthProvider {
	if logger == nil {
		logger = zap.NewNop()
	}

	return &DemoInMemoryAuthProvider{
		clientsStore: NewDemoInMemoryClientsStore(),
		codes:        make(map[string]*authCodeData),
		tokens:       make(map[string]*AuthInfo),
		logger:       logger.With(zap.String("component", "demo_oauth_provider")),
	}
}

// GetClientStore returns the client store
func (p *DemoInMemoryAuthProvider) GetClientStore() OAuthClientStore {
	return p.clientsStore
}

// SkipLocalPKCEValidation returns whether to skip local PKCE validation
// For demo purposes, we handle PKCE validation locally
func (p *DemoInMemoryAuthProvider) SkipLocalPKCEValidation() bool {
	return false
}

// Authorize handles authorization requests
func (p *DemoInMemoryAuthProvider) Authorize(ctx context.Context, client *OAuthClientInformationFull, params *AuthorizationParams, w http.ResponseWriter) error {
	code := p.generateRandomToken()

	p.mu.Lock()
	p.codes[code] = &authCodeData{
		params: params,
		client: client,
		issued: time.Now(),
	}
	p.mu.Unlock()

	// Build redirect URL
	redirectURL := params.RedirectURI + "?code=" + code
	if params.State != nil {
		redirectURL += "&state=" + *params.State
	}

	p.logger.Debug("Authorization code issued",
		zap.Stringp("client_id", client.ClientID),
		zap.String("code", code),
		zap.String("redirect_uri", params.RedirectURI))

	// For demo purposes, manually set the Location header and status code
	// instead of using http.Redirect which requires a valid request
	w.Header().Set("Location", redirectURL)
	w.WriteHeader(http.StatusFound)
	return nil
}

// ChallengeForAuthorizationCode returns the PKCE challenge for a code
func (p *DemoInMemoryAuthProvider) ChallengeForAuthorizationCode(ctx context.Context, client *OAuthClientInformationFull, authorizationCode string) (string, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	codeData, exists := p.codes[authorizationCode]
	if !exists {
		return "", fmt.Errorf("invalid authorization code")
	}

	// Check if code is expired (5 minutes)
	if time.Since(codeData.issued) > 5*time.Minute {
		return "", fmt.Errorf("authorization code expired")
	}

	return codeData.params.CodeChallenge, nil
}

// ExchangeAuthorizationCode exchanges an authorization code for tokens
func (p *DemoInMemoryAuthProvider) ExchangeAuthorizationCode(ctx context.Context, client *OAuthClientInformationFull, authorizationCode string, codeVerifier *string, redirectURI *string) (*OAuthTokens, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	codeData, exists := p.codes[authorizationCode]
	if !exists {
		return nil, fmt.Errorf("invalid authorization code")
	}

	// Check if code is expired
	if time.Since(codeData.issued) > 5*time.Minute {
		delete(p.codes, authorizationCode)
		return nil, fmt.Errorf("authorization code expired")
	}

	// Verify client
	if codeData.client.ClientID != client.ClientID {
		return nil, fmt.Errorf("authorization code was not issued to this client")
	}

	// Verify redirect URI if provided
	if redirectURI != nil && *redirectURI != codeData.params.RedirectURI {
		return nil, fmt.Errorf("redirect URI mismatch")
	}

	// For demo provider, PKCE validation should have been performed by the router
	// when skipLocalPkceValidation is false. If we receive a codeVerifier here,
	// it means skipLocalPkceValidation is true, which shouldn't happen for demo provider.
	if codeVerifier != nil {
		p.logger.Warn("Demo provider received code_verifier but should perform local PKCE validation",
			zap.String("client_id", *client.ClientID))
	}

	// Clean up the code (one-time use)
	delete(p.codes, authorizationCode)

	// Generate access token
	token := p.generateRandomToken()
	expiresAt := time.Now().Add(1 * time.Hour).Unix()

	authInfo := &AuthInfo{
		Token:     token,
		ClientID:  *client.ClientID,
		Scopes:    codeData.params.Scopes,
		ExpiresAt: expiresAt,
	}

	p.tokens[token] = authInfo

	scope := ""
	if len(codeData.params.Scopes) > 0 {
		for i, s := range codeData.params.Scopes {
			if i > 0 {
				scope += " "
			}
			scope += s
		}
	}

	p.logger.Debug("Access token issued",
		zap.String("client_id", *client.ClientID),
		zap.String("token", token),
		zap.Strings("scopes", codeData.params.Scopes))

	expiresIn := 3600
	return &OAuthTokens{
		AccessToken: token,
		TokenType:   "bearer",
		ExpiresIn:   &expiresIn,
		Scope:       scope,
	}, nil
}

// ExchangeRefreshToken exchanges a refresh token for new tokens (not implemented in demo)
func (p *DemoInMemoryAuthProvider) ExchangeRefreshToken(ctx context.Context, client *OAuthClientInformationFull, refreshToken string, scopes []string) (*OAuthTokens, error) {
	return nil, fmt.Errorf("refresh token flow not implemented for demo")
}

// VerifyAccessToken verifies an access token and returns auth info
func (p *DemoInMemoryAuthProvider) VerifyAccessToken(ctx context.Context, token string) (*AuthInfo, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	authInfo, exists := p.tokens[token]
	if !exists {
		return nil, fmt.Errorf("invalid token")
	}

	// Check if token is expired
	if authInfo.ExpiresAt < time.Now().Unix() {
		return nil, fmt.Errorf("token expired")
	}

	p.logger.Debug("Token verified",
		zap.String("client_id", authInfo.ClientID),
		zap.Strings("scopes", authInfo.Scopes))

	return authInfo, nil
}

// RevokeToken revokes a token (optional implementation)
func (p *DemoInMemoryAuthProvider) RevokeToken(ctx context.Context, client *OAuthClientInformationFull, request *OAuthTokenRevocationRequest) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Find and delete the token
	delete(p.tokens, request.Token)

	p.logger.Debug("Token revoked",
		zap.String("client_id", *client.ClientID),
		zap.String("token", request.Token))

	return nil
}

// generateRandomToken generates a random token
func (p *DemoInMemoryAuthProvider) generateRandomToken() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// GetDemoClientStore returns the demo client store for easy access
func (p *DemoInMemoryAuthProvider) GetDemoClientStore() *DemoInMemoryClientsStore {
	return p.clientsStore
}

// CreateTestClient is a helper to create and register a test client
func (p *DemoInMemoryAuthProvider) CreateTestClient(clientID string, redirectURIs []string, scopes []string) *OAuthClientInformationFull {
	return p.clientsStore.AddTestClient(clientID, redirectURIs, scopes)
}

// CleanupExpiredTokens removes expired tokens and codes (useful for long-running tests)
func (p *DemoInMemoryAuthProvider) CleanupExpiredTokens() {
	p.mu.Lock()
	defer p.mu.Unlock()

	now := time.Now()

	// Clean up expired tokens
	for token, authInfo := range p.tokens {
		if authInfo.ExpiresAt < now.Unix() {
			delete(p.tokens, token)
		}
	}

	// Clean up expired codes (5 minutes)
	for code, codeData := range p.codes {
		if now.Sub(codeData.issued) > 5*time.Minute {
			delete(p.codes, code)
		}
	}

	p.logger.Debug("Cleaned up expired tokens and codes")
}

// AddDefaultTestClients adds some default test clients for common MCP scenarios
func (p *DemoInMemoryAuthProvider) AddDefaultTestClients() {
	// VS Code extension client
	p.CreateTestClient(
		"vscode-mcp-client",
		[]string{"vscode://auth/callback", "http://localhost:3000/callback"},
		[]string{"mcp:read", "mcp:write"},
	)

	// Cursor editor client
	p.CreateTestClient(
		"cursor-mcp-client",
		[]string{"cursor://auth/callback", "http://localhost:3001/callback"},
		[]string{"mcp:read", "mcp:write"},
	)

	p.logger.Info("Default test clients added for demo OAuth provider")
}
