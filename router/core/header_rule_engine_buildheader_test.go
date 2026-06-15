package core

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

func TestBuildRequestHeaderForSubgraph_GlobalRulesAndHashStable(t *testing.T) {
	ht, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "propagate", Named: "X-A"},
				{Operation: "propagate", Named: "X-B"},
				{Operation: "set", Name: "X-Static", Value: "static"},
			},
		},
	}, nil)
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
	ht, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
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
	}, nil)
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
	ht, err := NewHeaderPropagation(b.Context(), zap.NewNop(), &config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "propagate", Named: "X-A"},
				{Operation: "propagate", Named: "X-B"},
				{Operation: "set", Name: "X-Static", Value: "static"},
			},
		},
	}, nil)
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

func TestSubgraphHeadersBuilder_PrePopulatesAndClones_SyncPlan(t *testing.T) {
	// Header rules to propagate X-A and set X-Static
	ht, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "propagate", Named: "X-A"},
				{Operation: "set", Name: "X-Static", Value: "static"},
			},
		},
	}, nil)
	require.NoError(t, err)

	// Prepare client request
	rr := httptest.NewRecorder()
	clientReq := httptest.NewRequest("POST", "http://localhost", nil)
	clientReq.Header.Set("X-A", "va")

	// Mock request context
	ctx := &requestContext{
		logger:           zap.NewNop(),
		responseWriter:   rr,
		request:          clientReq,
		operation:        &operationContext{},
		subgraphResolver: NewSubgraphResolver(nil),
	}

	// Minimal synchronous plan with two data sources
	p := &plan.SynchronousResponsePlan{
		Response: &resolve.GraphQLResponse{
			DataSources: []resolve.DataSourceInfo{{Name: "sg-1"}, {Name: "sg-2"}},
		},
	}

	// Build headers builder (pre-populates internal cache)
	hb := SubgraphHeadersBuilder(ctx, ht, p)
	require.NotNil(t, hb)

	// First call for sg-1
	h1, hash1 := hb.HeadersForSubgraph("sg-1")
	require.NotNil(t, h1)
	assert.Equal(t, "va", h1.Get("X-A"))
	assert.Equal(t, "static", h1.Get("X-Static"))
	require.NotZero(t, hash1)

	// Mutate returned header instance and call again to ensure clean clone
	h1.Add("X-Manual", "1")
	h2, hash2 := hb.HeadersForSubgraph("sg-1")
	require.NotNil(t, h2)
	assert.Equal(t, "va", h2.Get("X-A"))
	assert.Equal(t, "static", h2.Get("X-Static"))
	assert.Equal(t, "", h2.Get("X-Manual"), "second call must return a clean clone without manual mutations")
	assert.Equal(t, hash1, hash2)

	// Second subgraph should also be present and correct
	hOther, hashOther := hb.HeadersForSubgraph("sg-2")
	require.NotNil(t, hOther)
	assert.Equal(t, "va", hOther.Get("X-A"))
	assert.Equal(t, "static", hOther.Get("X-Static"))
	require.NotZero(t, hashOther)
}

func TestSubgraphHeadersBuilder_IgnoresClientHeaderChangesAfterPrepopulate(t *testing.T) {
	ht, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "propagate", Named: "X-A"},
			},
		},
	}, nil)
	require.NoError(t, err)

	rr := httptest.NewRecorder()
	clientReq := httptest.NewRequest("POST", "http://localhost", nil)
	clientReq.Header.Set("X-A", "pre")

	ctx := &requestContext{
		logger:           zap.NewNop(),
		responseWriter:   rr,
		request:          clientReq,
		operation:        &operationContext{},
		subgraphResolver: NewSubgraphResolver(nil),
	}

	p := &plan.SynchronousResponsePlan{
		Response: &resolve.GraphQLResponse{
			DataSources: []resolve.DataSourceInfo{{Name: "sg-1"}},
		},
	}

	hb := SubgraphHeadersBuilder(ctx, ht, p)
	require.NotNil(t, hb)

	// Change client header after pre-population
	clientReq.Header.Set("X-A", "post")

	h, _ := hb.HeadersForSubgraph("sg-1")
	require.NotNil(t, h)
	// Should still be the pre-populated value
	assert.Equal(t, "pre", h.Get("X-A"))
}

// Note: Subscription test is skipped due to complex type dependencies in the resolve package.
// The subscription functionality is tested indirectly through the synchronous plan tests
// and the actual usage in the codebase.

func TestSubgraphHeadersBuilder_SubscriptionPlan_IncludesTriggerAndResponse(t *testing.T) {
	ht, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "propagate", Named: "X-A"},
				{Operation: "set", Name: "X-Static", Value: "static"},
			},
		},
	}, nil)
	require.NoError(t, err)

	rr := httptest.NewRecorder()
	clientReq := httptest.NewRequest("POST", "http://localhost", nil)
	clientReq.Header.Set("X-A", "va")

	ctx := &requestContext{
		logger:           zap.NewNop(),
		responseWriter:   rr,
		request:          clientReq,
		operation:        &operationContext{},
		subgraphResolver: NewSubgraphResolver(nil),
	}

	p := &plan.SubscriptionResponsePlan{
		Response: &resolve.GraphQLSubscription{
			Response: &resolve.GraphQLResponse{
				DataSources: []resolve.DataSourceInfo{{Name: "sg-resp"}},
			},
			Trigger: resolve.GraphQLSubscriptionTrigger{
				SourceName: "sg-trigger",
			},
		},
	}

	hb := SubgraphHeadersBuilder(ctx, ht, p)
	require.NotNil(t, hb)

	// Test response data source headers
	hResp, hashResp := hb.HeadersForSubgraph("sg-resp")
	require.NotNil(t, hResp)
	assert.Equal(t, "va", hResp.Get("X-A"))
	assert.Equal(t, "static", hResp.Get("X-Static"))
	require.NotZero(t, hashResp)

	// Test trigger data source headers
	hTrig, hashTrig := hb.HeadersForSubgraph("sg-trigger")
	require.NotNil(t, hTrig)
	assert.Equal(t, "va", hTrig.Get("X-A"))
	assert.Equal(t, "static", hTrig.Get("X-Static"))
	require.NotZero(t, hashTrig)

	// Both should have the same hash since they use the same rules
	assert.Equal(t, hashResp, hashTrig)

	// Test that both are cached and return clean clones
	hResp2, hashResp2 := hb.HeadersForSubgraph("sg-resp")
	hTrig2, hashTrig2 := hb.HeadersForSubgraph("sg-trigger")

	// Should be clean clones
	hResp2.Add("X-Manual", "test")
	hTrig2.Add("X-Manual", "test")

	hResp3, _ := hb.HeadersForSubgraph("sg-resp")
	hTrig3, _ := hb.HeadersForSubgraph("sg-trigger")

	assert.Equal(t, "", hResp3.Get("X-Manual"), "response headers should be clean clones")
	assert.Equal(t, "", hTrig3.Get("X-Manual"), "trigger headers should be clean clones")

	// Hashes should be stable
	assert.Equal(t, hashResp, hashResp2)
	assert.Equal(t, hashTrig, hashTrig2)
}

func TestSubgraphHeadersBuilder_MissingPrePopulatedCache(t *testing.T) {
	ht, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "propagate", Named: "X-A"},
				{Operation: "set", Name: "X-Static", Value: "static"},
			},
		},
	}, nil)
	require.NoError(t, err)

	rr := httptest.NewRecorder()
	clientReq := httptest.NewRequest("POST", "http://localhost", nil)
	clientReq.Header.Set("X-A", "va")

	ctx := &requestContext{
		logger:           zap.NewNop(),
		responseWriter:   rr,
		request:          clientReq,
		operation:        &operationContext{},
		subgraphResolver: NewSubgraphResolver(nil),
	}

	// Create a plan with only one subgraph (sg-1)
	p := &plan.SynchronousResponsePlan{
		Response: &resolve.GraphQLResponse{
			DataSources: []resolve.DataSourceInfo{{Name: "sg-1"}},
		},
	}

	hb := SubgraphHeadersBuilder(ctx, ht, p)
	require.NotNil(t, hb)

	// Test that sg-1 is pre-populated and works correctly
	h1, hash1 := hb.HeadersForSubgraph("sg-1")
	require.NotNil(t, h1)
	assert.Equal(t, "va", h1.Get("X-A"))
	assert.Equal(t, "static", h1.Get("X-Static"))
	require.NotZero(t, hash1)

	// Test that sg-2 (not in the plan) returns nil headers and zero hash
	h2, hash2 := hb.HeadersForSubgraph("sg-2")
	assert.Nil(t, h2, "headers for non-pre-populated subgraph should be nil")
	assert.Equal(t, uint64(0), hash2, "hash for non-pre-populated subgraph should be zero")

	// Test that sg-3 (also not in the plan) returns nil headers and zero hash
	h3, hash3 := hb.HeadersForSubgraph("sg-3")
	assert.Nil(t, h3, "headers for non-pre-populated subgraph should be nil")
	assert.Equal(t, uint64(0), hash3, "hash for non-pre-populated subgraph should be zero")

	// Verify that sg-1 still works correctly after checking missing subgraphs
	h1Again, hash1Again := hb.HeadersForSubgraph("sg-1")
	require.NotNil(t, h1Again)
	assert.Equal(t, "va", h1Again.Get("X-A"))
	assert.Equal(t, "static", h1Again.Get("X-Static"))
	assert.Equal(t, hash1, hash1Again, "hash should be stable for pre-populated subgraph")
}

func TestBuildRequestHeaderForSubgraph_FromFile(t *testing.T) {
	t.Parallel()

	t.Run("global rule sets header from file contents", func(t *testing.T) {
		t.Parallel()

		path := writeHeaderSourceFile(t, "secret-token")
		ht, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{Operation: "set", Name: "X-Auth", FromFile: &config.FileHeaderSource{Path: path, RefreshInterval: time.Second}},
				},
			},
		}, nil)
		require.NoError(t, err)

		rr := httptest.NewRecorder()
		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		ctx := &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: NewSubgraphResolver(nil),
		}

		h, hash := ht.BuildRequestHeaderForSubgraph("", ctx)
		assert.Equal(t, "secret-token", h.Get("X-Auth"))
		require.NotZero(t, hash)
	})

	t.Run("two rules with different files set their respective headers", func(t *testing.T) {
		t.Parallel()

		pathA := writeHeaderSourceFile(t, "value-a")
		pathB := writeHeaderSourceFile(t, "value-b")

		ht, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{Operation: "set", Name: "X-A", FromFile: &config.FileHeaderSource{Path: pathA, RefreshInterval: time.Second}},
					{Operation: "set", Name: "X-B", FromFile: &config.FileHeaderSource{Path: pathB, RefreshInterval: time.Second}},
				},
			},
		}, nil)
		require.NoError(t, err)

		rr := httptest.NewRecorder()
		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		ctx := &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: NewSubgraphResolver(nil),
		}

		h, _ := ht.BuildRequestHeaderForSubgraph("", ctx)
		assert.Equal(t, "value-a", h.Get("X-A"))
		assert.Equal(t, "value-b", h.Get("X-B"))
	})

	t.Run("subgraph-scoped rule sets header only on matching subgraph", func(t *testing.T) {
		t.Parallel()

		path := writeHeaderSourceFile(t, "sg1-secret")
		ht, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
			Subgraphs: map[string]*config.GlobalHeaderRule{
				"sg-1": {
					Request: []*config.RequestHeaderRule{
						{Operation: "set", Name: "X-Auth", FromFile: &config.FileHeaderSource{Path: path, RefreshInterval: time.Second}},
					},
				},
			},
		}, nil)
		require.NoError(t, err)

		rr := httptest.NewRecorder()
		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		ctx := &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: NewSubgraphResolver(nil),
		}

		matched, _ := ht.BuildRequestHeaderForSubgraph("sg-1", ctx)
		assert.Equal(t, "sg1-secret", matched.Get("X-Auth"))

		other, _ := ht.BuildRequestHeaderForSubgraph("sg-2", ctx)
		assert.Equal(t, "", other.Get("X-Auth"), "subgraph-scoped rule must not apply to other subgraphs")
	})

	t.Run("subgraph FromFile rule overrides All rule on the same header name", func(t *testing.T) {
		t.Parallel()

		// Same header name, two source files: All -> default, sg-1 -> override.
		// Expected: sg-1 receives the override value; other subgraphs fall back to the All value.
		allPath := writeHeaderSourceFile(t, "default-token")
		sg1Path := writeHeaderSourceFile(t, "sg1-token")

		ht, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{Operation: "set", Name: "X-Auth", FromFile: &config.FileHeaderSource{Path: allPath, RefreshInterval: time.Second}},
				},
			},
			Subgraphs: map[string]*config.GlobalHeaderRule{
				"sg-1": {
					Request: []*config.RequestHeaderRule{
						{Operation: "set", Name: "X-Auth", FromFile: &config.FileHeaderSource{Path: sg1Path, RefreshInterval: time.Second}},
					},
				},
			},
		}, nil)
		require.NoError(t, err)

		rr := httptest.NewRecorder()
		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		ctx := &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: NewSubgraphResolver(nil),
		}

		// sg-1 has an override rule — must win against the All rule.
		matched, hashMatched := ht.BuildRequestHeaderForSubgraph("sg-1", ctx)
		assert.Equal(t, "sg1-token", matched.Get("X-Auth"))
		require.NotZero(t, hashMatched)

		// sg-2 has no override — falls back to the All rule's file contents.
		other, hashOther := ht.BuildRequestHeaderForSubgraph("sg-2", ctx)
		assert.Equal(t, "default-token", other.Get("X-Auth"))
		require.NotZero(t, hashOther)

		// Two different header values => two different stable hashes.
		assert.NotEqual(t, hashMatched, hashOther, "override and fallback should yield distinct subgraph header hashes")
	})

	t.Run("All and subgraph FromFile rules with different header names coexist", func(t *testing.T) {
		t.Parallel()

		// Different header names: both rules apply for the targeted subgraph,
		// only the All rule applies for unrelated subgraphs.
		allPath := writeHeaderSourceFile(t, "global-value")
		sg1Path := writeHeaderSourceFile(t, "sg1-value")

		ht, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{Operation: "set", Name: "X-Global", FromFile: &config.FileHeaderSource{Path: allPath, RefreshInterval: time.Second}},
				},
			},
			Subgraphs: map[string]*config.GlobalHeaderRule{
				"sg-1": {
					Request: []*config.RequestHeaderRule{
						{Operation: "set", Name: "X-Sg", FromFile: &config.FileHeaderSource{Path: sg1Path, RefreshInterval: time.Second}},
					},
				},
			},
		}, nil)
		require.NoError(t, err)

		rr := httptest.NewRecorder()
		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		ctx := &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: NewSubgraphResolver(nil),
		}

		matched, _ := ht.BuildRequestHeaderForSubgraph("sg-1", ctx)
		assert.Equal(t, "global-value", matched.Get("X-Global"))
		assert.Equal(t, "sg1-value", matched.Get("X-Sg"))

		other, _ := ht.BuildRequestHeaderForSubgraph("sg-2", ctx)
		assert.Equal(t, "global-value", other.Get("X-Global"))
		assert.Equal(t, "", other.Get("X-Sg"), "subgraph-scoped rule must not leak to other subgraphs")
	})

	t.Run("header value refreshes after the source file is modified", func(t *testing.T) {
		t.Parallel()

		// Real-time integration test: confirms that the engine's file-watcher
		// reloads the in-memory buffer and that subsequent BuildRequestHeaderForSubgraph
		// calls observe the updated value. The watcher's deterministic ticking is
		// already covered by pkg/watcher tests; here we just verify the engine
		// wires the refresh through to the header path.
		path := writeHeaderSourceFile(t, "initial-token")

		ht, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{Operation: "set", Name: "X-Auth", FromFile: &config.FileHeaderSource{Path: path, RefreshInterval: 50 * time.Millisecond}},
				},
			},
		}, nil)
		require.NoError(t, err)

		// The watcher goroutine captures its baseline mtime once it actually
		// runs (after `go` scheduling). If we rewrite the file before that
		// baseline is captured, the baseline is taken from the rewritten file
		// and the watcher never sees a change. One refresh interval is enough
		// to guarantee the goroutine reached its pre-loop stat.
		time.Sleep(100 * time.Millisecond)

		rr := httptest.NewRecorder()
		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		ctx := &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: NewSubgraphResolver(nil),
		}

		// Initial value comes from the file's first contents.
		h, _ := ht.BuildRequestHeaderForSubgraph("", ctx)
		require.Equal(t, "initial-token", h.Get("X-Auth"))

		// Rewrite the same path with new contents. The watcher requires two
		// stable ticks (one to detect the mtime change, one to confirm) before
		// firing the reload callback — at 50ms interval that's ~100-150ms.
		require.NoError(t, os.WriteFile(path, []byte("rotated-token"), 0o600))

		require.Eventually(t, func() bool {
			h, _ := ht.BuildRequestHeaderForSubgraph("", ctx)
			return h.Get("X-Auth") == "rotated-token"
		}, 5*time.Second, 50*time.Millisecond, "expected header to reflect the rewritten file contents")
	})

	t.Run("header value preserves raw file contents including trailing newline", func(t *testing.T) {
		t.Parallel()

		// Regression guard: the apply path reads buffer.String() with no trimming,
		// so callers must be aware that secret files with trailing newlines will
		// carry that newline into the outbound header. If trimming is later added,
		// this test should be updated accordingly.
		path := writeHeaderSourceFile(t, "token-with-newline\n")
		ht, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{Operation: "set", Name: "X-Auth", FromFile: &config.FileHeaderSource{Path: path, RefreshInterval: time.Second}},
				},
			},
		}, nil)
		require.NoError(t, err)

		rr := httptest.NewRecorder()
		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		ctx := &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: NewSubgraphResolver(nil),
		}

		h, _ := ht.BuildRequestHeaderForSubgraph("", ctx)
		assert.Equal(t, "token-with-newline\n", h.Get("X-Auth"))
	})
}

func TestSubgraphHeadersBuilder_ConcurrentAccessSameSubgraph(t *testing.T) {
	ht, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "propagate", Named: "X-A"},
				{Operation: "set", Name: "X-Static", Value: "static"},
			},
		},
	}, nil)
	require.NoError(t, err)

	rr := httptest.NewRecorder()
	clientReq := httptest.NewRequest("POST", "http://localhost", nil)
	clientReq.Header.Set("X-A", "va")

	ctx := &requestContext{
		logger:           zap.NewNop(),
		responseWriter:   rr,
		request:          clientReq,
		operation:        &operationContext{},
		subgraphResolver: NewSubgraphResolver(nil),
	}

	p := &plan.SynchronousResponsePlan{
		Response: &resolve.GraphQLResponse{
			DataSources: []resolve.DataSourceInfo{{Name: "sg-1"}},
		},
	}

	hb := SubgraphHeadersBuilder(ctx, ht, p)
	require.NotNil(t, hb)

	const workers = 16
	type result struct {
		h    http.Header
		hash uint64
	}
	ch := make(chan result, workers)

	for i := 0; i < workers; i++ {
		go func() {
			h, hash := hb.HeadersForSubgraph("sg-1")
			ch <- result{h: h, hash: hash}
		}()
	}

	var first result
	for i := 0; i < workers; i++ {
		r := <-ch
		if i == 0 {
			first = r
			require.NotNil(t, first.h)
			assert.Equal(t, "va", first.h.Get("X-A"))
			assert.Equal(t, "static", first.h.Get("X-Static"))
			require.NotZero(t, first.hash)
		} else {
			require.NotNil(t, r.h)
			assert.Equal(t, "va", r.h.Get("X-A"))
			assert.Equal(t, "static", r.h.Get("X-Static"))
			assert.Equal(t, first.hash, r.hash)
		}
	}
}
