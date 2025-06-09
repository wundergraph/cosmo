package mcpauth

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"go.uber.org/zap"
)

// MCPAuthConfig represents OAuth authentication configuration for MCP server
type MCPAuthConfig struct {
	Enabled                 bool     `json:"enabled"`
	IssuerURL               string   `json:"issuer_url"`
	BaseURL                 *string  `json:"base_url,omitempty"` // Optional base URL for OAuth endpoints
	UpstreamAuthURL         string   `json:"upstream_auth_url"`
	UpstreamTokenURL        string   `json:"upstream_token_url"`
	UpstreamRevocationURL   *string  `json:"upstream_revocation_url,omitempty"`
	UpstreamRegistrationURL *string  `json:"upstream_registration_url,omitempty"`
	IntrospectionEndpoint   string   `json:"introspection_endpoint"`
	RequiredScopes          []string `json:"required_scopes"`
	ResourceName            *string  `json:"resource_name,omitempty"`
	ServiceDocumentationURL *string  `json:"service_documentation_url,omitempty"`
}

// MCPOAuthProvider implements OAuth authentication for MCP server
type MCPOAuthProvider struct {
	config     *MCPAuthConfig
	httpClient *http.Client
	logger     *zap.Logger
	provider   OAuthServerProvider
}

// NewMCPOAuthProvider creates a new OAuth provider for MCP server
func NewMCPOAuthProvider(config *MCPAuthConfig, httpClient *http.Client, logger *zap.Logger) (*MCPOAuthProvider, error) {
	if config == nil || !config.Enabled {
		return nil, fmt.Errorf("OAuth configuration is disabled or missing")
	}

	if err := validateOAuthConfig(config); err != nil {
		return nil, fmt.Errorf("invalid OAuth configuration: %w", err)
	}

	provider := &MCPOAuthProvider{
		config:     config,
		httpClient: httpClient,
		logger:     logger.With(zap.String("component", "mcp_oauth")),
	}

	if err := provider.initialize(); err != nil {
		return nil, fmt.Errorf("failed to initialize OAuth provider: %w", err)
	}

	return provider, nil
}

// validateOAuthConfig validates the OAuth configuration
func validateOAuthConfig(config *MCPAuthConfig) error {
	if config.IssuerURL == "" {
		return fmt.Errorf("issuer_url is required")
	}
	if config.UpstreamAuthURL == "" {
		return fmt.Errorf("upstream_auth_url is required")
	}
	if config.UpstreamTokenURL == "" {
		return fmt.Errorf("upstream_token_url is required")
	}
	if config.IntrospectionEndpoint == "" {
		return fmt.Errorf("introspection_endpoint is required")
	}
	if len(config.RequiredScopes) == 0 {
		return fmt.Errorf("required_scopes must contain at least one scope")
	}

	// Validate URLs
	if _, err := url.Parse(config.IssuerURL); err != nil {
		return fmt.Errorf("invalid issuer_url: %w", err)
	}
	if config.BaseURL != nil {
		if _, err := url.Parse(*config.BaseURL); err != nil {
			return fmt.Errorf("invalid base_url: %w", err)
		}
	}
	if _, err := url.Parse(config.UpstreamAuthURL); err != nil {
		return fmt.Errorf("invalid upstream_auth_url: %w", err)
	}
	if _, err := url.Parse(config.UpstreamTokenURL); err != nil {
		return fmt.Errorf("invalid upstream_token_url: %w", err)
	}
	if _, err := url.Parse(config.IntrospectionEndpoint); err != nil {
		return fmt.Errorf("invalid introspection_endpoint: %w", err)
	}

	return nil
}

// initialize sets up the OAuth provider and auth router
func (p *MCPOAuthProvider) initialize() error {
	// Create the proxy OAuth provider
	p.provider = NewProxyOAuthServerProvider(ProxyOptions{
		Endpoints: ProxyEndpoints{
			AuthorizationURL: p.config.UpstreamAuthURL,
			TokenURL:         p.config.UpstreamTokenURL,
			RevocationURL:    p.config.UpstreamRevocationURL,
			RegistrationURL:  p.config.UpstreamRegistrationURL,
		},
		VerifyAccessToken: p.verifyAccessToken,
		GetClient:         p.getClient,
		HTTPClient:        p.httpClient,
	})

	p.logger.Info("OAuth provider initialized successfully",
		zap.String("issuer_url", p.config.IssuerURL),
		zap.Strings("required_scopes", p.config.RequiredScopes))

	return nil
}

// verifyAccessToken verifies an access token with the upstream OAuth server
func (p *MCPOAuthProvider) verifyAccessToken(ctx context.Context, token string) (*AuthInfo, error) {
	start := time.Now()
	defer func() {
		p.logger.Debug("Token verification completed",
			zap.Duration("duration", time.Since(start)))
	}()

	// Create introspection request
	data := url.Values{}
	data.Set("token", token)

	req, err := http.NewRequestWithContext(ctx, "POST", p.config.IntrospectionEndpoint,
		strings.NewReader(data.Encode()))
	if err != nil {
		p.logger.Error("Failed to create introspection request", zap.Error(err))
		return nil, fmt.Errorf("failed to create introspection request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		p.logger.Error("Introspection request failed", zap.Error(err))
		return nil, fmt.Errorf("introspection request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		p.logger.Warn("Token introspection failed",
			zap.Int("status_code", resp.StatusCode),
			zap.String("response_body", string(body)))
		return nil, fmt.Errorf("token introspection failed with status %d", resp.StatusCode)
	}

	var introspection struct {
		Active    bool     `json:"active"`
		ClientID  string   `json:"client_id"`
		Scope     string   `json:"scope"`
		ExpiresAt int64    `json:"exp"`
		Username  string   `json:"username,omitempty"`
		Subject   string   `json:"sub,omitempty"`
		Audience  []string `json:"aud,omitempty"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&introspection); err != nil {
		p.logger.Error("Failed to parse introspection response", zap.Error(err))
		return nil, fmt.Errorf("failed to parse introspection response: %w", err)
	}

	if !introspection.Active {
		p.logger.Debug("Token is not active")
		return nil, fmt.Errorf("token is not active")
	}

	// Parse scopes
	var scopes []string
	if introspection.Scope != "" {
		scopes = strings.Fields(introspection.Scope)
	}

	// Validate required scopes
	if !p.hasRequiredScopes(scopes) {
		p.logger.Warn("Token missing required scopes",
			zap.Strings("token_scopes", scopes),
			zap.Strings("required_scopes", p.config.RequiredScopes))
		return nil, fmt.Errorf("token missing required scopes")
	}

	authInfo := &AuthInfo{
		Token:     token,
		ClientID:  introspection.ClientID,
		Scopes:    scopes,
		ExpiresAt: introspection.ExpiresAt,
	}

	p.logger.Debug("Token verification successful",
		zap.String("client_id", authInfo.ClientID),
		zap.Strings("scopes", authInfo.Scopes))

	return authInfo, nil
}

// hasRequiredScopes checks if the token has all required scopes
func (p *MCPOAuthProvider) hasRequiredScopes(tokenScopes []string) bool {
	tokenScopeSet := make(map[string]bool)
	for _, scope := range tokenScopes {
		tokenScopeSet[scope] = true
	}

	for _, required := range p.config.RequiredScopes {
		if !tokenScopeSet[required] {
			return false
		}
	}

	return true
}

// getClient retrieves client information
func (p *MCPOAuthProvider) getClient(ctx context.Context, clientID string) (*OAuthClientInformationFull, error) {
	p.logger.Debug("Getting client information", zap.String("client_id", clientID))

	if clientID == "" {
		return nil, fmt.Errorf("empty client ID")
	}

	// For MCP server, we implement a simple client registry
	// In a production environment, you might want to:
	// 1. Cache client information
	// 2. Look up from a database
	// 3. Call an upstream client registry service

	// Basic client information - this could be enhanced based on your needs
	scope := strings.Join(p.config.RequiredScopes, " ")
	client := &OAuthClientInformationFull{
		OAuthClientInformation: OAuthClientInformation{
			ClientID: clientID,
			// Note: For public clients (like MCP clients), client_secret might be nil
		},
		OAuthClientMetadata: OAuthClientMetadata{
			RedirectURIs: []string{
				"http://localhost",  // For local development
				"https://localhost", // For local HTTPS development
				"vscode://",         // For VS Code extension
				"cursor://",         // For Cursor editor
			},
			GrantTypes:    []string{"authorization_code", "refresh_token"},
			ResponseTypes: []string{"code"},
			Scope:         &scope,
		},
	}

	p.logger.Debug("Client information retrieved",
		zap.String("client_id", clientID),
		zap.Strings("redirect_uris", client.RedirectURIs))

	return client, nil
}

// GetProvider returns the underlying OAuth server provider
func (p *MCPOAuthProvider) GetProvider() OAuthServerProvider {
	return p.provider
}

// CreateAuthRouter creates and returns an HTTP auth router
func (p *MCPOAuthProvider) CreateAuthRouter() (*AuthRouter, error) {
	issuerURL, err := url.Parse(p.config.IssuerURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse issuer URL: %w", err)
	}

	var baseURL *url.URL
	if p.config.BaseURL != nil {
		baseURL, err = url.Parse(*p.config.BaseURL)
		if err != nil {
			return nil, fmt.Errorf("failed to parse base URL: %w", err)
		}
	}

	authRouter := NewAuthRouter(AuthRouterOptions{
		Provider:                p.provider,
		IssuerURL:               issuerURL,
		BaseURL:                 baseURL,
		ScopesSupported:         p.config.RequiredScopes,
		ResourceName:            p.config.ResourceName,
		ServiceDocumentationURL: p.config.ServiceDocumentationURL,
	})

	return authRouter, nil
}

// GetRequiredScopes returns the required scopes for MCP access
func (p *MCPOAuthProvider) GetRequiredScopes() []string {
	return p.config.RequiredScopes
}

// IsEnabled returns whether OAuth is enabled
func (p *MCPOAuthProvider) IsEnabled() bool {
	return p.config != nil && p.config.Enabled
}

// Shutdown performs any necessary cleanup
func (p *MCPOAuthProvider) Shutdown(ctx context.Context) error {
	p.logger.Info("Shutting down OAuth provider")
	// Add any cleanup logic here if needed
	return nil
}
