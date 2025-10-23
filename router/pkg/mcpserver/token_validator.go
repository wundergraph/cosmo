package mcpserver

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"go.uber.org/zap"
)

// TokenValidator validates JWT access tokens for MCP requests
type TokenValidator struct {
	authenticators []authentication.Authenticator
	logger         *zap.Logger
	enabled        bool
}

// NewTokenValidator creates a new token validator
func NewTokenValidator(authenticators []authentication.Authenticator, logger *zap.Logger, enabled bool) *TokenValidator {
	return &TokenValidator{
		authenticators: authenticators,
		logger:         logger,
		enabled:        enabled,
	}
}

// ValidateRequest validates the JWT token in the request
// Returns the authentication result or an error
func (tv *TokenValidator) ValidateRequest(ctx context.Context, r *http.Request) (authentication.Authentication, error) {
	if !tv.enabled {
		return nil, nil
	}

	// Create a provider from the request
	provider := &httpRequestProvider{request: r}

	// Authenticate using the configured authenticators
	auth, err := authentication.Authenticate(ctx, tv.authenticators, provider)
	if err != nil {
		tv.logger.Debug("authentication failed", zap.Error(err))
		return nil, fmt.Errorf("invalid access token: %w", err)
	}

	// If no authentication information was found, return error
	if auth == nil {
		return nil, fmt.Errorf("missing access token")
	}

	return auth, nil
}

// ValidateScopes checks if the authenticated request has the required scopes
func (tv *TokenValidator) ValidateScopes(auth authentication.Authentication, requiredScopes []string, anyOf bool) error {
	if !tv.enabled || len(requiredScopes) == 0 {
		return nil
	}

	if auth == nil {
		return fmt.Errorf("authentication required")
	}

	tokenScopes := auth.Scopes()
	
	if anyOf {
		// At least one of the required scopes must be present
		for _, required := range requiredScopes {
			for _, tokenScope := range tokenScopes {
				if tokenScope == required {
					return nil
				}
			}
		}
		return fmt.Errorf("insufficient scopes: requires at least one of %v, got %v", requiredScopes, tokenScopes)
	}

	// All required scopes must be present
	for _, required := range requiredScopes {
		found := false
		for _, tokenScope := range tokenScopes {
			if tokenScope == required {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("insufficient scopes: requires %v, got %v", requiredScopes, tokenScopes)
		}
	}

	return nil
}

// httpRequestProvider implements the authentication.Provider interface
type httpRequestProvider struct {
	request *http.Request
}

func (p *httpRequestProvider) AuthenticationHeaders() http.Header {
	return p.request.Header
}

// AuthorizationMiddleware creates a middleware that validates JWT tokens
func (tv *TokenValidator) AuthorizationMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !tv.enabled {
			next.ServeHTTP(w, r)
			return
		}

		auth, err := tv.ValidateRequest(r.Context(), r)
		if err != nil {
			tv.logger.Debug("authorization failed", zap.Error(err))
			tv.writeUnauthorizedResponse(w, r, err)
			return
		}

		// Store authentication in context for later use
		ctx := context.WithValue(r.Context(), authenticationKey{}, auth)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// authenticationKey is a context key for storing authentication
type authenticationKey struct{}

// AuthenticationFromContext retrieves authentication from context
func AuthenticationFromContext(ctx context.Context) (authentication.Authentication, bool) {
	auth, ok := ctx.Value(authenticationKey{}).(authentication.Authentication)
	return auth, ok
}

// writeUnauthorizedResponse writes a 401 Unauthorized response
func (tv *TokenValidator) writeUnauthorizedResponse(w http.ResponseWriter, r *http.Request, err error) {
	w.Header().Set("WWW-Authenticate", fmt.Sprintf("Bearer realm=\"%s\"", r.Host))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	
	response := map[string]string{
		"error":             "unauthorized",
		"error_description": "Valid access token required",
	}
	
	// Don't expose internal error details in production
	if tv.logger.Level() == zap.DebugLevel {
		response["error_description"] = err.Error()
	}
	
	// Write JSON response
	w.Write([]byte(fmt.Sprintf(`{"error":"%s","error_description":"%s"}`, 
		response["error"], 
		strings.ReplaceAll(response["error_description"], `"`, `\"`))))
}

// writeForbiddenResponse writes a 403 Forbidden response
func (tv *TokenValidator) writeForbiddenResponse(w http.ResponseWriter, r *http.Request, requiredScopes []string, providedScopes []string) {
	scopesStr := strings.Join(requiredScopes, " ")
	w.Header().Set("WWW-Authenticate", fmt.Sprintf("Bearer realm=\"%s\", error=\"insufficient_scope\", scope=\"%s\"", r.Host, scopesStr))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	
	response := fmt.Sprintf(`{"error":"insufficient_scope","error_description":"Required scopes: %s","required_scopes":%s,"provided_scopes":%s}`,
		scopesStr,
		formatScopesJSON(requiredScopes),
		formatScopesJSON(providedScopes))
	
	w.Write([]byte(response))
}

// formatScopesJSON formats scopes as a JSON array
func formatScopesJSON(scopes []string) string {
	if len(scopes) == 0 {
		return "[]"
	}
	quoted := make([]string, len(scopes))
	for i, s := range scopes {
		quoted[i] = fmt.Sprintf(`"%s"`, s)
	}
	return "[" + strings.Join(quoted, ",") + "]"
}