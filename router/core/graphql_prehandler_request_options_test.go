package core

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"net/http/httptest"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestPreHandlerInternalParseRequestOptions_ForceUnauthenticatedRequestTracing(t *testing.T) {
	t.Parallel()

	t.Run("allows ART options when force_unauthenticated_request_tracing is true without dev mode or token", func(t *testing.T) {
		t.Parallel()

		req := httptest.NewRequest("GET", "http://localhost/graphql?wg_include_query_plan=1&wg_trace=exclude_output", nil)
		h := &PreHandler{
			enableRequestTracing:               true,
			developmentMode:                    false,
			forceUnauthenticatedRequestTracing: true,
		}

		executionOptions, traceOptions, err := h.internalParseRequestOptions(req, &ClientInfo{}, zap.NewNop())
		require.NoError(t, err)
		require.True(t, executionOptions.IncludeQueryPlanInResponse)
		require.True(t, traceOptions.Enable)
		require.True(t, traceOptions.ExcludeOutput)
	})

	t.Run("keeps ART options disabled when force_unauthenticated_request_tracing is false without dev mode or token", func(t *testing.T) {
		t.Parallel()

		req := httptest.NewRequest("GET", "http://localhost/graphql?wg_include_query_plan=1&wg_trace=exclude_output", nil)
		h := &PreHandler{
			enableRequestTracing:               true,
			developmentMode:                    false,
			forceUnauthenticatedRequestTracing: false,
			routerPublicKey:                    nil,
		}

		executionOptions, traceOptions, err := h.internalParseRequestOptions(req, &ClientInfo{}, zap.NewNop())
		require.NoError(t, err)
		require.False(t, executionOptions.IncludeQueryPlanInResponse)
		require.False(t, traceOptions.Enable)
		require.True(t, traceOptions.ExcludeOutput)
	})

	t.Run("returns error with disabled ART when force_unauthenticated_request_tracing is false and request token is invalid", func(t *testing.T) {
		t.Parallel()

		// A public key is configured but the client presents a token signed by a different key,
		// so signature verification must fail and ART must stay disabled (fail closed).
		routerKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		require.NoError(t, err)
		attackerKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		require.NoError(t, err)

		token := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{})
		signed, err := token.SignedString(attackerKey)
		require.NoError(t, err)

		req := httptest.NewRequest("GET", "http://localhost/graphql?wg_include_query_plan=1&wg_trace=exclude_output", nil)
		h := &PreHandler{
			enableRequestTracing:               true,
			developmentMode:                    false,
			forceUnauthenticatedRequestTracing: false,
			routerPublicKey:                    &routerKey.PublicKey,
		}

		executionOptions, traceOptions, err := h.internalParseRequestOptions(
			req,
			&ClientInfo{WGRequestToken: signed},
			zap.NewNop(),
		)
		require.ErrorIs(t, err, jwt.ErrTokenSignatureInvalid)
		require.False(t, executionOptions.IncludeQueryPlanInResponse)
		require.False(t, traceOptions.Enable)
	})
}
