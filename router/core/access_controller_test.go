package core

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

func TestJWTOnError(t *testing.T) {
	t.Parallel()
	const secret = "jwt-on-error-test-secret-at-least-32-bytes"
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": "test-user"})
	token.Header["kid"] = "test"
	valid, err := token.SignedString([]byte(secret))
	require.NoError(t, err)

	cases := []struct {
		name, header, payload                              string
		reject, required, custom, authenticated, wantError bool
	}{
		{name: "HTTP rejects an invalid token by default", header: "Bearer opaque", reject: true, wantError: true},
		{name: "HTTP continue allows an opaque token without authenticating", header: "Bearer opaque"},
		{name: "HTTP continue allows an unsupported prefix without authenticating", header: "Basic opaque"},
		{name: "HTTP continue allows an empty token without authenticating", header: "Bearer"},
		{name: "HTTP continue allows missing credentials without authenticating"},
		{name: "continue still rejects when authentication is required", header: "Bearer opaque", required: true, wantError: true},
		{name: "continue still rejects a custom authenticator failure", header: "Bearer opaque", custom: true, wantError: true},
		{name: "valid HTTP JWT authenticates after a custom authenticator failure", header: "Bearer " + valid, custom: true, authenticated: true},
		{name: "WebSocket rejects an invalid token by default", payload: `{"Authorization":"Bearer opaque"}`, reject: true, wantError: true},
		{name: "WebSocket continue allows an opaque token without authenticating", payload: `{"Authorization":"Bearer opaque"}`},
		{name: "valid WebSocket JWT authenticates after an ignored HTTP token", header: "Bearer opaque", payload: `{"Authorization":"Bearer ` + valid + `"}`, authenticated: true},
		{name: "continue still rejects a malformed WebSocket payload", header: "Bearer opaque", payload: `{`, wantError: true},
		{name: "continue still rejects a non-string WebSocket credential", payload: `{"Authorization":42}`, wantError: true},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			cfg := &config.Config{}
			cfg.Authentication.JWT = config.JWTAuthenticationConfiguration{
				OnError: config.JWTOnErrorContinue, HeaderName: "Authorization", HeaderValuePrefix: "Bearer",
				JWKS: []config.JWKSConfiguration{{Secret: secret, Algorithm: "HS256", KeyId: "test"}},
			}
			if tt.reject {
				cfg.Authentication.JWT.OnError = ""
			}
			cfg.WebSocket.Authentication.FromInitialPayload.Enabled = tt.payload != ""
			cfg.WebSocket.Authentication.FromInitialPayload.Key = "Authorization"
			authenticators, err := setupAuthenticators(t.Context(), zap.NewNop(), cfg)
			require.NoError(t, err)
			if tt.custom {
				authenticators = append([]authentication.Authenticator{failingJWTTestAuthenticator{}}, authenticators...)
			}
			controller, err := NewAccessController(AccessControllerOptions{Authenticators: authenticators, AuthenticationRequired: tt.required})
			require.NoError(t, err)
			req := httptest.NewRequest("POST", "/graphql", nil)
			req.Header.Set("Authorization", tt.header)
			if tt.payload != "" {
				req = req.WithContext(authentication.WithWebsocketInitialPayloadContextKey(req.Context(), json.RawMessage(tt.payload)))
			}
			response := httptest.NewRecorder()
			validated, err := controller.Access(response, req)
			if tt.wantError {
				require.ErrorIs(t, err, ErrUnauthorized)
				require.Nil(t, validated)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tt.header, validated.Header.Get("Authorization"))
			require.Equal(t, tt.authenticated, authentication.FromContext(validated.Context()) != nil)
			require.Equal(t, tt.authenticated, response.Header().Get("X-Authenticated-By") != "")
		})
	}
}

type failingJWTTestAuthenticator struct{}

func (failingJWTTestAuthenticator) Name() string { return "custom" }
func (failingJWTTestAuthenticator) Authenticate(context.Context, authentication.Provider) (authentication.Claims, error) {
	return nil, errors.New("custom authentication failed")
}
