package cors

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestWildcardCompile(t *testing.T) {
	t.Run("should normalize repeated wildcard patterns", func(t *testing.T) {
		compiled := Compile("**.example.com")
		require.Equal(t, "*.example.com", compiled.pattern)
	})

	t.Run("should handle empty pattern", func(t *testing.T) {
		compiled := Compile("")
		require.Equal(t, "", compiled.pattern)
		require.Equal(t, 0, len(compiled.cards))
	})

	t.Run("should handle pattern without wildcards", func(t *testing.T) {
		compiled := Compile("example.com")
		require.Equal(t, "example.com", compiled.pattern)
		require.Equal(t, 1, len(compiled.cards))
	})

	t.Run("should handle single wildcard", func(t *testing.T) {
		compiled := Compile("*")
		require.Equal(t, "*", compiled.pattern)
		require.Equal(t, 2, len(compiled.cards))
	})
}

func TestWildcardMatch(t *testing.T) {
	t.Run("exact match without wildcards", func(t *testing.T) {
		pattern := Compile("example.com")
		require.True(t, pattern.Match("example.com"))
		require.False(t, pattern.Match("test.com"))
		require.False(t, pattern.Match("example.org"))
	})

	t.Run("single wildcard at start", func(t *testing.T) {
		pattern := Compile("*.com")
		require.True(t, pattern.Match("example.com"))
		require.True(t, pattern.Match("test.com"))
		require.True(t, pattern.Match(".com"))
		require.False(t, pattern.Match("example.org"))
		require.False(t, pattern.Match("com"))
	})

	t.Run("single wildcard at end", func(t *testing.T) {
		pattern := Compile("example.*")
		require.True(t, pattern.Match("example.com"))
		require.True(t, pattern.Match("example.org"))
		require.True(t, pattern.Match("example."))
		require.False(t, pattern.Match("test.com"))
		require.False(t, pattern.Match("example"))
	})

	t.Run("single wildcard in middle", func(t *testing.T) {
		pattern := Compile("api.*.com")
		require.True(t, pattern.Match("api.v1.com"))
		require.True(t, pattern.Match("api.test.com"))
		require.True(t, pattern.Match("api..com"))
		require.False(t, pattern.Match("api.com"))
		require.False(t, pattern.Match("web.v1.com"))
	})

	t.Run("multiple wildcards", func(t *testing.T) {
		pattern := Compile("*.api.*.com")
		require.True(t, pattern.Match("sub.api.v1.com"))
		require.True(t, pattern.Match("test.api.prod.com"))
		require.False(t, pattern.Match("api.v1.com"))
		require.False(t, pattern.Match("sub.api.com"))
	})

	t.Run("only wildcards", func(t *testing.T) {
		pattern := Compile("*")
		require.True(t, pattern.Match("anything"))
		require.True(t, pattern.Match(""))
		require.True(t, pattern.Match("a"))
	})

	t.Run("empty string patterns", func(t *testing.T) {
		pattern := Compile("")
		require.True(t, pattern.Match(""))
		require.False(t, pattern.Match("anything"))
	})

	t.Run("normalized consecutive wildcards", func(t *testing.T) {
		pattern := Compile("**.example.com")
		require.True(t, pattern.Match("sub.example.com"))
		require.True(t, pattern.Match("deep.sub.example.com"))
		require.False(t, pattern.Match("example.org"))
	})
}

func TestWildcardMatchBytes(t *testing.T) {
	t.Run("should match byte slice same as string", func(t *testing.T) {
		pattern := Compile("*.example.com")
		testStr := "sub.example.com"

		require.Equal(t, pattern.Match(testStr), pattern.MatchBytes([]byte(testStr)))
	})

	t.Run("should handle empty byte slice", func(t *testing.T) {
		pattern := Compile("*")
		require.True(t, pattern.MatchBytes([]byte{}))

		pattern2 := Compile("test")
		require.False(t, pattern2.MatchBytes([]byte{}))
	})
}
