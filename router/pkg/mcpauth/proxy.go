// Package mcpauth provides OAuth 2.1 + PKCE authentication for MCP (Model Context Protocol) servers.
//
// # Proxy OAuth Server Provider
//
// The ProxyOAuthServerProvider enables integration with existing OAuth 2.0/2.1 providers
// (Auth0, Okta, AWS Cognito, etc.) by proxying requests to upstream OAuth servers.
// This is the recommended approach for production environments.
//
// ## When to Use Proxy vs Demo Provider
//
// **Use ProxyOAuthServerProvider when:**
//   - Integrating with existing OAuth infrastructure (Auth0, Okta, etc.)
//   - Production deployments requiring enterprise-grade security
//   - Need centralized user management across multiple services
//   - Compliance requirements mandate using certified OAuth providers
//
// **Use DemoInMemoryAuthProvider when:**
//   - Development and testing environments
//   - Quick prototyping and demos
//   - Local development without external dependencies
//
// ## Basic Usage
//
//	// 1. Configure upstream OAuth provider endpoints
//	endpoints := ProxyEndpoints{
//	    AuthorizationURL: "https://auth0.example.com/authorize",
//	    TokenURL:         "https://auth0.example.com/oauth/token",
//	    RevocationURL:    stringPtr("https://auth0.example.com/oauth/revoke"), // Optional
//	    RegistrationURL:  nil, // Optional - for dynamic client registration
//	}
//
//	// 2. Implement token verification (integrate with your OAuth provider's token introspection)
//	verifyToken := func(ctx context.Context, token string) (*AuthInfo, error) {
//	    // Call your OAuth provider's token introspection endpoint
//	    // or validate JWT tokens locally with public keys
//	    return &AuthInfo{
//	        Token:     token,
//	        ClientID:  "extracted-from-token",
//	        Scopes:    []string{"mcp:read", "mcp:write"},
//	        ExpiresAt: time.Now().Add(time.Hour).Unix(),
//	    }, nil
//	}
//
//	// 3. Implement client lookup (integrate with your OAuth provider's client management)
//	getClient := func(ctx context.Context, clientID string) (*OAuthClientInformationFull, error) {
//	    // Fetch client information from your OAuth provider or local database
//	    return &OAuthClientInformationFull{
//	        OAuthClientInformation: OAuthClientInformation{
//	            ClientID:     clientID,
//	            ClientSecret: stringPtr("secret-from-provider"),
//	        },
//	        OAuthClientMetadata: OAuthClientMetadata{
//	            RedirectURIs: []string{"https://myapp.com/callback"},
//	            GrantTypes:   []string{"authorization_code", "refresh_token"},
//	        },
//	    }, nil
//	}
//
//	// 4. Create proxy provider
//	provider := NewProxyOAuthServerProvider(ProxyOptions{
//	    Endpoints:         endpoints,
//	    VerifyAccessToken: verifyToken,
//	    GetClient:         getClient,
//	    HTTPClient:        &http.Client{Timeout: 30 * time.Second}, // Optional
//	})
//
//	// 5. Create OAuth router
//	issuerURL, _ := url.Parse("https://localhost:5025/oauth")
//	authRouter := NewAuthRouter(AuthRouterOptions{
//	    Provider:    provider,
//	    IssuerURL:   issuerURL,
//	    ScopesSupported: []string{"mcp:read", "mcp:write"},
//	})
//
//	// 6. Mount OAuth endpoints and protect MCP routes
//	http.Handle("/oauth/", authRouter)
//
//	protected := RequireBearerAuth(provider, []string{"mcp:read"})
//	http.Handle("/mcp", protected(mcpHandler))
//
// ## Integration Examples
//
// ### Auth0 Integration
//
//	// Auth0 token verification using JWT validation
//	verifyAuth0Token := func(ctx context.Context, token string) (*AuthInfo, error) {
//	    // Parse and validate JWT token with Auth0 public keys
//	    // See: https://auth0.com/docs/secure/tokens/access-tokens/validate-access-tokens
//	    claims, err := validateAuth0JWT(token)
//	    if err != nil {
//	        return nil, err
//	    }
//	    return &AuthInfo{
//	        Token:     token,
//	        ClientID:  claims.ClientID,
//	        Scopes:    strings.Split(claims.Scope, " "),
//	        ExpiresAt: claims.ExpiresAt,
//	    }, nil
//	}
//
// ### AWS Cognito Integration
//
//	// Cognito token verification using AWS SDK
//	verifyCognitoToken := func(ctx context.Context, token string) (*AuthInfo, error) {
//	    // Use AWS Cognito SDK to verify token
//	    // See: https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html
//	    result, err := cognitoClient.GetUser(&cognito.GetUserInput{
//	        AccessToken: aws.String(token),
//	    })
//	    if err != nil {
//	        return nil, err
//	    }
//	    return &AuthInfo{
//	        Token:     token,
//	        ClientID:  extractClientID(result),
//	        Scopes:    extractScopes(result),
//	        ExpiresAt: extractExpiry(result),
//	    }, nil
//	}
//
// ## Security Considerations
//
// - **Token Verification**: Always implement proper token verification with your OAuth provider
// - **HTTPS Only**: Use HTTPS in production for all OAuth endpoints
// - **Client Secrets**: Store client secrets securely (environment variables, secret managers)
// - **Rate Limiting**: Implement rate limiting on OAuth endpoints
// - **Logging**: Log OAuth operations for security monitoring (but never log tokens/secrets)
//
// ## Flow Diagram
//
//	┌─────────────┐    ┌──────────────┐    ┌─────────────────┐    ┌──────────────┐
//	│   Client    │    │ MCP Router   │    │ Upstream OAuth  │    │ MCP Server   │
//	│ Application │    │ (mcpauth)    │    │ Provider        │    │              │
//	└─────────────┘    └──────────────┘    └─────────────────┘    └──────────────┘
//	       │                   │                      │                    │
//	       │ 1. GET /authorize │                      │                    │
//	       ├──────────────────►│                      │                    │
//	       │                   │ 2. Redirect to       │                    │
//	       │                   │    upstream OAuth    │                    │
//	       │                   ├─────────────────────►│                    │
//	       │                   │                      │ 3. User consents   │
//	       │ 4. Redirect with  │                      │    & redirects     │
//	       │    auth code      │◄─────────────────────┤    back            │
//	       │◄──────────────────┤                      │                    │
//	       │                   │                      │                    │
//	       │ 5. POST /token    │                      │                    │
//	       ├──────────────────►│ 6. Proxy token       │                    │
//	       │                   │    exchange          │                    │
//	       │                   ├─────────────────────►│                    │
//	       │                   │ 7. Return tokens     │                    │
//	       │ 8. Access tokens  │◄─────────────────────┤                    │
//	       │◄──────────────────┤                      │                    │
//	       │                   │                      │                    │
//	       │ 9. Call MCP with  │                      │                    │
//	       │    Bearer token   │                      │                    │
//	       ├──────────────────►│ 10. Verify token     │                    │
//	       │                   │     with provider    │                    │
//	       │                   ├─────────────────────►│                    │
//	       │                   │ 11. Token valid      │                    │
//	       │                   │◄─────────────────────┤                    │
//	       │                   │ 12. Forward to MCP   │                    │
//	       │                   ├───────────────────────────────────────────►│
//	       │                   │ 13. MCP response     │                    │
//	       │ 14. MCP response  │◄───────────────────────────────────────────┤
//	       │◄──────────────────┤                      │                    │
package mcpauth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// ProxyEndpoints defines the upstream OAuth server endpoints for proxying requests.
// Configure these endpoints to point to your OAuth provider's URLs.
//
// Example for Auth0:
//
//	ProxyEndpoints{
//	    AuthorizationURL: "https://your-domain.auth0.com/authorize",
//	    TokenURL:         "https://your-domain.auth0.com/oauth/token",
//	    RevocationURL:    stringPtr("https://your-domain.auth0.com/oauth/revoke"),
//	}
type ProxyEndpoints struct {
	// AuthorizationURL is the upstream OAuth authorization endpoint (REQUIRED)
	// Users will be redirected here for consent during the authorization code flow
	AuthorizationURL string `json:"authorization_url"`

	// TokenURL is the upstream OAuth token endpoint (REQUIRED)
	// Used for exchanging authorization codes and refresh tokens for access tokens
	TokenURL string `json:"token_url"`

	// RevocationURL is the upstream OAuth token revocation endpoint (OPTIONAL)
	// If provided, enables RFC 7009 token revocation support
	// Set to nil if your OAuth provider doesn't support token revocation
	RevocationURL *string `json:"revocation_url,omitempty"`

	// RegistrationURL is the upstream OAuth dynamic client registration endpoint (OPTIONAL)
	// If provided, enables RFC 7591 dynamic client registration support
	// Set to nil if you manage OAuth clients manually or don't support dynamic registration
	RegistrationURL *string `json:"registration_url,omitempty"`
}

// ProxyClientStore implements OAuthClientStore by proxying client operations to upstream OAuth server.
// It handles client lookup and optional dynamic client registration by delegating to the configured
// upstream OAuth provider.
type ProxyClientStore struct {
	// getClient function to retrieve client information from upstream provider or local database
	getClient func(ctx context.Context, clientID string) (*OAuthClientInformationFull, error)

	// registrationURL for dynamic client registration (RFC 7591)
	// If nil, client registration operations will return an error
	registrationURL *string

	// httpClient for making HTTP requests to upstream endpoints
	httpClient *http.Client
}

// GetClient retrieves OAuth client information for the specified client ID.
// This method delegates to the configured getClient function, which should:
//   - Fetch client details from your OAuth provider's client management API
//   - Or retrieve from a local database/cache for performance
//   - Return complete client information including secrets and metadata
//
// Returns an error if the client doesn't exist or cannot be retrieved.
func (p *ProxyClientStore) GetClient(ctx context.Context, clientID string) (*OAuthClientInformationFull, error) {
	return p.getClient(ctx, clientID)
}

// RegisterClient registers a new OAuth client with the upstream OAuth provider using RFC 7591
// Dynamic Client Registration. This method proxies the registration request to the configured
// upstream registration endpoint.
//
// The upstream OAuth provider will:
//   - Validate the client metadata
//   - Generate client credentials (client_id, client_secret)
//   - Return the complete client information
//
// Returns an error if:
//   - No registration URL is configured (dynamic registration not supported)
//   - The upstream provider rejects the registration request
//   - Network or parsing errors occur
//
// Example usage:
//
//	client := &OAuthClientInformationFull{
//	    OAuthClientMetadata: OAuthClientMetadata{
//	        RedirectURIs: []string{"https://myapp.com/callback"},
//	        GrantTypes:   []string{"authorization_code", "refresh_token"},
//	        Scope:        stringPtr("mcp:read mcp:write"),
//	    },
//	}
//	registered, err := store.RegisterClient(ctx, client)
func (p *ProxyClientStore) RegisterClient(ctx context.Context, client *OAuthClientInformationFull) (*OAuthClientInformationFull, error) {
	if p.registrationURL == nil {
		return nil, fmt.Errorf("client registration not supported - no registration URL configured")
	}

	jsonData, err := json.Marshal(client)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal client data: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", *p.registrationURL, bytes.NewReader(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create registration request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("registration request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("client registration failed with status: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read registration response: %w", err)
	}

	var registeredClient OAuthClientInformationFull
	if err := json.Unmarshal(body, &registeredClient); err != nil {
		return nil, fmt.Errorf("failed to parse registration response: %w", err)
	}

	return &registeredClient, nil
}

// ProxyOAuthServerProvider implements OAuthServerProvider by proxying requests to an upstream OAuth server.
// This is the production-ready implementation that integrates with existing OAuth 2.0/2.1 providers
// like Auth0, Okta, AWS Cognito, Azure AD, Google Identity, etc.
//
// The proxy provider:
//   - Redirects authorization requests to the upstream OAuth server
//   - Proxies token exchange requests to the upstream token endpoint
//   - Delegates token verification to your custom verification logic
//   - Handles token revocation and optional dynamic client registration
//   - Skips local PKCE validation (delegated to upstream provider)
//
// This approach provides enterprise-grade security while maintaining compatibility with
// the MCP authentication framework.
type ProxyOAuthServerProvider struct {
	// endpoints configuration for the upstream OAuth server
	endpoints ProxyEndpoints

	// verifyAccessToken function to verify tokens with the upstream provider
	verifyAccessToken func(ctx context.Context, token string) (*AuthInfo, error)

	// getClient function to retrieve client information
	getClient func(ctx context.Context, clientID string) (*OAuthClientInformationFull, error)

	// httpClient for making HTTP requests to upstream endpoints
	httpClient *http.Client

	// clientStore for OAuth client operations
	clientStore *ProxyClientStore

	// skipLocalPkceValidation indicates PKCE validation is handled upstream
	skipLocalPkceValidation bool
}

// ProxyOptions contains configuration for creating a ProxyOAuthServerProvider.
// All fields except HTTPClient are required for proper operation.
type ProxyOptions struct {
	// Endpoints for the upstream OAuth server (REQUIRED)
	// Configure these to point to your OAuth provider's endpoints
	Endpoints ProxyEndpoints `json:"endpoints"`

	// VerifyAccessToken function to verify access tokens and return auth info (REQUIRED)
	// This function should:
	//   - Validate the token with your OAuth provider (JWT verification, introspection, etc.)
	//   - Extract client ID, scopes, and expiration from the token
	//   - Return AuthInfo with the extracted information
	//   - Return an error if the token is invalid, expired, or verification fails
	//
	// Example implementation for JWT-based tokens:
	//   func(ctx context.Context, token string) (*AuthInfo, error) {
	//       claims, err := validateJWT(token)
	//       if err != nil { return nil, err }
	//       return &AuthInfo{
	//           Token: token, ClientID: claims.ClientID,
	//           Scopes: strings.Split(claims.Scope, " "), ExpiresAt: claims.ExpiresAt,
	//       }, nil
	//   }
	VerifyAccessToken func(ctx context.Context, token string) (*AuthInfo, error)

	// GetClient function to fetch client information from the upstream server (REQUIRED)
	// This function should:
	//   - Retrieve client details from your OAuth provider's client management API
	//   - Or fetch from a local database/cache for better performance
	//   - Return complete client information including secrets and redirect URIs
	//   - Return an error if the client doesn't exist or cannot be retrieved
	//
	// Example implementation:
	//   func(ctx context.Context, clientID string) (*OAuthClientInformationFull, error) {
	//       client, err := fetchClientFromDatabase(clientID)
	//       if err != nil { return nil, err }
	//       return client, nil
	//   }
	GetClient func(ctx context.Context, clientID string) (*OAuthClientInformationFull, error)

	// HTTPClient for making requests to upstream endpoints (OPTIONAL)
	// If nil, a default HTTP client will be created
	// Configure timeouts, TLS settings, and other HTTP options as needed for your environment
	HTTPClient *http.Client
}

// NewProxyOAuthServerProvider creates a new proxy OAuth server provider that delegates
// OAuth operations to an upstream OAuth server.
//
// This is the recommended approach for production environments where you want to leverage
// existing OAuth infrastructure while providing MCP-specific authentication endpoints.
//
// The created provider will:
//   - Proxy authorization and token requests to your OAuth provider
//   - Use your custom token verification and client lookup functions
//   - Support optional token revocation and dynamic client registration
//   - Skip local PKCE validation (delegated to upstream provider)
//
// Example:
//
//	provider := NewProxyOAuthServerProvider(ProxyOptions{
//	    Endpoints: ProxyEndpoints{
//	        AuthorizationURL: "https://auth.example.com/authorize",
//	        TokenURL:         "https://auth.example.com/token",
//	    },
//	    VerifyAccessToken: myTokenVerifier,
//	    GetClient:         myClientLookup,
//	})
func NewProxyOAuthServerProvider(options ProxyOptions) *ProxyOAuthServerProvider {
	httpClient := options.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{}
	}

	clientStore := &ProxyClientStore{
		getClient:       options.GetClient,
		registrationURL: options.Endpoints.RegistrationURL,
		httpClient:      httpClient,
	}

	return &ProxyOAuthServerProvider{
		endpoints:               options.Endpoints,
		verifyAccessToken:       options.VerifyAccessToken,
		getClient:               options.GetClient,
		httpClient:              httpClient,
		clientStore:             clientStore,
		skipLocalPkceValidation: true, // Skip local PKCE validation for proxy
	}
}

// Authorize initiates the OAuth authorization flow by redirecting the user to the upstream
// OAuth provider's authorization endpoint. This implements the first step of the OAuth 2.1
// authorization code flow with PKCE.
//
// The method:
//  1. Constructs the authorization URL with all required parameters
//  2. Includes PKCE parameters (code_challenge, code_challenge_method)
//  3. Preserves the state parameter for CSRF protection
//  4. Redirects the user's browser to the upstream authorization endpoint
//
// The upstream OAuth provider will:
//   - Present a consent screen to the user
//   - Validate the client and redirect URI
//   - Generate an authorization code upon user consent
//   - Redirect back to the specified redirect_uri with the code
//
// Parameters:
//   - ctx: Request context for cancellation and timeouts
//   - client: OAuth client information including client_id and redirect URIs
//   - params: Authorization parameters including redirect_uri, code_challenge, state, scopes
//   - w: HTTP response writer for sending the redirect response
//
// Returns an error if the authorization URL is malformed or the redirect fails.
func (p *ProxyOAuthServerProvider) Authorize(ctx context.Context, client *OAuthClientInformationFull, params *AuthorizationParams, w http.ResponseWriter, r *http.Request) error {
	targetURL, err := url.Parse(p.endpoints.AuthorizationURL)
	if err != nil {
		return fmt.Errorf("invalid authorization URL: %w", err)
	}

	// Build query parameters for the upstream authorization endpoint
	q := targetURL.Query()
	if client.ClientID != nil {
		q.Set("client_id", *client.ClientID)
	}
	q.Set("response_type", "code")
	q.Set("redirect_uri", params.RedirectURI)
	q.Set("code_challenge", params.CodeChallenge)
	q.Set("code_challenge_method", "S256")

	if params.State != nil {
		q.Set("state", *params.State)
	}

	if len(params.Scopes) > 0 {
		q.Set("scope", strings.Join(params.Scopes, " "))
	}

	targetURL.RawQuery = q.Encode()

	// Redirect user to upstream OAuth provider for consent
	http.Redirect(w, r, targetURL.String(), http.StatusFound)
	return nil
}

// ChallengeForAuthorizationCode returns the PKCE code challenge for verification.
// In proxy mode, this always returns an empty string since PKCE validation is
// delegated to the upstream OAuth provider.
//
// The upstream provider will:
//   - Store the code_challenge during authorization
//   - Validate the code_verifier during token exchange
//   - Handle all PKCE cryptographic operations
//
// This design ensures compatibility while leveraging the upstream provider's
// proven PKCE implementation.
func (p *ProxyOAuthServerProvider) ChallengeForAuthorizationCode(ctx context.Context, client *OAuthClientInformationFull, authorizationCode string) (string, error) {
	// In a proxy setup, we don't store the code challenge ourselves
	// Instead, we proxy the token request and let the upstream server validate it

	panic("should not be called in proxy mode")
}

// ExchangeAuthorizationCode exchanges an authorization code for access and refresh tokens
// by proxying the request to the upstream OAuth provider's token endpoint.
//
// This implements the second step of the OAuth 2.1 authorization code flow, where:
//  1. The client provides the authorization code received from the authorization endpoint
//  2. The proxy forwards the token exchange request to the upstream provider
//  3. The upstream provider validates the authorization code and PKCE parameters
//  4. If valid, the upstream provider returns access and refresh tokens
//  5. The proxy returns these tokens to the client
//
// The method handles:
//   - Authorization code validation (delegated to upstream)
//   - PKCE code_verifier verification (delegated to upstream)
//   - Client authentication (client_secret if confidential client)
//   - Token generation and response formatting
//
// Parameters:
//   - ctx: Request context for cancellation and timeouts
//   - client: OAuth client information including credentials
//   - authorizationCode: The authorization code to exchange
//   - codeVerifier: PKCE code verifier for validation (optional for public clients)
//   - redirectURI: Must match the redirect_uri used in authorization (optional)
//
// Returns:
//   - OAuthTokens containing access_token, refresh_token, and metadata
//   - Error if the code is invalid, expired, or exchange fails
func (p *ProxyOAuthServerProvider) ExchangeAuthorizationCode(ctx context.Context, client *OAuthClientInformationFull, authorizationCode string, codeVerifier *string, redirectURI *string) (*OAuthTokens, error) {
	data := url.Values{}
	data.Set("grant_type", "authorization_code")
	if client.ClientID != nil {
		data.Set("client_id", *client.ClientID)
	}
	data.Set("code", authorizationCode)

	// Include client secret for confidential clients
	if client.ClientSecret != nil {
		data.Set("client_secret", *client.ClientSecret)
	}

	// Include PKCE code verifier for validation
	if codeVerifier != nil {
		data.Set("code_verifier", *codeVerifier)
	}

	// Include redirect URI if provided (must match authorization request)
	if redirectURI != nil {
		data.Set("redirect_uri", *redirectURI)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", p.endpoints.TokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create token request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token exchange request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("token exchange failed with status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read token response: %w", err)
	}

	var tokens OAuthTokens
	if err := json.Unmarshal(body, &tokens); err != nil {
		return nil, fmt.Errorf("failed to parse token response: %w", err)
	}

	return &tokens, nil
}

// ExchangeRefreshToken exchanges a refresh token for new access tokens by proxying
// the request to the upstream OAuth provider's token endpoint.
//
// This implements the OAuth 2.1 refresh token flow, where:
//  1. The client provides a valid refresh token
//  2. The proxy forwards the refresh request to the upstream provider
//  3. The upstream provider validates the refresh token and client credentials
//  4. If valid, new access and refresh tokens are issued
//  5. The proxy returns the new tokens to the client
//
// The method handles:
//   - Refresh token validation (delegated to upstream)
//   - Client authentication (client_secret if confidential client)
//   - Optional scope restrictions (cannot exceed original scope)
//   - Token rotation (new refresh token may be issued)
//
// Parameters:
//   - ctx: Request context for cancellation and timeouts
//   - client: OAuth client information including credentials
//   - refreshToken: The refresh token to exchange
//   - scopes: Optional scope restriction (must be subset of original scopes)
//
// Returns:
//   - OAuthTokens containing new access_token and optionally new refresh_token
//   - Error if the refresh token is invalid, expired, or exchange fails
func (p *ProxyOAuthServerProvider) ExchangeRefreshToken(ctx context.Context, client *OAuthClientInformationFull, refreshToken string, scopes []string) (*OAuthTokens, error) {
	data := url.Values{}
	data.Set("grant_type", "refresh_token")
	if client.ClientID != nil {
		data.Set("client_id", *client.ClientID)
	}
	data.Set("refresh_token", refreshToken)

	// Include client secret for confidential clients
	if client.ClientSecret != nil {
		data.Set("client_secret", *client.ClientSecret)
	}

	// Include scope restriction if requested
	if len(scopes) > 0 {
		data.Set("scope", strings.Join(scopes, " "))
	}

	req, err := http.NewRequestWithContext(ctx, "POST", p.endpoints.TokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create refresh request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token refresh request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("token refresh failed with status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read refresh response: %w", err)
	}

	var tokens OAuthTokens
	if err := json.Unmarshal(body, &tokens); err != nil {
		return nil, fmt.Errorf("failed to parse refresh response: %w", err)
	}

	return &tokens, nil
}

// VerifyAccessToken verifies an access token's validity and returns authentication information.
// This method delegates to the configured verifyAccessToken function, which should implement
// token verification logic specific to your OAuth provider.
//
// Common verification approaches:
//   - JWT validation with public keys (for self-contained tokens)
//   - Token introspection endpoint calls (RFC 7662)
//   - Database/cache lookup for opaque tokens
//   - Hybrid approaches combining multiple methods
//
// The verification function should:
//   - Validate token signature and expiration
//   - Extract client ID, scopes, and other claims
//   - Return structured AuthInfo for downstream use
//   - Handle errors gracefully (expired, malformed, revoked tokens)
//
// Parameters:
//   - ctx: Request context for cancellation and timeouts
//   - token: The access token to verify
//
// Returns:
//   - AuthInfo containing token metadata and claims
//   - Error if token is invalid, expired, or verification fails
func (p *ProxyOAuthServerProvider) VerifyAccessToken(ctx context.Context, token string) (*AuthInfo, error) {
	return p.verifyAccessToken(ctx, token)
}

// RevokeToken revokes an access or refresh token at the upstream OAuth provider
// using RFC 7009 token revocation. This immediately invalidates the token,
// preventing further use.
//
// Token revocation is useful for:
//   - User logout scenarios (revoke all tokens)
//   - Security incidents (immediately disable compromised tokens)
//   - Client deauthorization (revoke tokens for specific clients)
//   - Compliance requirements (explicit token lifecycle management)
//
// The method:
//  1. Sends a revocation request to the upstream provider's revocation endpoint
//  2. Includes the token and optional type hint for efficiency
//  3. Authenticates using client credentials
//  4. Returns success if the token is revoked or already invalid
//
// Parameters:
//   - ctx: Request context for cancellation and timeouts
//   - client: OAuth client information including credentials
//   - request: Revocation request containing token and optional type hint
//
// Returns an error if:
//   - No revocation URL is configured (revocation not supported)
//   - The upstream provider rejects the revocation request
//   - Network or authentication errors occur
//
// Note: Per RFC 7009, revocation endpoints should return 200 OK even for
// invalid tokens to prevent token scanning attacks.
func (p *ProxyOAuthServerProvider) RevokeToken(ctx context.Context, client *OAuthClientInformationFull, request *OAuthTokenRevocationRequest) error {
	if p.endpoints.RevocationURL == nil {
		return fmt.Errorf("token revocation not supported - no revocation URL configured")
	}

	data := url.Values{}
	data.Set("token", request.Token)
	if client.ClientID != nil {
		data.Set("client_id", *client.ClientID)
	}

	// Include client secret for confidential clients
	if client.ClientSecret != nil {
		data.Set("client_secret", *client.ClientSecret)
	}

	// Include token type hint for optimization (access_token or refresh_token)
	if request.TokenTypeHint != nil {
		data.Set("token_type_hint", *request.TokenTypeHint)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", *p.endpoints.RevocationURL, strings.NewReader(data.Encode()))
	if err != nil {
		return fmt.Errorf("failed to create revocation request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("token revocation request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("token revocation failed with status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// GetClientStore returns the OAuth client store for managing client information.
// The returned store handles client lookup and optional dynamic registration
// by delegating to the configured upstream OAuth provider.
func (p *ProxyOAuthServerProvider) GetClientStore() OAuthClientStore {
	return p.clientStore
}

// SkipLocalPKCEValidation returns true indicating that PKCE validation is handled
// by the upstream OAuth provider rather than locally.
//
// In proxy mode:
//   - The authorization endpoint receives and stores code_challenge
//   - The token endpoint validates code_verifier against stored challenge
//   - All PKCE cryptographic operations are performed upstream
//   - This ensures compatibility with the upstream provider's PKCE implementation
//
// This is the recommended approach as it leverages proven, audited PKCE
// implementations from established OAuth providers.
func (p *ProxyOAuthServerProvider) SkipLocalPKCEValidation() bool {
	return p.skipLocalPkceValidation
}
