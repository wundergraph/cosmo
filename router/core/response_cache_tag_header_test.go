package core

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

// tieredKeys tiers values by their spelling.
func tieredKeys(values ...string) []caching.SurrogateKey {
	out := make([]caching.SurrogateKey, 0, len(values))
	for _, v := range values {
		switch {
		case strings.HasPrefix(v, "subgraph-"):
			out = append(out, caching.SurrogateKey{Value: v, Tier: caching.SurrogateKeyTierSubgraph})
		case strings.HasPrefix(v, "type-"):
			out = append(out, caching.SurrogateKey{Value: v, Tier: caching.SurrogateKeyTierType})
		default:
			out = append(out, caching.DeclaredSurrogateKey(v))
		}
	}
	return out
}

// headerOf is the header value with every tier allowed.
func headerOf(surrogateKeys []caching.SurrogateKey, delimiter string, maxBytes int) string {
	value, _ := buildCacheTagHeader(surrogateKeys, allCacheTagTiers, delimiter, maxBytes)
	return value
}

func TestBuildCacheTagHeader(t *testing.T) {
	t.Parallel()

	surrogateKeys := tieredKeys("user-42", "type-accounts-User", "subgraph-accounts", "users", "subgraph-products", "type-products-Product")

	t.Run("what fits is sent as it came", func(t *testing.T) {
		t.Parallel()
		value, overflow := buildCacheTagHeader(surrogateKeys, allCacheTagTiers, ",", 16384)
		require.Equal(t, strings.Join(caching.SurrogateKeyValues(surrogateKeys), ","), value)
		require.False(t, overflow)
		require.Equal(t, "a subgraph-x", headerOf(tieredKeys("a", "subgraph-x"), " ", 100))
	})

	t.Run("what does not fit is cut coarsest tier first", func(t *testing.T) {
		t.Parallel()
		value, overflow := buildCacheTagHeader(surrogateKeys, allCacheTagTiers, ",", len("subgraph-accounts,subgraph-products,type-accounts-User"))
		require.Equal(t, "subgraph-accounts,subgraph-products,type-accounts-User", value)
		require.True(t, overflow)
	})

	t.Run("the input is left in its order", func(t *testing.T) {
		t.Parallel()
		in := tieredKeys("zz", "subgraph-x")
		headerOf(in, ",", 1)
		require.Equal(t, tieredKeys("zz", "subgraph-x"), in)
	})

	t.Run("a value that exactly fits is emitted whole", func(t *testing.T) {
		t.Parallel()
		value, overflow := buildCacheTagHeader(tieredKeys("subgraph-a", "subgraph-b"), allCacheTagTiers, ",", len("subgraph-a,subgraph-b"))
		require.Equal(t, "subgraph-a,subgraph-b", value)
		require.False(t, overflow)
	})

	t.Run("truncation stops at the first surrogate key that does not fit, delimiter included", func(t *testing.T) {
		t.Parallel()
		// subgraph-a (10), then ",type-a-Very-Long-Type" would pass 24, and the
		// shorter ",zz" after it must not be taken in its place.
		require.Equal(t, "subgraph-a", headerOf(tieredKeys("zz", "type-a-Very-Long-Type", "subgraph-a"), ",", 24))
		// "subgraph-a,subgraph-b" is 21; at 20 the second cannot follow the first.
		require.Equal(t, "subgraph-a", headerOf(tieredKeys("subgraph-a", "subgraph-b"), ",", 20))
		value, overflow := buildCacheTagHeader(tieredKeys("subgraph-a"), allCacheTagTiers, ",", 3)
		require.Empty(t, value)
		require.True(t, overflow)
	})

	t.Run("a surrogate key carrying the delimiter or a line break is left out", func(t *testing.T) {
		t.Parallel()
		value, overflow := buildCacheTagHeader(tieredKeys("subgraph-a,b", "ok", "line\nbreak", "nul\x00", ""), allCacheTagTiers, ",", 100)
		require.Equal(t, "ok", value)
		require.False(t, overflow, "left out is not overflow")
		require.Equal(t, "c", headerOf(tieredKeys("a b", "c"), " ", 100))
	})

	t.Run("nothing to send is empty", func(t *testing.T) {
		t.Parallel()
		require.Empty(t, headerOf(nil, ",", 100))
	})

	t.Run("a large set truncates to the tiers that fit", func(t *testing.T) {
		t.Parallel()
		many := tieredKeys("subgraph-a")
		for i := range 500 {
			many = append(many, caching.DeclaredSurrogateKey("tag-"+strings.Repeat("x", 20)+string(rune('a'+i%26))))
		}
		got := headerOf(many, ",", 64)
		require.True(t, strings.HasPrefix(got, "subgraph-a"))
		require.LessOrEqual(t, len(got), 64)
	})

	t.Run("only the configured tiers are sent", func(t *testing.T) {
		t.Parallel()
		declaredOnly := newCacheTagHeader(config.ResponseCacheTagHeaderConfig{Tiers: []string{"cache_tag"}}, nil).tiers
		require.Equal(t, "user-42,users", mustHeader(t, surrogateKeys, declaredOnly))

		derived := newCacheTagHeader(config.ResponseCacheTagHeaderConfig{Tiers: []string{"subgraph", "type"}}, nil).tiers
		require.Equal(t, "type-accounts-User,subgraph-accounts,subgraph-products,type-products-Product", mustHeader(t, surrogateKeys, derived))

		value, overflow := buildCacheTagHeader(tieredKeys("subgraph-a", "type-a-X"), declaredOnly, ",", 100)
		require.Empty(t, value, "no tag of an allowed tier means no header")
		require.False(t, overflow)
	})

	t.Run("a declared tag spelled like a derived one is declared", func(t *testing.T) {
		t.Parallel()
		declaredOnly := newCacheTagHeader(config.ResponseCacheTagHeaderConfig{Tiers: []string{"cache_tag"}}, nil).tiers
		keys := []caching.SurrogateKey{caching.SubgraphSurrogateKey("articles"), caching.DeclaredSurrogateKey("subgraph-articles"), caching.DeclaredSurrogateKey("article-1")}
		require.Equal(t, "subgraph-articles,article-1", mustHeader(t, keys, declaredOnly))

		subgraphOnly := newCacheTagHeader(config.ResponseCacheTagHeaderConfig{Tiers: []string{"subgraph"}}, nil).tiers
		require.Equal(t, "subgraph-articles", mustHeader(t, []caching.SurrogateKey{caching.DeclaredSurrogateKey("subgraph-articles"), caching.SubgraphSurrogateKey("articles")}, subgraphOnly))
		require.Empty(t, mustHeader(t, []caching.SurrogateKey{caching.DeclaredSurrogateKey("subgraph-articles")}, subgraphOnly))

		require.Equal(t, "subgraph-articles,article-1", headerOf(keys, ",", 100), "one tag per value")
	})

	t.Run("truncation of declared tags only drops declared tags", func(t *testing.T) {
		t.Parallel()
		declaredOnly := newCacheTagHeader(config.ResponseCacheTagHeaderConfig{Tiers: []string{"cache_tag"}}, nil).tiers
		value, overflow := buildCacheTagHeader(surrogateKeys, declaredOnly, ",", len("user-42"))
		require.Equal(t, "user-42", value)
		require.True(t, overflow)
	})
}

func mustHeader(t *testing.T, surrogateKeys []caching.SurrogateKey, tiers cacheTagTiers) string {
	t.Helper()
	value, overflow := buildCacheTagHeader(surrogateKeys, tiers, ",", 16384)
	require.False(t, overflow)
	return value
}

func TestCacheTagHeaderSet(t *testing.T) {
	t.Parallel()

	cfg := config.ResponseCacheTagHeaderConfig{Enabled: true, Name: "Cache-Tag", Delimiter: ",", MaxBytes: len("user-42"), Tiers: []string{"cache_tag"}}
	keys := tieredKeys("subgraph-accounts", "user-42", "users")

	t.Run("truncate sends what fits", func(t *testing.T) {
		t.Parallel()
		c := cfg
		c.OnOverflow = config.ResponseCacheTagHeaderOverflowTruncate
		h := newCacheTagHeader(c, nil)
		header := http.Header{"Cache-Control": {"max-age=60, public"}}
		h.set(context.Background(), header, keys, nil)
		require.Equal(t, "user-42", header.Get("Cache-Tag"))
		require.Equal(t, "max-age=60, public", header.Get("Cache-Control"))
	})

	t.Run("private sends no tags and keeps shared caches out", func(t *testing.T) {
		t.Parallel()
		c := cfg
		c.OnOverflow = config.ResponseCacheTagHeaderOverflowPrivate
		h := newCacheTagHeader(c, nil)
		header := http.Header{"Cache-Control": {"max-age=60, public"}}
		h.set(context.Background(), header, keys, nil)
		require.Empty(t, header.Values("Cache-Tag"))
		require.Equal(t, "private, max-age=60", header.Get("Cache-Control"))

		fits := http.Header{}
		h.set(context.Background(), fits, tieredKeys("subgraph-accounts", "user-42"), nil)
		require.Equal(t, "user-42", fits.Get("Cache-Tag"))
		require.Empty(t, fits.Values("Cache-Control"), "only an overflow touches Cache-Control")
	})

	t.Run("private reads every Cache-Control line", func(t *testing.T) {
		t.Parallel()
		c := cfg
		c.OnOverflow = config.ResponseCacheTagHeaderOverflowPrivate
		h := newCacheTagHeader(c, nil)
		header := http.Header{"Cache-Control": {"public, max-age=60", "no-store"}}
		h.set(context.Background(), header, keys, nil)
		require.Empty(t, header.Values("Cache-Tag"))
		require.Equal(t, []string{"public, max-age=60,no-store"}, header.Values("Cache-Control"))
	})
}

func TestPrivateCacheControl(t *testing.T) {
	t.Parallel()

	for in, want := range map[string]string{
		"":                                    "private",
		"max-age=60, public":                  "private, max-age=60",
		"public, s-maxage=600, max-age=60":    "private, max-age=60",
		"private, max-age=60":                 "private, max-age=60",
		"no-cache":                            "private, no-cache",
		"Public, Proxy-Revalidate":            "private",
		"no-store, no-cache, must-revalidate": "no-store, no-cache, must-revalidate",
	} {
		require.Equal(t, want, privateCacheControl(in), in)
	}
}

func TestValidateResponseCacheTagHeader(t *testing.T) {
	t.Parallel()

	valid := config.ResponseCacheTagHeaderConfig{
		Enabled: true, Name: "Cache-Tag", Delimiter: ",", MaxBytes: 16384,
		Tiers: []string{"subgraph", "type", "cache_tag"}, OnOverflow: config.ResponseCacheTagHeaderOverflowTruncate,
	}
	require.NoError(t, validateResponseCacheTagHeader(valid))
	require.NoError(t, validateResponseCacheTagHeader(config.ResponseCacheTagHeaderConfig{}), "disabled is never checked")
	unset := valid
	unset.Tiers, unset.OnOverflow = nil, ""
	require.NoError(t, validateResponseCacheTagHeader(unset), "unset is every tier, truncated")
	require.Equal(t, allCacheTagTiers, newCacheTagHeader(unset, nil).tiers)

	cases := map[string]func(*config.ResponseCacheTagHeaderConfig){
		"empty header name":      func(c *config.ResponseCacheTagHeaderConfig) { c.Name = "" },
		"header name with colon": func(c *config.ResponseCacheTagHeaderConfig) { c.Name = "Cache:Tag" },
		"header name with slash": func(c *config.ResponseCacheTagHeaderConfig) { c.Name = "Cache/Tag" },
		"header name with tab":   func(c *config.ResponseCacheTagHeaderConfig) { c.Name = "Cache\tTag" },
		"content-length name":    func(c *config.ResponseCacheTagHeaderConfig) { c.Name = "content-length" },
		"content-type name":      func(c *config.ResponseCacheTagHeaderConfig) { c.Name = "Content-Type" },
		"transfer-encoding name": func(c *config.ResponseCacheTagHeaderConfig) { c.Name = "Transfer-Encoding" },
		"delimiter with nul":     func(c *config.ResponseCacheTagHeaderConfig) { c.Delimiter = "\x00" },
		"empty delimiter":        func(c *config.ResponseCacheTagHeaderConfig) { c.Delimiter = "" },
		"delimiter with newline": func(c *config.ResponseCacheTagHeaderConfig) { c.Delimiter = "\n" },
		"zero max bytes":         func(c *config.ResponseCacheTagHeaderConfig) { c.MaxBytes = 0 },
		"unknown tier":           func(c *config.ResponseCacheTagHeaderConfig) { c.Tiers = []string{"entity"} },
		"unknown overflow":       func(c *config.ResponseCacheTagHeaderConfig) { c.OnOverflow = "drop" },
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
