package jwtauthextension

import (
	"context"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/client"
	"go.opentelemetry.io/collector/component/componenttest"
	"go.uber.org/zap"
)

const testSecret = "secret"

func newTestExtension(t *testing.T) *jwtExtension {
	t.Helper()
	p, err := newExtension(&Config{JWTSecret: testSecret}, zap.NewNop())
	require.NoError(t, err)
	require.NoError(t, p.Start(context.Background(), componenttest.NewNopHost()))
	t.Cleanup(func() { require.NoError(t, p.Shutdown(context.Background())) })
	return p
}

func sign(t *testing.T, method jwt.SigningMethod, key any, claims jwt.Claims) string {
	t.Helper()
	s, err := jwt.NewWithClaims(method, claims).SignedString(key)
	require.NoError(t, err)
	return s
}

func TestJWTAuthenticationSucceeded(t *testing.T) {
	p := newTestExtension(t)

	token := sign(t, jwt.SigningMethodHS256, []byte(testSecret), jwt.MapClaims{
		"exp": jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
		"iat": jwt.NewNumericDate(time.Now()),
		"nbf": jwt.NewNumericDate(time.Now()),
		"iss": "test",
		"sub": "somebody",
		"aud": []string{"somebody_else"},
		// Claims set by the Cosmo control plane on graph tokens.
		"organization_id":    "org-1",
		"federated_graph_id": "graph-1",
	})

	for _, header := range []string{"authorization", "Authorization"} {
		t.Run(header, func(t *testing.T) {
			ctx, err := p.Authenticate(context.Background(), map[string][]string{header: {"Bearer " + token}})
			require.NoError(t, err)

			info := client.FromContext(ctx)
			require.NotNil(t, info.Auth)
			assert.Equal(t, "test", info.Auth.GetAttribute("iss"))
			assert.Equal(t, "somebody", info.Auth.GetAttribute("sub"))
			assert.Equal(t, []any{"somebody_else"}, info.Auth.GetAttribute("aud"))
			assert.Equal(t, "org-1", info.Auth.GetAttribute("organization_id"))
			assert.Equal(t, "graph-1", info.Auth.GetAttribute("federated_graph_id"))
			assert.Nil(t, info.Auth.GetAttribute("missing"))
			assert.Len(t, info.Auth.GetAttributeNames(), 8)
		})
	}
}

func TestJWTCustomAttribute(t *testing.T) {
	p, err := newExtension(&Config{JWTSecret: testSecret, Attribute: "x-token"}, zap.NewNop())
	require.NoError(t, err)

	token := sign(t, jwt.SigningMethodHS256, []byte(testSecret), jwt.MapClaims{"sub": "somebody"})

	_, err = p.Authenticate(context.Background(), map[string][]string{"authorization": {"Bearer " + token}})
	assert.ErrorIs(t, err, errNotAuthenticated)

	ctx, err := p.Authenticate(context.Background(), map[string][]string{"X-Token": {"Bearer " + token}})
	require.NoError(t, err)
	assert.Equal(t, "somebody", client.FromContext(ctx).Auth.GetAttribute("sub"))
}

func TestJWTExpired(t *testing.T) {
	p := newTestExtension(t)

	token := sign(t, jwt.SigningMethodHS256, []byte(testSecret), jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(-24 * time.Hour)),
	})

	ctx, err := p.Authenticate(context.Background(), map[string][]string{"authorization": {"Bearer " + token}})
	assert.ErrorIs(t, err, jwt.ErrTokenExpired)
	assert.NotNil(t, ctx)
	assert.Nil(t, client.FromContext(ctx).Auth)
}

func TestJWTEmptyClaims(t *testing.T) {
	p := newTestExtension(t)

	token := sign(t, jwt.SigningMethodHS256, []byte(testSecret), jwt.RegisteredClaims{})

	ctx, err := p.Authenticate(context.Background(), map[string][]string{"authorization": {"Bearer " + token}})
	require.NoError(t, err)
	assert.NotNil(t, client.FromContext(ctx).Auth)
}

func TestJWTWrongSecret(t *testing.T) {
	p := newTestExtension(t)

	token := sign(t, jwt.SigningMethodHS256, []byte("other-secret"), jwt.MapClaims{"sub": "somebody"})

	_, err := p.Authenticate(context.Background(), map[string][]string{"authorization": {"Bearer " + token}})
	assert.ErrorIs(t, err, jwt.ErrTokenSignatureInvalid)
}

func TestJWTRejectsNonHMAC(t *testing.T) {
	p := newTestExtension(t)

	// "none" must never be accepted, even though it needs no key.
	token := sign(t, jwt.SigningMethodNone, jwt.UnsafeAllowNoneSignatureType, jwt.MapClaims{"sub": "somebody"})

	_, err := p.Authenticate(context.Background(), map[string][]string{"authorization": {"Bearer " + token}})
	assert.Error(t, err)
}

func TestJWTInvalidAuthHeader(t *testing.T) {
	p := newTestExtension(t)

	for _, value := range []string{"some-value", "Bearer", "Bearer ", " token", "Bearer a b"} {
		t.Run(value, func(t *testing.T) {
			ctx, err := p.Authenticate(context.Background(), map[string][]string{"authorization": {value}})
			assert.Equal(t, errInvalidAuthenticationHeaderFormat, err)
			assert.NotNil(t, ctx)
		})
	}
}

func TestJWTNotAuthenticated(t *testing.T) {
	p := newTestExtension(t)

	ctx, err := p.Authenticate(context.Background(), map[string][]string{})
	assert.Equal(t, errNotAuthenticated, err)
	assert.NotNil(t, ctx)
}

func TestFailedToVerifyToken(t *testing.T) {
	p := newTestExtension(t)

	ctx, err := p.Authenticate(context.Background(), map[string][]string{"authorization": {"Bearer some-token"}})
	assert.Error(t, err)
	assert.NotNil(t, ctx)
}

func TestMissingSecret(t *testing.T) {
	p, err := newExtension(&Config{}, zap.NewNop())
	assert.Nil(t, p)
	assert.Equal(t, errNoJWTSecretProvided, err)
}
