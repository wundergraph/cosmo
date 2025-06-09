package mcpauth

import (
	"context"
	"errors"
	"net/http"
)

// AuthInfo represents authentication information for a verified access token.
// Used to pass authentication context to protected endpoints.
type AuthInfo struct {
	Token     string   `json:"token"`     // The raw access token
	ClientID  string   `json:"clientId"`  // OAuth client identifier
	Scopes    []string `json:"scopes"`    // Granted scopes (e.g., ["mcp:read", "mcp:write"])
	ExpiresAt int64    `json:"expiresAt"` // Unix timestamp when token expires
}

// OAuthTokens represents an OAuth 2.1 token response
type OAuthTokens struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    *int   `json:"expires_in,omitempty"`
	Scope        string `json:"scope,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
}

// OAuthClientInformation represents OAuth client information
type OAuthClientInformation struct {
	ClientID              string  `json:"client_id"`
	ClientSecret          *string `json:"client_secret,omitempty"`
	ClientIDIssuedAt      *int64  `json:"client_id_issued_at,omitempty"`
	ClientSecretExpiresAt *int64  `json:"client_secret_expires_at,omitempty"`
}

// OAuthClientMetadata represents OAuth client metadata
type OAuthClientMetadata struct {
	RedirectURIs            []string `json:"redirect_uris"`
	TokenEndpointAuthMethod *string  `json:"token_endpoint_auth_method,omitempty"`
	GrantTypes              []string `json:"grant_types,omitempty"`
	ResponseTypes           []string `json:"response_types,omitempty"`
	ClientName              *string  `json:"client_name,omitempty"`
	ClientURI               *string  `json:"client_uri,omitempty"`
	LogoURI                 *string  `json:"logo_uri,omitempty"`
	Scope                   *string  `json:"scope,omitempty"`
	Contacts                []string `json:"contacts,omitempty"`
	TOSURI                  *string  `json:"tos_uri,omitempty"`
	PolicyURI               *string  `json:"policy_uri,omitempty"`
	JWKSURI                 *string  `json:"jwks_uri,omitempty"`
	JWKS                    any      `json:"jwks,omitempty"`
	SoftwareID              *string  `json:"software_id,omitempty"`
	SoftwareVersion         *string  `json:"software_version,omitempty"`
}

// OAuthClientInformationFull combines client information and metadata
type OAuthClientInformationFull struct {
	OAuthClientInformation
	OAuthClientMetadata
}

// OAuthTokenRevocationRequest represents a token revocation request
type OAuthTokenRevocationRequest struct {
	Token         string  `json:"token"`
	TokenTypeHint *string `json:"token_type_hint,omitempty"`
}

// OAuthMetadata represents OAuth 2.0 Authorization Server Metadata (RFC 8414)
type OAuthMetadata struct {
	Issuer                                             string   `json:"issuer"`
	AuthorizationEndpoint                              string   `json:"authorization_endpoint"`
	TokenEndpoint                                      string   `json:"token_endpoint"`
	RegistrationEndpoint                               *string  `json:"registration_endpoint,omitempty"`
	ScopesSupported                                    []string `json:"scopes_supported,omitempty"`
	ResponseTypesSupported                             []string `json:"response_types_supported"`
	ResponseModesSupported                             []string `json:"response_modes_supported,omitempty"`
	GrantTypesSupported                                []string `json:"grant_types_supported,omitempty"`
	TokenEndpointAuthMethodsSupported                  []string `json:"token_endpoint_auth_methods_supported,omitempty"`
	TokenEndpointAuthSigningAlgValuesSupported         []string `json:"token_endpoint_auth_signing_alg_values_supported,omitempty"`
	ServiceDocumentation                               *string  `json:"service_documentation,omitempty"`
	RevocationEndpoint                                 *string  `json:"revocation_endpoint,omitempty"`
	RevocationEndpointAuthMethodsSupported             []string `json:"revocation_endpoint_auth_methods_supported,omitempty"`
	RevocationEndpointAuthSigningAlgValuesSupported    []string `json:"revocation_endpoint_auth_signing_alg_values_supported,omitempty"`
	IntrospectionEndpoint                              *string  `json:"introspection_endpoint,omitempty"`
	IntrospectionEndpointAuthMethodsSupported          []string `json:"introspection_endpoint_auth_methods_supported,omitempty"`
	IntrospectionEndpointAuthSigningAlgValuesSupported []string `json:"introspection_endpoint_auth_signing_alg_values_supported,omitempty"`
	CodeChallengeMethodsSupported                      []string `json:"code_challenge_methods_supported,omitempty"`
}

// OAuthProtectedResourceMetadata represents RFC 9728 OAuth Protected Resource Metadata
type OAuthProtectedResourceMetadata struct {
	Resource                              string   `json:"resource"`
	AuthorizationServers                  []string `json:"authorization_servers,omitempty"`
	JWKSURI                               *string  `json:"jwks_uri,omitempty"`
	ScopesSupported                       []string `json:"scopes_supported,omitempty"`
	BearerMethodsSupported                []string `json:"bearer_methods_supported,omitempty"`
	ResourceSigningAlgValuesSupported     []string `json:"resource_signing_alg_values_supported,omitempty"`
	ResourceName                          *string  `json:"resource_name,omitempty"`
	ResourceDocumentation                 *string  `json:"resource_documentation,omitempty"`
	ResourcePolicyURI                     *string  `json:"resource_policy_uri,omitempty"`
	ResourceTOSURI                        *string  `json:"resource_tos_uri,omitempty"`
	TLSClientCertificateBoundAccessTokens *bool    `json:"tls_client_certificate_bound_access_tokens,omitempty"`
	AuthorizationDetailsTypesSupported    []string `json:"authorization_details_types_supported,omitempty"`
	DPoPSigningAlgValuesSupported         []string `json:"dpop_signing_alg_values_supported,omitempty"`
	DPoPBoundAccessTokensRequired         *bool    `json:"dpop_bound_access_tokens_required,omitempty"`
}

// AuthorizationParams represents parameters for authorization requests
type AuthorizationParams struct {
	RedirectURI   string   `json:"redirect_uri"`
	CodeChallenge string   `json:"code_challenge"`
	State         *string  `json:"state,omitempty"`
	Scopes        []string `json:"scopes,omitempty"`
}

// OAuthError represents an OAuth error with structured access to error details.
// Implements the standard Go error interface while providing additional methods
// for accessing error codes and descriptions separately.
type OAuthError struct {
	ErrorCode        string  `json:"error"`
	ErrorDescription *string `json:"error_description,omitempty"`
	ErrorURI         *string `json:"error_uri,omitempty"`
}

// Error implements the Go error interface
func (e *OAuthError) Error() string {
	if e.ErrorDescription != nil {
		return *e.ErrorDescription
	}
	return e.ErrorCode
}

// Code returns the OAuth error code (e.g., "invalid_request", "invalid_client")
func (e *OAuthError) Code() string {
	return e.ErrorCode
}

// Description returns the human-readable error description, if available
func (e *OAuthError) Description() string {
	if e.ErrorDescription != nil {
		return *e.ErrorDescription
	}
	return ""
}

// URI returns the error URI for additional information, if available
func (e *OAuthError) URI() string {
	if e.ErrorURI != nil {
		return *e.ErrorURI
	}
	return ""
}

// HasCode checks if this error matches a specific OAuth error code
func (e *OAuthError) HasCode(errorCode string) bool {
	return e.ErrorCode == errorCode
}

// IsInvalidRequest checks if this is an invalid_request error
func (e *OAuthError) IsInvalidRequest() bool {
	return e.HasCode(ErrorInvalidRequest)
}

// IsInvalidClient checks if this is an invalid_client error
func (e *OAuthError) IsInvalidClient() bool {
	return e.HasCode(ErrorInvalidClient)
}

// IsInvalidGrant checks if this is an invalid_grant error
func (e *OAuthError) IsInvalidGrant() bool {
	return e.HasCode(ErrorInvalidGrant)
}

// IsServerError checks if this is a server_error
func (e *OAuthError) IsServerError() bool {
	return e.HasCode(ErrorServerError)
}

// IsInvalidClientMetadata checks if this is an invalid_client_metadata error
func (e *OAuthError) IsInvalidClientMetadata() bool {
	return e.HasCode(ErrorInvalidClientMetadata)
}

// IsInvalidScope checks if this is an invalid_scope error
func (e *OAuthError) IsInvalidScope() bool {
	return e.HasCode(ErrorInvalidScope)
}

// IsUnauthorizedClient checks if this is an unauthorized_client error
func (e *OAuthError) IsUnauthorizedClient() bool {
	return e.HasCode(ErrorUnauthorizedClient)
}

// IsTemporarilyUnavailable checks if this is a temporarily_unavailable error
func (e *OAuthError) IsTemporarilyUnavailable() bool {
	return e.HasCode(ErrorTemporarilyUnavailable)
}

// IsUnsupportedGrantType checks if this is an unsupported_grant_type error
func (e *OAuthError) IsUnsupportedGrantType() bool {
	return e.HasCode(ErrorUnsupportedGrantType)
}

// IsAccessDenied checks if this is an access_denied error
func (e *OAuthError) IsAccessDenied() bool {
	return e.HasCode(ErrorAccessDenied)
}

// IsUnsupportedResponseType checks if this is an unsupported_response_type error
func (e *OAuthError) IsUnsupportedResponseType() bool {
	return e.HasCode(ErrorUnsupportedResponseType)
}

// Common OAuth error types
var (
	ErrorInvalidRequest          = "invalid_request"
	ErrorInvalidClient           = "invalid_client"
	ErrorInvalidGrant            = "invalid_grant"
	ErrorUnauthorizedClient      = "unauthorized_client"
	ErrorUnsupportedGrantType    = "unsupported_grant_type"
	ErrorInvalidScope            = "invalid_scope"
	ErrorAccessDenied            = "access_denied"
	ErrorUnsupportedResponseType = "unsupported_response_type"
	ErrorServerError             = "server_error"
	ErrorTemporarilyUnavailable  = "temporarily_unavailable"
	ErrorInvalidClientMetadata   = "invalid_client_metadata"
)

// OAuth error constructors for common error types

// NewOAuthError creates a new OAuth error with the specified code and description
func NewOAuthError(code, description string) *OAuthError {
	return &OAuthError{
		ErrorCode:        code,
		ErrorDescription: &description,
	}
}

// NewOAuthErrorWithURI creates a new OAuth error with code, description, and URI
func NewOAuthErrorWithURI(code, description, uri string) *OAuthError {
	return &OAuthError{
		ErrorCode:        code,
		ErrorDescription: &description,
		ErrorURI:         &uri,
	}
}

// NewInvalidRequestError creates an invalid_request error
func NewInvalidRequestError(description string) *OAuthError {
	return NewOAuthError(ErrorInvalidRequest, description)
}

// NewInvalidClientError creates an invalid_client error
func NewInvalidClientError(description string) *OAuthError {
	return NewOAuthError(ErrorInvalidClient, description)
}

// NewInvalidGrantError creates an invalid_grant error
func NewInvalidGrantError(description string) *OAuthError {
	return NewOAuthError(ErrorInvalidGrant, description)
}

// NewServerError creates a server_error
func NewServerError(description string) *OAuthError {
	return NewOAuthError(ErrorServerError, description)
}

// NewInvalidClientMetadataError creates an invalid_client_metadata error
func NewInvalidClientMetadataError(description string) *OAuthError {
	return NewOAuthError(ErrorInvalidClientMetadata, description)
}

// NewUnsupportedGrantTypeError creates an unsupported_grant_type error
func NewUnsupportedGrantTypeError(description string) *OAuthError {
	return NewOAuthError(ErrorUnsupportedGrantType, description)
}

// NewAccessDeniedError creates an access_denied error
func NewAccessDeniedError(description string) *OAuthError {
	return NewOAuthError(ErrorAccessDenied, description)
}

// NewInvalidScopeError creates an invalid_scope error
func NewInvalidScopeError(description string) *OAuthError {
	return NewOAuthError(ErrorInvalidScope, description)
}

// NewUnauthorizedClientError creates an unauthorized_client error
func NewUnauthorizedClientError(description string) *OAuthError {
	return NewOAuthError(ErrorUnauthorizedClient, description)
}

// NewTemporarilyUnavailableError creates a temporarily_unavailable error
func NewTemporarilyUnavailableError(description string) *OAuthError {
	return NewOAuthError(ErrorTemporarilyUnavailable, description)
}

// NewUnsupportedResponseTypeError creates an unsupported_response_type error
func NewUnsupportedResponseTypeError(description string) *OAuthError {
	return NewOAuthError(ErrorUnsupportedResponseType, description)
}

// IsOAuthError checks if an error is an OAuth error and returns it as *OAuthError
func IsOAuthError(err error) (*OAuthError, bool) {
	var oauthErr *OAuthError
	ok := errors.As(err, &oauthErr)
	return oauthErr, ok
}

// OAuthClientStore interface for managing OAuth clients
type OAuthClientStore interface {
	GetClient(ctx context.Context, clientID string) (*OAuthClientInformationFull, error)
	RegisterClient(ctx context.Context, client *OAuthClientInformationFull) (*OAuthClientInformationFull, error)
}

// TokenVerifier interface for verifying access tokens
type TokenVerifier interface {
	VerifyAccessToken(ctx context.Context, token string) (*AuthInfo, error)
}

// OAuthServerProvider defines the contract for OAuth 2.1 + PKCE server implementations.
// Supports both proxy-based (production) and in-memory (demo) implementations.
type OAuthServerProvider interface {
	// Authorize initiates the OAuth authorization flow (redirects user to consent)
	Authorize(ctx context.Context, client *OAuthClientInformationFull, params *AuthorizationParams, w http.ResponseWriter) error

	// ChallengeForAuthorizationCode retrieves the PKCE challenge for verification
	ChallengeForAuthorizationCode(ctx context.Context, client *OAuthClientInformationFull, authorizationCode string) (string, error)

	// ExchangeAuthorizationCode exchanges authorization code for access/refresh tokens
	ExchangeAuthorizationCode(ctx context.Context, client *OAuthClientInformationFull, authorizationCode string, codeVerifier *string, redirectURI *string) (*OAuthTokens, error)

	// ExchangeRefreshToken exchanges refresh token for new access token
	ExchangeRefreshToken(ctx context.Context, client *OAuthClientInformationFull, refreshToken string, scopes []string) (*OAuthTokens, error)

	// VerifyAccessToken validates access token and returns authentication info
	VerifyAccessToken(ctx context.Context, token string) (*AuthInfo, error)

	// RevokeToken revokes an access or refresh token (RFC 7009)
	RevokeToken(ctx context.Context, client *OAuthClientInformationFull, request *OAuthTokenRevocationRequest) error

	// GetClientStore returns the OAuth client management interface
	GetClientStore() OAuthClientStore

	// SkipLocalPKCEValidation indicates whether PKCE validation is handled upstream
	SkipLocalPKCEValidation() bool
}
