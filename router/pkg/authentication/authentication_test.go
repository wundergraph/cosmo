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
			name:   "skips non-string members of a JSON array scope claim",
			claims: Claims{"scope": []any{"read", 42, nil, "write"}},
			want:   []string{"read", "write"},
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
			name:   "returns nil for an unsupported scope claim type",
			claims: Claims{"scope": 42},
			want:   nil,
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
			require.Equal(t, tt.want, a.Scopes())
		})
	}
}
