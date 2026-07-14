package core

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestRequestTracingAuthorizer(t *testing.T) {
	t.Parallel()

	routerKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	attackerKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	validToken := signedRequestTracingToken(t, routerKey)
	invalidToken := signedRequestTracingToken(t, attackerKey)
	expiredToken := signedRequestTracingTokenWithClaims(t, routerKey, jwt.MapClaims{
		"exp": time.Now().Add(-time.Hour).Unix(),
	})
	wrongAlgorithm := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{})
	wrongAlgorithmToken, err := wrongAlgorithm.SignedString([]byte("not-an-ecdsa-key"))
	require.NoError(t, err)

	tests := []struct {
		name       string
		authorizer requestTracingAuthorizer
		token      string
		authorized bool
		errIs      error
	}{
		{
			name:       "development mode needs no token",
			authorizer: requestTracingAuthorizer{enabled: true, allowWithoutToken: true},
			authorized: true,
		},
		{
			name:       "forced unauthenticated tracing needs no token",
			authorizer: requestTracingAuthorizer{enabled: true, allowWithoutToken: true, publicKey: &routerKey.PublicKey},
			token:      invalidToken,
			authorized: true,
		},
		{
			name:       "production accepts a signed graph token",
			authorizer: requestTracingAuthorizer{enabled: true, publicKey: &routerKey.PublicKey},
			token:      validToken,
			authorized: true,
		},
		{
			name:       "disabled tracing stays disabled",
			authorizer: requestTracingAuthorizer{publicKey: &routerKey.PublicKey},
			token:      validToken,
		},
		{
			name:       "production rejects a missing token",
			authorizer: requestTracingAuthorizer{enabled: true, publicKey: &routerKey.PublicKey},
		},
		{
			name:       "production rejects a token without a configured key",
			authorizer: requestTracingAuthorizer{enabled: true},
			token:      validToken,
		},
		{
			name:       "production rejects an invalid signature",
			authorizer: requestTracingAuthorizer{enabled: true, publicKey: &routerKey.PublicKey},
			token:      invalidToken,
			errIs:      jwt.ErrTokenSignatureInvalid,
		},
		{
			name:       "production rejects a different signing algorithm",
			authorizer: requestTracingAuthorizer{enabled: true, publicKey: &routerKey.PublicKey},
			token:      wrongAlgorithmToken,
			errIs:      jwt.ErrTokenSignatureInvalid,
		},
		{
			name:       "production rejects expired claims",
			authorizer: requestTracingAuthorizer{enabled: true, publicKey: &routerKey.PublicKey},
			token:      expiredToken,
			errIs:      jwt.ErrTokenExpired,
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			authorized, err := test.authorizer.authorize(test.token)

			assert.Equal(t, test.authorized, authorized)
			if test.errIs == nil {
				require.NoError(t, err)
			} else {
				require.ErrorIs(t, err, test.errIs)
			}
		})
	}
}

func signedRequestTracingToken(t *testing.T, key *ecdsa.PrivateKey) string {
	t.Helper()

	return signedRequestTracingTokenWithClaims(t, key, jwt.MapClaims{})
}

func signedRequestTracingTokenWithClaims(t *testing.T, key *ecdsa.PrivateKey, claims jwt.MapClaims) string {
	t.Helper()

	token := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	signed, err := token.SignedString(key)
	require.NoError(t, err)
	return signed
}

func TestPreHandlerInternalRequestTracingAuthorization(t *testing.T) {
	t.Parallel()

	request := httptest.NewRequest("POST", "http://router.example/graphql", nil)
	request.Header.Set(RequestTraceHeader, requestTraceOptionExcludeOutput)
	request = request.WithContext(withInternalRequestTracingAuthorization(context.Background()))
	handler := &PreHandler{enableRequestTracing: true}

	executionOptions, traceOptions, err := handler.internalParseRequestOptions(request, &ClientInfo{}, zap.NewNop())

	require.NoError(t, err)
	assert.False(t, executionOptions.IncludeQueryPlanInResponse)
	assert.True(t, traceOptions.Enable)
	assert.True(t, traceOptions.ExcludeOutput)

	disabled := &PreHandler{enableRequestTracing: false}
	_, disabledTraceOptions, err := disabled.internalParseRequestOptions(request, &ClientInfo{}, zap.NewNop())
	require.NoError(t, err)
	assert.False(t, disabledTraceOptions.Enable)
}
