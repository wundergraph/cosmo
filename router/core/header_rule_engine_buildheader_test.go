package core

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

func TestBuildRequestHeaderForSubgraph_GlobalRulesAndHashStable(t *testing.T) {
	ht, err := NewHeaderPropagation(&config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "propagate", Named: "X-A"},
				{Operation: "propagate", Named: "X-B"},
				{Operation: "set", Name: "X-Static", Value: "static"},
			},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, ht)

	rr := httptest.NewRecorder()
	clientReq, err := http.NewRequest("POST", "http://localhost", nil)
	require.NoError(t, err)
	clientReq.Header.Set("X-A", "va")
	clientReq.Header.Add("X-B", "vb1")
	clientReq.Header.Add("X-B", "vb2")

	ctx := &requestContext{
		logger:           zap.NewNop(),
		responseWriter:   rr,
		request:          clientReq,
		operation:        &operationContext{},
		subgraphResolver: NewSubgraphResolver(nil),
	}

	// Build twice and ensure the hash is stable and headers equal
	h1, hash1 := ht.BuildRequestHeaderForSubgraph("", ctx)
	_, hash2 := ht.BuildRequestHeaderForSubgraph("", ctx)

	assert.Equal(t, hash1, hash2)
	assert.Equal(t, h1.Get("X-A"), "va")
	assert.Equal(t, h1.Values("X-B"), []string{"vb1", "vb2"})
	assert.Equal(t, "static", h1.Get("X-Static"))
}

func TestBuildRequestHeaderForSubgraph_SubgraphSpecificRules(t *testing.T) {
	ht, err := NewHeaderPropagation(&config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "propagate", Named: "X-Global"},
			},
		},
		Subgraphs: map[string]*config.GlobalHeaderRule{
			"sg-1": {
				Request: []*config.RequestHeaderRule{
					{Operation: "propagate", Named: "X-SG"},
					{Operation: "set", Name: "X-From-Rule", Value: "ok"},
				},
			},
		},
	})
	require.NoError(t, err)

	rr := httptest.NewRecorder()
	clientReq, err := http.NewRequest("POST", "http://localhost", nil)
	require.NoError(t, err)
	clientReq.Header.Set("X-Global", "ga")
	clientReq.Header.Set("X-SG", "sa")

	ctx := &requestContext{
		logger:           zap.NewNop(),
		responseWriter:   rr,
		request:          clientReq,
		operation:        &operationContext{},
		subgraphResolver: NewSubgraphResolver(nil),
	}

	hdr, _ := ht.BuildRequestHeaderForSubgraph("sg-1", ctx)
	assert.Equal(t, "ga", hdr.Get("X-Global"))
	assert.Equal(t, "sa", hdr.Get("X-SG"))
	assert.Equal(t, "ok", hdr.Get("X-From-Rule"))
}

func BenchmarkHashHeaderStable(b *testing.B) {
	// Prepare a representative header set with multiple keys and values
	hdr := make(http.Header)
	hdr.Set("X-A", "a1")
	hdr.Add("X-A", "a2")
	hdr.Add("X-A", "a3")
	hdr.Set("X-B", "b1")
	hdr.Add("X-B", "b2")
	hdr.Set("X-C", "c1")
	hdr.Set("Content-Length", "1234")
	hdr.Set("X-Static", "static")

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = hashHeaderStable(hdr)
	}
}

func BenchmarkBuildRequestHeaderForSubgraph(b *testing.B) {
	// Build rules that propagate and set a few headers
	ht, err := NewHeaderPropagation(&config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "propagate", Named: "X-A"},
				{Operation: "propagate", Named: "X-B"},
				{Operation: "set", Name: "X-Static", Value: "static"},
			},
		},
	})
	if err != nil {
		b.Fatal(err)
	}

	rr := httptest.NewRecorder()
	clientReq := httptest.NewRequest("POST", "http://localhost", nil)
	clientReq.Header.Set("X-A", "va")
	clientReq.Header.Add("X-B", "vb1")
	clientReq.Header.Add("X-B", "vb2")

	ctx := &requestContext{
		logger:           zap.NewNop(),
		responseWriter:   rr,
		request:          clientReq,
		operation:        &operationContext{},
		subgraphResolver: NewSubgraphResolver(nil),
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = ht.BuildRequestHeaderForSubgraph("", ctx)
	}
}

func TestBuildRequestHeaderForSubgraph_CacheHitSecondCall(t *testing.T) {
	// Rules propagate X-A and set a static header; scoped to a subgraph
	ht, err := NewHeaderPropagation(&config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "propagate", Named: "X-A"},
				{Operation: "set", Name: "X-Static", Value: "static"},
			},
		},
		Subgraphs: map[string]*config.GlobalHeaderRule{
			"sg-1": {Request: []*config.RequestHeaderRule{}},
		},
	})
	require.NoError(t, err)

	rr := httptest.NewRecorder()
	clientReq := httptest.NewRequest("POST", "http://localhost", nil)
	clientReq.Header.Set("X-A", "1")

	ctx := &requestContext{
		logger:           zap.NewNop(),
		responseWriter:   rr,
		request:          clientReq,
		operation:        &operationContext{},
		subgraphResolver: NewSubgraphResolver(nil),
	}

	// First call should build and populate the cache
	h1, hash1 := ht.BuildRequestHeaderForSubgraph("sg-1", ctx)
	require.NotNil(t, h1)
	require.NotZero(t, hash1)
	cached := ctx.subgraphRequestHeaderBuilderCache["sg-1"]
	require.NotNil(t, cached)
	assert.Equal(t, hash1, cached.Hash)
	assert.Equal(t, h1.Get("X-A"), cached.Header.Get("X-A"))

	// Mutate the client request header to a different value
	clientReq.Header.Set("X-A", "2")

	// Second call should return from cache; header and hash unchanged
	h2, hash2 := ht.BuildRequestHeaderForSubgraph("sg-1", ctx)
	assert.Equal(t, hash1, hash2)
	assert.Equal(t, "1", h2.Get("X-A"))
	assert.Equal(t, "static", h2.Get("X-Static"))
}

func TestBuildRequestHeaderForSubgraph_CacheImmutableAgainstHeaderMutation(t *testing.T) {
	// Propagate X-A for the subgraph
	ht, err := NewHeaderPropagation(&config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "propagate", Named: "X-A"},
			},
		},
		Subgraphs: map[string]*config.GlobalHeaderRule{
			"sg-2": {Request: []*config.RequestHeaderRule{}},
		},
	})
	require.NoError(t, err)

	rr := httptest.NewRecorder()
	clientReq := httptest.NewRequest("POST", "http://localhost", nil)
	clientReq.Header.Set("X-A", "original")

	ctx := &requestContext{
		logger:           zap.NewNop(),
		responseWriter:   rr,
		request:          clientReq,
		operation:        &operationContext{},
		subgraphResolver: NewSubgraphResolver(nil),
	}

	// Build once and then mutate the returned header
	h1, hash1 := ht.BuildRequestHeaderForSubgraph("sg-2", ctx)
	require.NotNil(t, h1)
	h1.Set("X-A", "tampered")

	// Calling again should return the original cached version (not the tampered one)
	h2, hash2 := ht.BuildRequestHeaderForSubgraph("sg-2", ctx)
	assert.Equal(t, hash1, hash2)
	assert.Equal(t, "original", h2.Get("X-A"))

	// Additionally, the cached copy inside the ctx should remain original
	cached := ctx.subgraphRequestHeaderBuilderCache["sg-2"]
	require.NotNil(t, cached)
	assert.Equal(t, "original", cached.Header.Get("X-A"))
}

func TestBuildRequestHeaderForSubgraph_NoRules_NoCacheEntries(t *testing.T) {
	// No rules at all
	ht, err := NewHeaderPropagation(&config.HeaderRules{})
	require.NoError(t, err)
	require.NotNil(t, ht)

	rr := httptest.NewRecorder()
	clientReq := httptest.NewRequest("POST", "http://localhost", nil)

	ctx := &requestContext{
		logger:           zap.NewNop(),
		responseWriter:   rr,
		request:          clientReq,
		operation:        &operationContext{},
		subgraphResolver: NewSubgraphResolver(nil),
	}

	// Call twice for a subgraph with no rules
	h1, hash1 := ht.BuildRequestHeaderForSubgraph("sg-none", ctx)
	h2, hash2 := ht.BuildRequestHeaderForSubgraph("sg-none", ctx)

	// No headers built and no hash computed
	assert.Nil(t, h1)
	assert.Nil(t, h2)
	assert.Equal(t, uint64(0), hash1)
	assert.Equal(t, uint64(0), hash2)

	// Cache must remain empty
	if ctx.subgraphRequestHeaderBuilderCache != nil {
		_, exists := ctx.subgraphRequestHeaderBuilderCache["sg-none"]
		assert.False(t, exists)
		assert.Equal(t, 0, len(ctx.subgraphRequestHeaderBuilderCache))
	}
}
