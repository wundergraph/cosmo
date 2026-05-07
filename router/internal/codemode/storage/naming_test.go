package storage

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestShortSHA(t *testing.T) {
	t.Run("identifier shape", func(t *testing.T) {
		got := ShortSHA("query GetUser { user { id } }")
		assert.Equal(t, "oe4467893", got)
	})

	t.Run("whitespace-equivalent bodies share an identifier", func(t *testing.T) {
		a := ShortSHA("query GetUser { user { id } }")
		b := ShortSHA("  query GetUser {\n  user { id }\n}\n")
		assert.Equal(t, a, b)
	})

	t.Run("different bodies produce different identifiers", func(t *testing.T) {
		a := ShortSHA("query GetUser { user { id } }")
		b := ShortSHA("query GetUser { user { name } }")
		assert.NotEqual(t, a, b)
	})

	t.Run("same body via different prompt name still maps to same identifier", func(t *testing.T) {
		// Regression: yoko returns the same body under "fetchUser" in one
		// search and "getUser" in another. The identifier must be the
		// content-derived SHA, not the document name.
		a := ShortSHA("query GetUser { user { id } }")
		b := ShortSHA("query GetUser { user { id } }")
		assert.Equal(t, a, b)
	})
}

func TestCanonicalBody(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "single-line passthrough", raw: "query GetUser { user { id } }", want: "query GetUser { user { id } }"},
		{name: "multi-line collapses", raw: "  query GetUser {\n  user { id }\n}\n", want: "query GetUser { user { id } }"},
		{name: "tabs normalize", raw: "query\tGetUser\t{ user { id } }", want: "query GetUser { user { id } }"},
		{name: "empty input stays empty", raw: "", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, CanonicalBody(tt.raw))
		})
	}
}
