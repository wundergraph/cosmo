package authentication

import (
	"context"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
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
