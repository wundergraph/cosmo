package authentication

import (
	"context"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

const testSymmetricSecret = "disposable-test-key-not-a-deployed-secret-123456789012345678901234567890"

func signToken(t *testing.T, method jwt.SigningMethod, secret string, kid string) string {
	t.Helper()

	token := jwt.NewWithClaims(method, jwt.MapClaims{
		"sub": "user",
		"aud": []string{"https://mcp.example.com/mcp"},
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if kid != "" {
		token.Header["kid"] = kid
	}

	signed, err := token.SignedString([]byte(secret))
	require.NoError(t, err)

	return signed
}

func TestJwksTokenDecoderEnforcesSymmetricAlgorithm(t *testing.T) {
	t.Parallel()

	decoder, err := NewJwksTokenDecoder(context.Background(), zap.NewNop(), []JWKSConfig{
		{
			Secret:    testSymmetricSecret,
			Algorithm: "HS512",
			Audiences: []string{"https://mcp.example.com/mcp"},
		},
	})
	require.NoError(t, err)

	t.Run("accepts token signed with the configured algorithm", func(t *testing.T) {
		claims, err := decoder.Decode(signToken(t, jwt.SigningMethodHS512, testSymmetricSecret, ""))
		require.NoError(t, err)
		require.Equal(t, "user", claims["sub"])
	})

	t.Run("rejects token signed with another HMAC algorithm", func(t *testing.T) {
		_, err := decoder.Decode(signToken(t, jwt.SigningMethodHS256, testSymmetricSecret, ""))
		require.Error(t, err)
		require.ErrorContains(t, err, "could not find alg HS256 in allow list")
	})
}

func TestJwksTokenDecoderRejectsConflictingAlgorithms(t *testing.T) {
	t.Parallel()

	_, err := NewJwksTokenDecoder(context.Background(), zap.NewNop(), []JWKSConfig{
		{
			Secret:            testSymmetricSecret,
			Algorithm:         "HS512",
			AllowedAlgorithms: []string{"HS512", "HS256"},
		},
	})
	require.ErrorContains(t, err, "conflicts with symmetric_algorithm HS512")
}

func TestIssuerRoutes(t *testing.T) {
	t.Parallel()

	entries := []keyFuncEntry{
		{issuers: []string{"a"}},
		{}, // accepts tokens with unknown or missing issuers.
		{issuers: []string{"a", "b", "a"}},
	}
	routes := newIssuerRoutes(entries)

	// indexes maps candidates to their positions in entries, comparing by address
	// so that entries with equal contents stay distinct.
	indexes := func(candidates []*keyFuncEntry) []int {
		out := make([]int, 0, len(candidates))
		for _, c := range candidates {
			for i := range entries {
				if c == &entries[i] {
					out = append(out, i)
				}
			}
		}
		return out
	}

	assert.Equal(t, []int{0, 1, 2}, indexes(routes["a"]))
	assert.Equal(t, []int{1, 2}, indexes(routes["b"]))
	assert.Equal(t, []int{1}, indexes(routes[""]))
	assert.Len(t, routes, 3, "only configured issuers and \"\" get a key")
}

func TestNewJwksTokenDecoderRejectsEmptyIssuer(t *testing.T) {
	t.Parallel()

	_, err := NewJwksTokenDecoder(t.Context(), zap.NewNop(), []JWKSConfig{{
		Secret:    "example secret that is long enough",
		Algorithm: "HS256",
		KeyId:     "givenKID",
		Issuers:   []string{"https://issuer.example.com", ""},
	}})
	assert.ErrorContains(t, err, "must not contain an empty issuer")
}
