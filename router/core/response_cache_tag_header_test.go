package core

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestBuildCacheTagHeader(t *testing.T) {
	t.Parallel()

	headerTags := []string{"user-42", "type-accounts-User", "subgraph-accounts", "users", "subgraph-products", "type-products-Product"}

	t.Run("what fits is sent as it came", func(t *testing.T) {
		t.Parallel()
		require.Equal(t, strings.Join(headerTags, ","), buildCacheTagHeader(headerTags, ",", 16384))
		require.Equal(t, "a subgraph-x", buildCacheTagHeader([]string{"a", "subgraph-x"}, " ", 100))
	})

	t.Run("what does not fit is cut coarsest tier first", func(t *testing.T) {
		t.Parallel()
		require.Equal(t, "subgraph-accounts,subgraph-products,type-accounts-User",
			buildCacheTagHeader(headerTags, ",", len("subgraph-accounts,subgraph-products,type-accounts-User")))
	})

	t.Run("the input is left in its order", func(t *testing.T) {
		t.Parallel()
		in := []string{"zz", "subgraph-x"}
		buildCacheTagHeader(in, ",", 100)
		require.Equal(t, []string{"zz", "subgraph-x"}, in)
	})

	t.Run("a value that exactly fits is emitted whole", func(t *testing.T) {
		t.Parallel()
		require.Equal(t, "subgraph-a,subgraph-b",
			buildCacheTagHeader([]string{"subgraph-a", "subgraph-b"}, ",", len("subgraph-a,subgraph-b")))
	})

	t.Run("truncation stops at the first headerTag that does not fit, delimiter included", func(t *testing.T) {
		t.Parallel()
		// subgraph-a (10), then ",type-a-Very-Long-Type" would pass 24, and the
		// shorter ",zz" after it must not be taken in its place.
		require.Equal(t, "subgraph-a", buildCacheTagHeader([]string{"zz", "type-a-Very-Long-Type", "subgraph-a"}, ",", 24))
		// "subgraph-a,subgraph-b" is 21; at 20 the second cannot follow the first.
		require.Equal(t, "subgraph-a", buildCacheTagHeader([]string{"subgraph-a", "subgraph-b"}, ",", 20))
		require.Empty(t, buildCacheTagHeader([]string{"subgraph-a"}, ",", 3))
	})

	t.Run("a headerTag carrying the delimiter or a line break is left out", func(t *testing.T) {
		t.Parallel()
		require.Equal(t, "ok", buildCacheTagHeader([]string{"subgraph-a,b", "ok", "line\nbreak", "nul\x00", ""}, ",", 100))
		require.Equal(t, "c", buildCacheTagHeader([]string{"a b", "c"}, " ", 100))
	})

	t.Run("nothing to send is empty", func(t *testing.T) {
		t.Parallel()
		require.Empty(t, buildCacheTagHeader(nil, ",", 100))
	})

	t.Run("a large set truncates to the tiers that fit", func(t *testing.T) {
		t.Parallel()
		many := []string{"subgraph-a"}
		for i := 0; i < 500; i++ {
			many = append(many, "tag-"+strings.Repeat("x", 20)+string(rune('a'+i%26)))
		}
		got := buildCacheTagHeader(many, ",", 64)
		require.True(t, strings.HasPrefix(got, "subgraph-a"))
		require.LessOrEqual(t, len(got), 64)
	})
}

func TestValidateResponseCacheTagHeader(t *testing.T) {
	t.Parallel()

	valid := config.ResponseCacheTagHeaderConfig{Enabled: true, Name: "Cache-Tag", Delimiter: ",", MaxBytes: 16384}
	require.NoError(t, validateResponseCacheTagHeader(valid))
	require.NoError(t, validateResponseCacheTagHeader(config.ResponseCacheTagHeaderConfig{}), "disabled is never checked")

	cases := map[string]func(*config.ResponseCacheTagHeaderConfig){
		"empty header name":      func(c *config.ResponseCacheTagHeaderConfig) { c.Name = "" },
		"header name with colon": func(c *config.ResponseCacheTagHeaderConfig) { c.Name = "Cache:Tag" },
		"header name with slash": func(c *config.ResponseCacheTagHeaderConfig) { c.Name = "Cache/Tag" },
		"header name with tab":   func(c *config.ResponseCacheTagHeaderConfig) { c.Name = "Cache\tTag" },
		"delimiter with nul":     func(c *config.ResponseCacheTagHeaderConfig) { c.Delimiter = "\x00" },
		"empty delimiter":        func(c *config.ResponseCacheTagHeaderConfig) { c.Delimiter = "" },
		"delimiter with newline": func(c *config.ResponseCacheTagHeaderConfig) { c.Delimiter = "\n" },
		"zero max bytes":         func(c *config.ResponseCacheTagHeaderConfig) { c.MaxBytes = 0 },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			cfg := valid
			mutate(&cfg)
			require.Error(t, validateResponseCacheTagHeader(cfg))
		})
	}
}
