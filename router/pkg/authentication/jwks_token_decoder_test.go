package authentication

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
)

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
