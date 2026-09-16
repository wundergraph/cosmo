package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

const tokenValidationTestSecret = "token-validation-test-secret-at-least-32-bytes"

func tokenValidationTestConfig() *config.Config {
	return &config.Config{
		Authentication: config.AuthenticationConfiguration{
			JWT: config.JWTAuthenticationConfiguration{
				HeaderName:        "Authorization",
				HeaderValuePrefix: "Bearer",
				ScopeClaim:        "scp",
				JWKS: []config.JWKSConfiguration{{
					Secret: tokenValidationTestSecret, Algorithm: "HS256", KeyId: "test", Audiences: []string{"router"},
				}},
			},
		},
	}
}

func tokenValidationTestJWT(t *testing.T, secret string, method jwt.SigningMethod, kid string, extra jwt.MapClaims) string {
	t.Helper()
	claims := jwt.MapClaims{"aud": "router", "sub": "test-user", "scp": "read:employee"}
	for key, value := range extra {
		claims[key] = value
	}
	token := jwt.NewWithClaims(method, claims)
	token.Header["kid"] = kid
	signed, err := token.SignedString([]byte(secret))
	require.NoError(t, err)
	return signed
}

func TestAccessControllerJWTOnError(t *testing.T) {
	t.Parallel()

	valid := tokenValidationTestJWT(t, tokenValidationTestSecret, jwt.SigningMethodHS256, "test", nil)
	tests := []struct {
		name   string
		header string
		valid  bool
	}{
		{name: "missing"},
		{name: "wrong prefix", header: "Basic opaque-private-token"},
		{name: "prefix only", header: "Bearer"},
		{name: "opaque", header: "Bearer opaque-private-token"},
		{name: "valid", header: "Bearer " + valid, valid: true},
		{name: "expired", header: "Bearer " + tokenValidationTestJWT(t, tokenValidationTestSecret, jwt.SigningMethodHS256, "test", jwt.MapClaims{"exp": time.Now().Add(-time.Hour).Unix()})},
		{name: "invalid signature", header: "Bearer " + tokenValidationTestJWT(t, "a-different-secret-at-least-32-bytes", jwt.SigningMethodHS256, "test", nil)},
	}
	for _, onError := range []config.JWTOnError{config.JWTOnErrorReject, config.JWTOnErrorContinue} {
		for _, required := range []bool{false, true} {
			for _, tt := range tests {
				t.Run(fmt.Sprintf("on_error=%q/required=%t/%s", onError, required, tt.name), func(t *testing.T) {
					t.Parallel()
					cfg := tokenValidationTestConfig()
					cfg.Authentication.JWT.OnError = onError
					authenticators, err := setupAuthenticators(t.Context(), zap.NewNop(), cfg)
					require.NoError(t, err)
					controller, err := NewAccessController(AccessControllerOptions{
						Authenticators: authenticators, AuthenticationRequired: required,
						ScopeClaim: cfg.Authentication.JWT.ScopeClaim,
					})
					require.NoError(t, err)
					req := httptest.NewRequest(http.MethodPost, "/graphql", nil)
					req.Header.Set("Authorization", tt.header)
					response := httptest.NewRecorder()
					validated, err := controller.Access(response, req)
					allowed := tt.valid || !required && (tt.header == "" || onError == config.JWTOnErrorContinue)
					if !allowed {
						require.ErrorIs(t, err, ErrUnauthorized)
						require.Nil(t, validated)
					} else {
						require.NoError(t, err)
						require.Equal(t, tt.header, validated.Header.Get("Authorization"))
						auth := authentication.FromContext(validated.Context())
						if tt.valid {
							require.NotNil(t, auth)
							require.Equal(t, "test-user", auth.Claims()["sub"])
							require.Equal(t, []string{"read:employee"}, auth.Scopes())
							require.Equal(t, "jwks", response.Header().Get("X-Authenticated-By"))
						} else {
							require.Nil(t, auth)
							require.Equal(t, expr.RequestAuth{}, expr.LoadAuth(validated.Context()))
						}
					}
					if !tt.valid {
						require.Empty(t, response.Header().Get("X-Authenticated-By"))
					}
				})
			}
		}
	}
}

func TestAccessControllerJWTOnErrorSources(t *testing.T) {
	t.Parallel()
	valid := tokenValidationTestJWT(t, tokenValidationTestSecret, jwt.SigningMethodHS256, "test", nil)
	tests := []struct {
		name        string
		header      string
		additional  string
		payload     json.RawMessage
		wantError   bool // Expected with the reject policy and optional authentication.
		alwaysError bool // Not a JWT credential failure; both policies must reject it.
		wantAuth    string
		customError bool
		customLast  bool
	}{
		{name: "HTTP opaque token with absent WebSocket payload", header: "Bearer opaque", wantError: true},
		{name: "alternative header", additional: "Token opaque", payload: json.RawMessage(`{}`), wantError: true},
		{name: "no prefix source", additional: "opaque", payload: json.RawMessage(`{}`), wantError: true},
		{name: "alternative header succeeds", header: "Bearer opaque", additional: "Token " + valid, wantAuth: "jwks"},
		{name: "WebSocket opaque token", payload: json.RawMessage(`{"Authorization":"Bearer opaque"}`), wantError: true},
		{name: "WebSocket succeeds after HTTP failure", header: "Bearer opaque", payload: json.RawMessage(`{"Authorization":"Bearer ` + valid + `"}`), wantAuth: "websocket-initial-payload"},
		{name: "no credentials with absent WebSocket payload", wantError: true},
		{name: "empty WebSocket payload", payload: json.RawMessage(`{}`)},
		{name: "malformed WebSocket payload", header: "Bearer opaque", payload: json.RawMessage(`{`), alwaysError: true},
		{name: "nonobject WebSocket payload", payload: json.RawMessage(`[]`), alwaysError: true},
		{name: "nonstring WebSocket credential", header: "Bearer opaque", payload: json.RawMessage(`{"Authorization":42}`), alwaysError: true},
		{name: "valid HTTP credential before malformed WebSocket payload", header: "Bearer " + valid, payload: json.RawMessage(`{`), wantAuth: "jwks"},
		{name: "empty WebSocket token", payload: json.RawMessage(`{"Authorization":"Bearer "}`), wantError: true},
		{name: "custom authenticator error with JWT failure", header: "Bearer opaque", customError: true, alwaysError: true},
		{name: "custom authenticator error after JWT failure", header: "Bearer opaque", customError: true, customLast: true, alwaysError: true},
		{name: "custom authenticator error without JWT failure", payload: json.RawMessage(`{}`), customError: true, alwaysError: true},
		{name: "JWT succeeds after custom authenticator error", header: "Bearer " + valid, customError: true, wantAuth: "jwks"},
	}
	for _, onError := range []config.JWTOnError{config.JWTOnErrorReject, config.JWTOnErrorContinue} {
		for _, tt := range tests {
			t.Run(fmt.Sprintf("on_error=%s/%s", onError, tt.name), func(t *testing.T) {
				t.Parallel()
				cfg := tokenValidationTestConfig()
				cfg.Authentication.JWT.OnError = onError
				cfg.WebSocket.Authentication.FromInitialPayload.Enabled = true
				cfg.WebSocket.Authentication.FromInitialPayload.Key = "Authorization"
				cfg.Authentication.JWT.HeaderSources = []config.HeaderSource{{Type: "header", Name: "X-Token", ValuePrefixes: []string{"Bearer", "Token", ""}}}
				authenticators, err := setupAuthenticators(t.Context(), zap.NewNop(), cfg)
				require.NoError(t, err)
				if tt.customError {
					if tt.customLast {
						authenticators = append(authenticators, &tokenValidationFailingAuthenticator{})
					} else {
						authenticators = append([]authentication.Authenticator{&tokenValidationFailingAuthenticator{}}, authenticators...)
					}
				}
				controller, err := NewAccessController(AccessControllerOptions{
					Authenticators: authenticators,
				})
				require.NoError(t, err)
				req := httptest.NewRequest(http.MethodPost, "/graphql", nil)
				req.Header.Set("Authorization", tt.header)
				req.Header.Set("X-Token", tt.additional)
				if tt.payload != nil {
					req = req.WithContext(authentication.WithWebsocketInitialPayloadContextKey(req.Context(), tt.payload))
				}
				response := httptest.NewRecorder()
				validated, err := controller.Access(response, req)
				wantError := tt.alwaysError || (onError == config.JWTOnErrorReject && tt.wantError)
				if wantError {
					require.ErrorIs(t, err, ErrUnauthorized)
					if tt.customError {
						require.ErrorContains(t, err, "custom authentication service unavailable")
					}
					require.Nil(t, validated)
					require.Empty(t, response.Header().Get("X-Authenticated-By"))
					return
				}
				require.NoError(t, err)
				require.Equal(t, tt.header, validated.Header.Get("Authorization"))
				require.Equal(t, tt.additional, validated.Header.Get("X-Token"))
				if tt.wantAuth != "" {
					require.Equal(t, tt.wantAuth, authentication.FromContext(validated.Context()).Authenticator())
				} else {
					require.Nil(t, authentication.FromContext(validated.Context()))
					require.Equal(t, expr.RequestAuth{}, expr.LoadAuth(validated.Context()))
				}
				require.Equal(t, tt.wantAuth, response.Header().Get("X-Authenticated-By"))
			})
		}
	}
}

type tokenValidationFailingAuthenticator struct{}

func (*tokenValidationFailingAuthenticator) Name() string { return "custom" }
func (*tokenValidationFailingAuthenticator) Authenticate(context.Context, authentication.Provider) (authentication.Claims, error) {
	return nil, errors.New("custom authentication service unavailable")
}

func TestSetupAuthenticatorsJWTOnError(t *testing.T) {
	t.Parallel()
	for _, onError := range []config.JWTOnError{config.JWTOnErrorReject, config.JWTOnErrorContinue} {
		t.Run(string(onError), func(t *testing.T) {
			t.Parallel()
			cfg := tokenValidationTestConfig()
			cfg.Authentication.JWT.OnError = onError
			logCore, logs := observer.New(zap.WarnLevel)
			_, err := setupAuthenticators(t.Context(), zap.New(logCore), cfg)
			require.NoError(t, err)
			require.Zero(t, logs.Len())
			cfg.Authentication.JWT.JWKS[0].Algorithm = "invalid"
			_, err = setupAuthenticators(t.Context(), zap.NewNop(), cfg)
			require.ErrorContains(t, err, "unsupported algorithm")
		})
	}
}
