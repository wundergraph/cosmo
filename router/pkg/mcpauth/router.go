package mcpauth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// contextKey is a custom type for context keys to avoid collisions
type contextKey string

// authInfoKey is the context key for storing auth information
const authInfoKey contextKey = "auth"

// AuthRouter provides OAuth 2.1 + PKCE authentication endpoints for MCP servers.
// Implements a complete OAuth authorization server with standard endpoints:
//   - /authorize: Authorization endpoint for PKCE flow
//   - /token: Token endpoint for code exchange and refresh
//   - /register: Dynamic client registration (RFC 7591)
//   - /revoke: Token revocation (RFC 7009)
//   - /.well-known/*: OAuth metadata endpoints (RFC 8414)
type AuthRouter struct {
	provider               OAuthServerProvider // OAuth server implementation (proxy or demo)
	issuerURL              *url.URL            // Base URL for OAuth endpoints
	baseURL                *url.URL            // Base URL for OAuth endpoints (defaults to issuerURL if not provided)
	scopesSupported        []string            // Supported OAuth scopes (e.g., ["mcp:read", "mcp:write"])
	resourceName           *string             // Human-readable resource name
	serviceDocURL          *string             // URL to service documentation
	clientSecretExpiryTime time.Duration       // How long client secrets remain valid (0 = never expire)
	mux                    *http.ServeMux      // HTTP multiplexer for routing requests
}

// AuthRouterOptions contains configuration for creating an OAuth auth router.
type AuthRouterOptions struct {
	Provider                OAuthServerProvider // OAuth provider implementation
	IssuerURL               *url.URL            // Base URL for OAuth endpoints (e.g., https://api.example.com/oauth)
	BaseURL                 *url.URL            // Optional base URL for OAuth endpoints (defaults to IssuerURL if not provided)
	ScopesSupported         []string            // OAuth scopes this server supports
	ResourceName            *string             // Human-readable name for the protected resource
	ServiceDocumentationURL *string             // URL to API documentation
	ClientSecretExpiryTime  time.Duration       // How long client secrets remain valid (0 = never expire, default = 30 days)
}

// NewAuthRouter creates a new OAuth 2.1 + PKCE authentication router.
// The router implements all standard OAuth endpoints and can be mounted on any path.
//
// Basic Example:
//
//	router := NewAuthRouter(AuthRouterOptions{
//	    Provider:    provider,
//	    IssuerURL:   mustParse("https://api.example.com/oauth"),
//	    ScopesSupported: []string{"mcp:read", "mcp:write"},
//	    ClientSecretExpiryTime: 7 * 24 * time.Hour, // 7 days (optional, defaults to 30 days)
//	})
//	http.Handle("/oauth/", router)
//
// Separate Domain Example (OAuth endpoints served from different domain):
//
//	router := NewAuthRouter(AuthRouterOptions{
//	    Provider:    provider,
//	    IssuerURL:   mustParse("https://mcp.example.com/oauth"),    // Identity server URL
//	    BaseURL:     mustParse("https://auth.example.com/oauth"),   // OAuth endpoints domain
//	    ScopesSupported: []string{"mcp:read", "mcp:write"},
//	})
//	// Mount on the auth domain at https://auth.example.com/oauth/
//	http.Handle("/oauth/", router)
//
// The BaseURL parameter allows OAuth endpoints to be served from a different domain than the issuer.
// If BaseURL is not provided, it defaults to IssuerURL. This is useful when:
//   - OAuth endpoints need to be served from a different domain than the MCP server
//   - Load balancing or routing requires endpoints on specific hosts
//   - Separating authorization and resource server domains for security
//   - Using a dedicated OAuth subdomain (e.g., auth.example.com) while MCP runs on api.example.com
//
// Client secret expiry options:
//   - Default: 30 days
//   - Custom: Any time.Duration (e.g., 7*24*time.Hour for 7 days)
//   - Never expire: Set to 0 (not recommended for production)
func NewAuthRouter(options AuthRouterOptions) *AuthRouter {
	// Set default client secret expiry time if not specified
	clientSecretExpiryTime := options.ClientSecretExpiryTime
	if clientSecretExpiryTime == 0 {
		clientSecretExpiryTime = 30 * 24 * time.Hour // 30 days
	}

	router := &AuthRouter{
		provider:               options.Provider,
		issuerURL:              options.IssuerURL,
		baseURL:                options.BaseURL,
		scopesSupported:        options.ScopesSupported,
		resourceName:           options.ResourceName,
		serviceDocURL:          options.ServiceDocumentationURL,
		clientSecretExpiryTime: clientSecretExpiryTime,
		mux:                    http.NewServeMux(),
	}

	router.setupRoutes()
	return router
}

// ServeHTTP implements http.Handler interface
func (r *AuthRouter) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	r.mux.ServeHTTP(w, req)
}

// setupRoutes configures all OAuth endpoints
func (r *AuthRouter) setupRoutes() {
	metadata := r.createOAuthMetadata()

	// Authorization endpoint
	authPath := getPathFromURL(metadata.AuthorizationEndpoint)
	r.mux.HandleFunc(authPath, r.handleAuthorize)

	// Token endpoint
	tokenPath := getPathFromURL(metadata.TokenEndpoint)
	r.mux.HandleFunc(tokenPath, r.handleToken)

	// Metadata endpoints
	r.mux.HandleFunc("/.well-known/oauth-authorization-server", r.handleAuthServerMetadata)
	r.mux.HandleFunc("/.well-known/oauth-protected-resource", r.handleProtectedResourceMetadata)

	// Registration endpoint (if supported)
	if metadata.RegistrationEndpoint != nil {
		regPath := getPathFromURL(*metadata.RegistrationEndpoint)
		r.mux.HandleFunc(regPath, r.handleRegistration)
	}

	// Revocation endpoint (if supported)
	if metadata.RevocationEndpoint != nil {
		revPath := getPathFromURL(*metadata.RevocationEndpoint)
		r.mux.HandleFunc(revPath, r.handleRevocation)
	}
}

// createOAuthMetadata creates OAuth server metadata
func (r *AuthRouter) createOAuthMetadata() *OAuthMetadata {
	issuerURLStr := r.issuerURL.String()
	if !strings.HasSuffix(issuerURLStr, "/") {
		issuerURLStr += "/"
	}

	// Use baseURL if provided, otherwise fall back to issuerURL
	baseURL := r.baseURL
	if baseURL == nil {
		baseURL = r.issuerURL
	}
	baseURLStr := baseURL.String()
	if !strings.HasSuffix(baseURLStr, "/") {
		baseURLStr += "/"
	}

	metadata := &OAuthMetadata{
		Issuer:                            issuerURLStr,
		AuthorizationEndpoint:             baseURLStr + "authorize",
		TokenEndpoint:                     baseURLStr + "token",
		ResponseTypesSupported:            []string{"code"},
		GrantTypesSupported:               []string{GrantTypeAuthorizationCode, GrantTypeRefreshToken},
		CodeChallengeMethodsSupported:     []string{"S256"},
		TokenEndpointAuthMethodsSupported: []string{"client_secret_post"},
		ScopesSupported:                   r.scopesSupported,
		ServiceDocumentation:              r.serviceDocURL,
	}

	// Add optional endpoints if provider supports them
	clientStore := r.provider.GetClientStore()

	// Check if registration is supported by trying to call it with a test (this is a design choice)
	if clientStore != nil {
		registrationEndpoint := baseURLStr + "register"
		metadata.RegistrationEndpoint = &registrationEndpoint
	}

	// Check if revocation is supported (we'll assume it's supported if the method exists)
	revocationEndpoint := baseURLStr + "revoke"
	metadata.RevocationEndpoint = &revocationEndpoint
	metadata.RevocationEndpointAuthMethodsSupported = []string{"client_secret_post"}

	return metadata
}

// getPathFromURL extracts the path from a URL string
func getPathFromURL(urlStr string) string {
	u, err := url.Parse(urlStr)
	if err != nil {
		return urlStr // fallback to original string
	}
	return u.Path
}

// handleAuthorize handles OAuth authorization requests
func (r *AuthRouter) handleAuthorize(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet && req.Method != http.MethodPost {
		r.writeError(w, NewInvalidRequestError("Method not allowed"), http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Cache-Control", "no-store")

	// Parse query parameters or form data
	var params url.Values
	if req.Method == http.MethodPost {
		if err := req.ParseForm(); err != nil {
			r.writeError(w, NewInvalidRequestError("Failed to parse form data"), http.StatusBadRequest)
			return
		}
		params = req.Form
	} else {
		params = req.URL.Query()
	}

	// Validate required parameters
	clientID := params.Get("client_id")
	redirectURI := params.Get("redirect_uri")
	responseType := params.Get("response_type")
	codeChallenge := params.Get("code_challenge")
	codeChallengeMethod := params.Get("code_challenge_method")
	state := params.Get("state")
	scope := params.Get("scope")

	if clientID == "" {
		r.writeError(w, NewInvalidRequestError("Missing client_id parameter"), http.StatusBadRequest)
		return
	}

	if responseType != "code" {
		r.writeError(w, NewUnsupportedResponseTypeError("Only response_type=code is supported"), http.StatusBadRequest)
		return
	}

	if codeChallenge == "" {
		r.writeError(w, NewInvalidRequestError("Missing code_challenge parameter"), http.StatusBadRequest)
		return
	}

	if codeChallengeMethod != "S256" {
		r.writeError(w, NewInvalidRequestError("Only code_challenge_method=S256 is supported"), http.StatusBadRequest)
		return
	}

	// Get client information
	client, oauthErr := r.validateClientID(req.Context(), clientID)
	if oauthErr != nil {
		r.writeError(w, oauthErr, http.StatusBadRequest)
		return
	}

	// Validate redirect URI
	if redirectURI == "" {
		if len(client.RedirectURIs) == 1 {
			redirectURI = client.RedirectURIs[0]
		} else {
			r.writeError(w, NewInvalidRequestError("redirect_uri must be specified when client has multiple registered URIs"), http.StatusBadRequest)
			return
		}
	} else {
		validURI := false
		for _, uri := range client.RedirectURIs {
			if uri == redirectURI {
				validURI = true
				break
			}
		}
		if !validURI {
			r.writeError(w, NewInvalidRequestError("Unregistered redirect_uri"), http.StatusBadRequest)
			return
		}
	}

	// Parse and validate scopes
	scopes, err := r.parseAndValidateScopes(scope)
	if err != nil {
		r.redirectWithError(w, req, redirectURI, err.(*OAuthError), stringPtr(state))
		return
	}

	// Create authorization params
	authParams := &AuthorizationParams{
		RedirectURI:   redirectURI,
		CodeChallenge: codeChallenge,
		Scopes:        scopes,
		State:         stringPtr(state),
	}

	// Delegate to provider
	if err := r.provider.Authorize(req.Context(), client, authParams, w, req); err != nil {
		r.redirectWithError(w, req, redirectURI, NewServerError("Authorization failed"), authParams.State)
	}
}

// handleToken handles OAuth token requests
func (r *AuthRouter) handleToken(w http.ResponseWriter, req *http.Request) {
	if !r.validateHTTPMethod(w, req, http.MethodPost) {
		return
	}

	w.Header().Set("Cache-Control", "no-store")

	if err := req.ParseForm(); err != nil {
		r.writeError(w, NewInvalidRequestError("Failed to parse form data"), http.StatusBadRequest)
		return
	}

	grantType := req.Form.Get("grant_type")
	clientID := req.Form.Get("client_id")

	// Validate client credentials
	client, oauthErr := r.validateClientID(req.Context(), clientID)
	if oauthErr != nil {
		r.writeError(w, oauthErr, http.StatusBadRequest)
		return
	}

	// Validate that the client is authorized to use the requested grant type
	if !r.isClientAuthorizedForGrantType(client, grantType) {
		r.writeError(w, NewUnauthorizedClientError(fmt.Sprintf("Client not authorized to use grant type: %s", grantType)), http.StatusBadRequest)
		return
	}

	switch grantType {
	case GrantTypeAuthorizationCode:
		r.handleAuthorizationCodeGrant(w, req, client)
	case GrantTypeRefreshToken:
		r.handleRefreshTokenGrant(w, req, client)
	default: // e.g. "client_credentials"
		r.writeError(w, NewUnsupportedGrantTypeError("Unsupported grant type"), http.StatusBadRequest)
	}
}

// handleAuthorizationCodeGrant handles authorization code grant requests
func (r *AuthRouter) handleAuthorizationCodeGrant(w http.ResponseWriter, req *http.Request, client *OAuthClientInformationFull) {
	code := req.Form.Get("code")
	codeVerifier := req.Form.Get("code_verifier")
	redirectURI := req.Form.Get("redirect_uri")

	if code == "" {
		r.writeError(w, NewInvalidRequestError("Missing authorization code"), http.StatusBadRequest)
		return
	}

	if codeVerifier == "" {
		r.writeError(w, NewInvalidRequestError("Missing code_verifier"), http.StatusBadRequest)
		return
	}

	skipLocalPkceValidation := r.provider.SkipLocalPKCEValidation()

	// Perform local PKCE validation unless explicitly skipped
	// (e.g. to validate code_verifier in upstream server)
	if !skipLocalPkceValidation {
		codeChallenge, err := r.provider.ChallengeForAuthorizationCode(req.Context(), client, code)
		if err != nil {
			r.writeError(w, NewInvalidGrantError(err.Error()), http.StatusBadRequest)
			return
		}

		if !verifyPKCEChallenge(codeVerifier, codeChallenge) {
			r.writeError(w, NewInvalidGrantError("code_verifier does not match the challenge"), http.StatusBadRequest)
			return
		}
	}

	// Pass the code_verifier to the provider if PKCE validation didn't occur locally
	var codeVerifierPtr *string
	if skipLocalPkceValidation {
		codeVerifierPtr = stringPtr(codeVerifier)
	}

	tokens, err := r.provider.ExchangeAuthorizationCode(req.Context(), client, code, codeVerifierPtr, stringPtr(redirectURI))
	if err != nil {
		r.writeError(w, NewInvalidGrantError(err.Error()), http.StatusBadRequest)
		return
	}

	r.writeJSON(w, tokens, http.StatusOK)
}

// handleRefreshTokenGrant handles refresh token grant requests
func (r *AuthRouter) handleRefreshTokenGrant(w http.ResponseWriter, req *http.Request, client *OAuthClientInformationFull) {
	refreshToken := req.Form.Get("refresh_token")
	scope := req.Form.Get("scope")

	if refreshToken == "" {
		r.writeError(w, NewInvalidRequestError("Missing refresh_token"), http.StatusBadRequest)
		return
	}

	scopes, err := r.parseAndValidateScopes(scope)
	if err != nil {
		r.writeError(w, err.(*OAuthError), http.StatusBadRequest)
		return
	}

	tokens, err := r.provider.ExchangeRefreshToken(req.Context(), client, refreshToken, scopes)
	if err != nil {
		r.writeError(w, NewInvalidGrantError(err.Error()), http.StatusBadRequest)
		return
	}

	r.writeJSON(w, tokens, http.StatusOK)
}

// handleRegistration handles client registration requests (RFC 7591)
func (r *AuthRouter) handleRegistration(w http.ResponseWriter, req *http.Request) {
	if !r.validateHTTPMethod(w, req, http.MethodPost) {
		return
	}

	w.Header().Set("Cache-Control", "no-store")

	// Parse client metadata from request body
	var clientMetadata OAuthClientMetadata
	if err := json.NewDecoder(req.Body).Decode(&clientMetadata); err != nil {
		r.writeError(w, NewInvalidClientMetadataError("Invalid JSON in request body"), http.StatusBadRequest)
		return
	}

	// Comprehensive metadata validation (RFC 7591)
	if err := r.validateClientMetadata(&clientMetadata); err != nil {
		r.writeError(w, NewInvalidClientMetadataError(err.Error()), http.StatusBadRequest)
		return
	}

	isPublicClient := clientMetadata.TokenEndpointAuthMethod != nil &&
		*clientMetadata.TokenEndpointAuthMethod == "none"

	var clientSecret *string
	var clientSecretExpiresAt *int64

	if !isPublicClient {
		// Generate client secret for confidential clients
		secret := r.generateClientSecret()
		clientSecret = &secret

		// Set expiry time using configured duration (0 means never expire)
		if r.clientSecretExpiryTime > 0 {
			expiryTime := time.Now().Add(r.clientSecretExpiryTime).Unix()
			clientSecretExpiresAt = &expiryTime
		}
		// If clientSecretExpiryTime is 0, clientSecretExpiresAt remains nil (never expires)
	}

	// Set issued at timestamp
	clientIDIssuedAt := time.Now().Unix()

	// Create full client information
	client := &OAuthClientInformationFull{
		OAuthClientInformation: OAuthClientInformation{
			ClientSecret:          clientSecret,
			ClientIDIssuedAt:      &clientIDIssuedAt,
			ClientSecretExpiresAt: clientSecretExpiresAt,
		},
		OAuthClientMetadata: clientMetadata,
	}

	// Register the client with the store
	registeredClient, err := r.provider.GetClientStore().RegisterClient(req.Context(), client)
	if err != nil {
		r.writeError(w, NewServerError(err.Error()), http.StatusInternalServerError)
		return
	}

	r.writeJSON(w, registeredClient, http.StatusCreated)
}

// handleRevocation handles token revocation requests
func (r *AuthRouter) handleRevocation(w http.ResponseWriter, req *http.Request) {
	if !r.validateHTTPMethod(w, req, http.MethodPost) {
		return
	}

	if err := req.ParseForm(); err != nil {
		r.writeError(w, NewInvalidRequestError("Failed to parse form data"), http.StatusBadRequest)
		return
	}

	token := req.Form.Get("token")
	clientID := req.Form.Get("client_id")
	tokenTypeHint := req.Form.Get("token_type_hint")

	if token == "" {
		r.writeError(w, NewInvalidRequestError("Missing token parameter"), http.StatusBadRequest)
		return
	}

	client, oauthErr := r.validateClientID(req.Context(), clientID)
	if oauthErr != nil {
		r.writeError(w, oauthErr, http.StatusBadRequest)
		return
	}

	revocationReq := &OAuthTokenRevocationRequest{
		Token:         token,
		TokenTypeHint: stringPtr(tokenTypeHint),
	}

	if err := r.provider.RevokeToken(req.Context(), client, revocationReq); err != nil {
		r.writeError(w, NewServerError(err.Error()), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

// handleAuthServerMetadata handles OAuth authorization server metadata requests
func (r *AuthRouter) handleAuthServerMetadata(w http.ResponseWriter, req *http.Request) {
	if !r.validateHTTPMethod(w, req, http.MethodGet) {
		return
	}

	metadata := r.createOAuthMetadata()
	r.writeJSON(w, metadata, http.StatusOK)
}

// handleProtectedResourceMetadata handles OAuth protected resource metadata requests
func (r *AuthRouter) handleProtectedResourceMetadata(w http.ResponseWriter, req *http.Request) {
	if !r.validateHTTPMethod(w, req, http.MethodGet) {
		return
	}

	metadata := &OAuthProtectedResourceMetadata{
		Resource:              r.issuerURL.String(),
		AuthorizationServers:  []string{r.issuerURL.String()},
		ScopesSupported:       r.scopesSupported,
		ResourceName:          r.resourceName,
		ResourceDocumentation: r.serviceDocURL,
	}

	r.writeJSON(w, metadata, http.StatusOK)
}

// writeError writes an OAuth error response
func (r *AuthRouter) writeError(w http.ResponseWriter, err *OAuthError, statusCode int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(err)
}

// writeJSON writes a JSON response
func (r *AuthRouter) writeJSON(w http.ResponseWriter, data interface{}, statusCode int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("Failed to encode JSON response: %v", err)
	}
}

// redirectWithError redirects with OAuth error parameters
func (r *AuthRouter) redirectWithError(w http.ResponseWriter, req *http.Request, redirectURI string, err *OAuthError, state *string) {
	u, parseErr := url.Parse(redirectURI)
	if parseErr != nil {
		r.writeError(w, NewServerError("Invalid redirect URI"), http.StatusInternalServerError)
		return
	}

	q := u.Query()
	q.Set("error", err.ErrorCode)
	if err.ErrorDescription != nil {
		q.Set("error_description", *err.ErrorDescription)
	}
	if err.ErrorURI != nil {
		q.Set("error_uri", *err.ErrorURI)
	}
	if state != nil {
		q.Set("state", *state)
	}

	u.RawQuery = q.Encode()
	http.Redirect(w, req, u.String(), http.StatusFound)
}

// RequireBearerAuth creates middleware that protects HTTP endpoints with OAuth bearer token authentication.
// Validates access tokens and enforces scope requirements for protected MCP endpoints.
//
// The middleware:
//   - Extracts Bearer tokens from Authorization header
//   - Verifies tokens with the OAuth provider
//   - Enforces scope-based access control
//   - Adds AuthInfo to request context for downstream handlers
//
// Example:
//
//	// Protect MCP endpoints with read/write scopes
//	protected := RequireBearerAuth(provider, []string{"mcp:read", "mcp:write"}, "https://api.example.com/.well-known/oauth-protected-resource")
//	http.Handle("/mcp", protected(mcpHandler))
//
// Returns HTTP 401 for missing/invalid tokens, HTTP 403 for insufficient scopes.
// The resourceMetadataURL parameter is included in WWW-Authenticate headers as per RFC 9728 Section 5.1.
func RequireBearerAuth(provider OAuthServerProvider, requiredScopes []string, resourceMetadataURL string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				w.Header().Set("WWW-Authenticate", buildWWWAuthenticateHeader(resourceMetadataURL))
				writeUnauthorizedError(w, "Missing authorization header")
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
				w.Header().Set("WWW-Authenticate", buildWWWAuthenticateHeader(resourceMetadataURL))
				writeUnauthorizedError(w, "Invalid authorization header format")
				return
			}

			token := parts[1]
			authInfo, err := provider.VerifyAccessToken(r.Context(), token)
			if err != nil {
				w.Header().Set("WWW-Authenticate", buildWWWAuthenticateHeader(resourceMetadataURL))
				writeUnauthorizedError(w, "Invalid or expired token")
				return
			}

			// Check required scopes
			if len(requiredScopes) > 0 && !hasRequiredScope(authInfo.Scopes, requiredScopes) {
				w.Header().Set("WWW-Authenticate", buildWWWAuthenticateHeader(resourceMetadataURL))
				writeInsufficientScopeError(w, fmt.Sprintf("Required scopes: %s", strings.Join(requiredScopes, ", ")))
				return
			}

			// Add auth info to context
			ctx := context.WithValue(r.Context(), authInfoKey, authInfo)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// writeUnauthorizedError writes an unauthorized error response
func writeUnauthorizedError(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusUnauthorized)
	json.NewEncoder(w).Encode(NewOAuthError("invalid_token", message))
}

// writeInsufficientScopeError writes an insufficient scope error response
func writeInsufficientScopeError(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusForbidden)
	json.NewEncoder(w).Encode(NewOAuthError("insufficient_scope", message))
}

// GetAuthInfoFromContext extracts auth info from request context
func GetAuthInfoFromContext(ctx context.Context) (*AuthInfo, bool) {
	authInfo, ok := ctx.Value(authInfoKey).(*AuthInfo)
	return authInfo, ok
}

// generateClientSecret generates a secure client secret (RFC 7591)
func (r *AuthRouter) generateClientSecret() string {
	bytes := make([]byte, 32)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// validateClientMetadata performs comprehensive metadata validation (RFC 7591)
func (r *AuthRouter) validateClientMetadata(clientMetadata *OAuthClientMetadata) error {
	// RFC 7591: redirect_uris is REQUIRED
	if len(clientMetadata.RedirectURIs) == 0 {
		return fmt.Errorf("redirect_uris is required")
	}

	// Validate that all redirect URIs are valid URLs
	for _, uri := range clientMetadata.RedirectURIs {
		if _, err := url.Parse(uri); err != nil {
			return fmt.Errorf("invalid redirect_uri: %s", uri)
		}
	}

	// Validate token_endpoint_auth_method if provided
	if clientMetadata.TokenEndpointAuthMethod != nil {
		authMethod := *clientMetadata.TokenEndpointAuthMethod
		validAuthMethods := []string{"none", "client_secret_post", "client_secret_basic"}
		isValid := false
		for _, valid := range validAuthMethods {
			if authMethod == valid {
				isValid = true
				break
			}
		}
		if !isValid {
			return fmt.Errorf("unsupported token_endpoint_auth_method: %s", authMethod)
		}
	}

	// Validate grant_types if provided
	if len(clientMetadata.GrantTypes) > 0 {
		validGrantTypes := []string{GrantTypeAuthorizationCode, GrantTypeRefreshToken, "urn:ietf:params:oauth:grant-type:device_code"}
		for _, grantType := range clientMetadata.GrantTypes {
			isValid := false
			for _, valid := range validGrantTypes {
				if grantType == valid {
					isValid = true
					break
				}
			}
			if !isValid {
				return fmt.Errorf("unsupported grant_type: %s", grantType)
			}
		}
	}

	// Validate response_types if provided
	if len(clientMetadata.ResponseTypes) > 0 {
		validResponseTypes := []string{"code"}
		for _, responseType := range clientMetadata.ResponseTypes {
			isValid := false
			for _, valid := range validResponseTypes {
				if responseType == valid {
					isValid = true
					break
				}
			}
			if !isValid {
				return fmt.Errorf("unsupported response_type: %s", responseType)
			}
		}
	}

	// Validate URIs if provided
	if clientMetadata.ClientURI != nil {
		if _, err := url.Parse(*clientMetadata.ClientURI); err != nil {
			return fmt.Errorf("invalid client_uri: %s", *clientMetadata.ClientURI)
		}
	}

	if clientMetadata.LogoURI != nil {
		if _, err := url.Parse(*clientMetadata.LogoURI); err != nil {
			return fmt.Errorf("invalid logo_uri: %s", *clientMetadata.LogoURI)
		}
	}

	if clientMetadata.TOSURI != nil {
		if _, err := url.Parse(*clientMetadata.TOSURI); err != nil {
			return fmt.Errorf("invalid tos_uri: %s", *clientMetadata.TOSURI)
		}
	}

	if clientMetadata.PolicyURI != nil {
		if _, err := url.Parse(*clientMetadata.PolicyURI); err != nil {
			return fmt.Errorf("invalid policy_uri: %s", *clientMetadata.PolicyURI)
		}
	}

	if clientMetadata.JWKSURI != nil {
		if _, err := url.Parse(*clientMetadata.JWKSURI); err != nil {
			return fmt.Errorf("invalid jwks_uri: %s", *clientMetadata.JWKSURI)
		}
	}

	// Validate contacts if provided (should be valid email addresses)
	for _, contact := range clientMetadata.Contacts {
		if !strings.Contains(contact, "@") {
			return fmt.Errorf("invalid contact email: %s", contact)
		}
	}

	return nil
}

// isClientAuthorizedForGrantType checks if a client is authorized to use a specific grant type
func (r *AuthRouter) isClientAuthorizedForGrantType(client *OAuthClientInformationFull, grantType string) bool {
	// If client has no grant types specified, allow default grant types
	if len(client.GrantTypes) == 0 {
		// Default grant types for OAuth 2.1
		return grantType == GrantTypeAuthorizationCode || grantType == GrantTypeRefreshToken
	}

	// Check if the requested grant type is in the client's allowed grant types
	for _, allowedGrantType := range client.GrantTypes {
		if allowedGrantType == grantType {
			return true
		}
	}

	return false
}

// Helper functions for common patterns

// validateScopes validates that all requested scopes are supported
func (r *AuthRouter) validateScopes(scopes []string) error {
	for _, requestedScope := range scopes {
		if !r.isScopeSupported(requestedScope) {
			return NewInvalidScopeError(fmt.Sprintf("Unsupported scope: %s", requestedScope))
		}
	}
	return nil
}

// isScopeSupported checks if a scope is in the list of supported scopes
func (r *AuthRouter) isScopeSupported(scope string) bool {
	for _, supportedScope := range r.scopesSupported {
		if scope == supportedScope {
			return true
		}
	}
	return false
}

// parseAndValidateScopes parses space-separated scopes and validates them
func (r *AuthRouter) parseAndValidateScopes(scopeParam string) ([]string, error) {
	if scopeParam == "" {
		return nil, nil
	}

	scopes := strings.Fields(scopeParam)
	if err := r.validateScopes(scopes); err != nil {
		return nil, err
	}

	return scopes, nil
}

// validateHTTPMethod checks if the request method is allowed
func (r *AuthRouter) validateHTTPMethod(w http.ResponseWriter, req *http.Request, allowedMethod string) bool {
	if req.Method != allowedMethod {
		r.writeError(w, NewInvalidRequestError("Method not allowed"), http.StatusMethodNotAllowed)
		return false
	}
	return true
}

// WithCORS creates a reusable CORS middleware that can be used with any HTTP handler.
// It handles preflight OPTIONS requests and sets appropriate CORS headers.
//
// Example usage:
//
//	corsMiddleware := WithCORS("GET", "POST", "PUT", "DELETE")
//	http.Handle("/api/", corsMiddleware(apiHandler))
//
// The middleware sets the following CORS headers:
//   - Access-Control-Allow-Origin: *
//   - Access-Control-Allow-Methods: specified methods + OPTIONS
//   - Access-Control-Allow-Headers: Content-Type, Authorization
//   - Access-Control-Max-Age: 86400 (24 hours)
func WithCORS(allowedMethods ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			// Set CORS headers for all requests
			setCORSHeaders(w, allowedMethods)

			// Handle preflight OPTIONS requests
			if req.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			// Call the next handler
			next.ServeHTTP(w, req)
		})
	}
}

// setCORSHeaders sets common CORS headers
// Only used for web browsers, not for API clients
func setCORSHeaders(w http.ResponseWriter, allowedMethods []string) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", strings.Join(append(allowedMethods, "OPTIONS"), ", "))
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-protocol-version")
	w.Header().Set("Access-Control-Max-Age", "86400") // 24 hours
}

// hasRequiredScope checks if any of the required scopes are present in the granted scopes
func hasRequiredScope(grantedScopes, requiredScopes []string) bool {
	for _, required := range requiredScopes {
		for _, granted := range grantedScopes {
			if granted == required {
				return true
			}
		}
	}
	return false
}

// buildWWWAuthenticateHeader constructs the WWW-Authenticate header value with resource metadata URL
// as specified in RFC 9728 Section 5.1
func buildWWWAuthenticateHeader(resourceMetadataURL string) string {
	parts := []string{`Bearer realm="mcp"`}

	if resourceMetadataURL != "" {
		parts = append(parts, fmt.Sprintf(`resource_metadata="%s"`, resourceMetadataURL))
	}

	return strings.Join(parts, ", ")
}

// BuildResourceMetadataURL constructs the OAuth protected resource metadata URL from a base URL.
// It handles normalization of the base URL and appends the standard well-known path.
func BuildResourceMetadataURL(baseURL string) string {
	// Ensure base URL ends with a slash for proper path construction
	if baseURL != "" && !strings.HasSuffix(baseURL, "/") {
		baseURL += "/"
	}

	return baseURL + ".well-known/oauth-protected-resource"
}

// stringPtr converts a string to a pointer if it's not empty
func stringPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// validateClientID validates client ID parameter and returns client if valid
func (r *AuthRouter) validateClientID(ctx context.Context, clientID string) (*OAuthClientInformationFull, *OAuthError) {
	if clientID == "" {
		return nil, NewInvalidClientError("Missing client_id. Can not be empty.")
	}

	client, err := r.provider.GetClientStore().GetClient(ctx, clientID)
	if err != nil || client == nil {
		return nil, NewInvalidClientError("Invalid client_id. Register the client first.")
	}

	return client, nil
}
