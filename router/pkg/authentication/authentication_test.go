package authentication

import (
	"context"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestScopes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		scopeClaim string
		claims     Claims
		want       []string
		wantErr    bool
	}{
		{
			name:   "splits a space delimited scope claim",
			claims: Claims{"scope": "read write"},
			want:   []string{"read", "write"},
		},
		{
			name:   "reads a scope claim encoded as a JSON array",
			claims: Claims{"scope": []any{"read", "write"}},
			want:   []string{"read", "write"},
		},
		{
			name:   "reads a scope claim encoded as a string slice",
			claims: Claims{"scope": []string{"read", "write"}},
			want:   []string{"read", "write"},
		},
		{
			name:    "rejects a JSON array scope claim holding a non-string member",
			claims:  Claims{"scope": []any{"read", 42, "write"}},
			wantErr: true,
		},
		{
			name:       "honours a custom scope claim",
			scopeClaim: "customscp",
			claims:     Claims{"customscp": []any{"read"}, "scope": "write"},
			want:       []string{"read"},
		},
		{
			name:   "returns nil when the scope claim is missing",
			claims: Claims{},
			want:   nil,
		},
		{
			// A null claim carries no scopes to read, so it grants none rather than being invalid.
			name:   "returns nil when the scope claim is null",
			claims: Claims{"scope": nil},
			want:   nil,
		},
		{
			name:    "rejects an unsupported scope claim type",
			claims:  Claims{"scope": 42},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			scopeClaim := tt.scopeClaim
			if scopeClaim == "" {
				scopeClaim = DefaultScopeClaim
			}
			a := &authentication{claims: tt.claims, scopeClaim: scopeClaim}

			scopes, err := ScopesFromClaims(tt.claims, scopeClaim)
			if tt.wantErr {
				require.ErrorIs(t, err, ErrInvalidScopeClaim)
				require.Nil(t, scopes)
				// Scopes cannot report the error through its interface, so it fails closed.
				require.Nil(t, a.Scopes())
				return
			}
			require.NoError(t, err)
			require.Equal(t, tt.want, scopes)
			require.Equal(t, tt.want, a.Scopes())
		})
	}
}

func TestJwksTokenDecoder_SymmetricAlgorithmEnforcement(t *testing.T) {
	ctx := context.Background()
	secret := "disposable-test-secret-at-least-32-bytes-long"

	decoder, err := NewJwksTokenDecoder(ctx, zap.NewNop(), []JWKSConfig{
		{
			Secret:    secret,
			Algorithm: "HS512",
			KeyId:     "test-key",
		},
	})
	require.NoError(t, err)

	claims := jwt.MapClaims{
		"sub": "user123",
		"exp": time.Now().Add(time.Hour).Unix(),
	}

	// 1. Sign token with configured HS512: should succeed
	token512 := jwt.NewWithClaims(jwt.SigningMethodHS512, claims)
	token512.Header["kid"] = "test-key"
	signed512, err := token512.SignedString([]byte(secret))
	require.NoError(t, err)

	decodedClaims, err := decoder.Decode(signed512)
	require.NoError(t, err)
	require.Equal(t, "user123", decodedClaims["sub"])

	// 2. Sign token with HS256 using the SAME secret: must be rejected
	token256 := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	token256.Header["kid"] = "test-key"
	signed256, err := token256.SignedString([]byte(secret))
	require.NoError(t, err)

	_, err = decoder.Decode(signed256)
	require.Error(t, err)
	require.ErrorContains(t, err, "could not find alg HS256 in allow list")
}
