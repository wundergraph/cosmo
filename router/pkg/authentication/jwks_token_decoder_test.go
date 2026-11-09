package authentication

import (
	"testing"

	"github.com/stretchr/testify/require"
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

	require.Equal(t, []int{0, 1, 2}, indexes(routes.candidates("a")))
	require.Equal(t, []int{1, 2}, indexes(routes.candidates("b")))
	require.Equal(t, []int{1}, indexes(routes.candidates("unknown")))
	require.Equal(t, []int{1}, indexes(routes.candidates("")))
}
