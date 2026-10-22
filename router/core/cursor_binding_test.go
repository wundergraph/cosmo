package core

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

type fakeAuthentication struct {
	authenticator string
	claims        authentication.Claims
}

func (a *fakeAuthentication) Authenticator() string         { return a.authenticator }
func (a *fakeAuthentication) Claims() authentication.Claims { return a.claims }
func (a *fakeAuthentication) SetScopes([]string)            {}
func (a *fakeAuthentication) Scopes() []string              { return nil }

func TestCursorClientIdentity(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		auth    authentication.Authentication
		want    datasource.ClientIdentity
		wantErr bool
	}{
		{
			name: "no authentication is anonymous",
			auth: nil,
			want: datasource.ClientIdentity{},
		},
		{
			name: "empty authentication created by custom modules is anonymous",
			auth: authentication.NewEmptyAuthentication(authentication.DefaultScopeClaim),
			want: datasource.ClientIdentity{},
		},
		{
			name: "all claims",
			auth: &fakeAuthentication{authenticator: "jwks", claims: authentication.Claims{
				"iss": "https://issuer.example.com",
				"aud": []any{"router", "api"},
				"sub": "user-1",
			}},
			want: datasource.ClientIdentity{
				Authenticated: true,
				Authenticator: "jwks",
				Issuer:        "https://issuer.example.com",
				Audience:      []string{"router", "api"},
				Subject:       "user-1",
			},
		},
		{
			name: "string audience is a list of one",
			auth: &fakeAuthentication{authenticator: "jwks", claims: authentication.Claims{"aud": "router", "sub": "user-1"}},
			want: datasource.ClientIdentity{Authenticated: true, Authenticator: "jwks", Audience: []string{"router"}, Subject: "user-1"},
		},
		{
			name: "non-string identity claim is JSON-encoded",
			auth: &fakeAuthentication{authenticator: "jwks", claims: authentication.Claims{"sub": map[string]any{"id": float64(42)}}},
			want: datasource.ClientIdentity{Authenticated: true, Authenticator: "jwks", Subject: `{"id":42}`},
		},
		{
			name:    "missing identity claim",
			auth:    &fakeAuthentication{authenticator: "jwks", claims: authentication.Claims{"iss": "https://issuer.example.com"}},
			wantErr: true,
		},
		{
			name:    "null identity claim",
			auth:    &fakeAuthentication{authenticator: "jwks", claims: authentication.Claims{"sub": nil}},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := cursorClientIdentity(tt.auth, "sub")
			if tt.wantErr {
				var missingClaimErr *missingIdentityClaimError
				require.ErrorAs(t, err, &missingClaimErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func newCursorBindingTestContext(t *testing.T, auth authentication.Authentication) context.Context {
	t.Helper()

	req := httptest.NewRequest("POST", "/graphql", nil)
	if auth != nil {
		req = req.WithContext(authentication.NewContext(req.Context(), auth))
	}
	return withRequestContext(context.Background(), &requestContext{request: req})
}

func TestSubscriberBindingFunc(t *testing.T) {
	t.Parallel()

	t.Run("binds identity", func(t *testing.T) {
		t.Parallel()

		subscriberBinding := newSubscriberBindingFunc("sub", zap.NewNop())
		auth := &fakeAuthentication{authenticator: "jwks", claims: authentication.Claims{"sub": "user-1"}}

		identity, err := subscriberBinding(newCursorBindingTestContext(t, auth))
		require.NoError(t, err)
		assert.Equal(t, datasource.ClientIdentity{Authenticated: true, Authenticator: "jwks", Subject: "user-1"}, identity)
	})

	t.Run("missing identity claim fails negotiation without logging claim values", func(t *testing.T) {
		t.Parallel()

		core, logs := observer.New(zap.WarnLevel)
		subscriberBinding := newSubscriberBindingFunc("email", zap.New(core))
		auth := &fakeAuthentication{authenticator: "jwks", claims: authentication.Claims{"sub": "secret-subject"}}

		_, err := subscriberBinding(newCursorBindingTestContext(t, auth))
		var guaranteeErr *datasource.DeliveryGuaranteeError
		require.ErrorAs(t, err, &guaranteeErr)
		assert.Equal(t, datasource.DeliveryGuaranteeErrorCodeUnsatisfiable, guaranteeErr.Code)
		assert.Contains(t, guaranteeErr.Message, `"email"`)

		require.Equal(t, 1, logs.Len())
		entry := logs.All()[0]
		assert.Equal(t, "jwks", entry.ContextMap()["authenticator"])
		assert.Equal(t, "email", entry.ContextMap()["identity_claim"])
		assert.NotContains(t, entry.Message, "secret-subject")
		for _, v := range entry.ContextMap() {
			assert.NotEqual(t, "secret-subject", v)
		}
	})

	t.Run("missing request context", func(t *testing.T) {
		t.Parallel()

		_, err := newSubscriberBindingFunc("sub", zap.NewNop())(context.Background())
		require.Error(t, err)
	})
}

func TestNewCursors(t *testing.T) {
	t.Parallel()

	cursors, err := newCursors(config.CursorResumeConfiguration{IdentityClaim: "sub"}, zap.NewNop())
	require.NoError(t, err)
	assert.False(t, cursors.Enabled(), "cursors are disabled without keys")

	cursors, err = newCursors(config.CursorResumeConfiguration{
		IdentityClaim: "sub",
		Keys: []config.CursorKeyConfiguration{
			{ID: 1, Secret: "first-secret-at-least-32-bytes-long", ExpiresAt: time.Now().Add(time.Hour)},
		},
	}, zap.NewNop())
	require.NoError(t, err)
	assert.True(t, cursors.Enabled())

	_, err = newCursors(config.CursorResumeConfiguration{
		Keys: []config.CursorKeyConfiguration{{ID: 1, Secret: "short"}},
	}, zap.NewNop())
	require.ErrorContains(t, err, "invalid cursor keys")
}
