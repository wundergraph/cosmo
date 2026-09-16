package authentication

import (
	"testing"

	"github.com/stretchr/testify/require"
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
