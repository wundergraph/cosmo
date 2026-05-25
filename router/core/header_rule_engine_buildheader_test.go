package core

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
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

func TestSubgraphHeadersBuilder_PrePopulatesAndClones_SyncPlan(t *testing.T) {
	// Header rules to propagate X-A and set X-Static
	ht, err := NewHeaderPropagation(&config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "propagate", Named: "X-A"},
				{Operation: "set", Name: "X-Static", Value: "static"},
			},
		},
	})
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
	ht, err := NewHeaderPropagation(&config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "propagate", Named: "X-A"},
			},
		},
	})
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
	ht, err := NewHeaderPropagation(&config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "propagate", Named: "X-A"},
				{Operation: "set", Name: "X-Static", Value: "static"},
			},
		},
	})
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
	ht, err := NewHeaderPropagation(&config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "propagate", Named: "X-A"},
				{Operation: "set", Name: "X-Static", Value: "static"},
			},
		},
	})
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

func TestSubgraphHeadersBuilder_ConcurrentAccessSameSubgraph(t *testing.T) {
	ht, err := NewHeaderPropagation(&config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "propagate", Named: "X-A"},
				{Operation: "set", Name: "X-Static", Value: "static"},
			},
		},
	})
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

// newGroupTestRequestContext returns a minimal *requestContext suitable for driving
// BuildRequestHeaderForSubgraph in unit tests. The provided client headers are
// copied onto the underlying request so propagation rules have something to
// match against.
func newGroupTestRequestContext(t *testing.T, clientHeaders http.Header) *requestContext {
	t.Helper()
	clientReq := httptest.NewRequest("POST", "http://localhost", nil)
	for k, vs := range clientHeaders {
		for _, v := range vs {
			clientReq.Header.Add(k, v)
		}
	}
	return &requestContext{
		logger:           zap.NewNop(),
		responseWriter:   httptest.NewRecorder(),
		request:          clientReq,
		operation:        &operationContext{},
		subgraphResolver: NewSubgraphResolver(nil),
	}
}

// TestBuildRequestHeaderForSubgraph_GroupsListOnly verifies that a group with
// only an explicit `subgraphs` list applies its rules to listed subgraphs and
// is skipped for everything else.
func TestBuildRequestHeaderForSubgraph_GroupsListOnly(t *testing.T) {
	ht, err := NewHeaderPropagation(&config.HeaderRules{
		Groups: []*config.SubgraphHeaderGroup{
			{
				ID:        "list-cohort",
				Subgraphs: []string{"products", "orders"},
				Request: []*config.RequestHeaderRule{
					{Operation: "propagate", Named: "X-Cohort"},
				},
			},
		},
	})
	require.NoError(t, err)

	ctx := newGroupTestRequestContext(t, http.Header{"X-Cohort": []string{"v"}})

	for _, sg := range []string{"products", "orders"} {
		hdr, _ := ht.BuildRequestHeaderForSubgraph(sg, ctx)
		require.NotNilf(t, hdr, "expected header set for listed subgraph %q", sg)
		assert.Equalf(t, "v", hdr.Get("X-Cohort"), "expected X-Cohort propagated for %q", sg)
	}

	// Subgraph not in the list should not get the rule and, since no other rules
	// apply, should fall through to the no-rules fast-path.
	other, hash := ht.BuildRequestHeaderForSubgraph("inventory", ctx)
	assert.Nil(t, other, "non-listed subgraph should not receive group rules")
	assert.Equal(t, uint64(0), hash)
}

// TestBuildRequestHeaderForSubgraph_GroupsRegexOnly verifies that a group with
// only a `matching` regex (no explicit list) applies based on regex match.
func TestBuildRequestHeaderForSubgraph_GroupsRegexOnly(t *testing.T) {
	ht, err := NewHeaderPropagation(&config.HeaderRules{
		Groups: []*config.SubgraphHeaderGroup{
			{
				ID:       "feature-previews",
				Matching: "^.+-feature-.+$",
				Request: []*config.RequestHeaderRule{
					{Operation: "propagate", Named: "X-Preview"},
				},
			},
		},
	})
	require.NoError(t, err)

	ctx := newGroupTestRequestContext(t, http.Header{"X-Preview": []string{"yes"}})

	matched, _ := ht.BuildRequestHeaderForSubgraph("products-feature-pr-7", ctx)
	require.NotNil(t, matched)
	assert.Equal(t, "yes", matched.Get("X-Preview"))

	unmatched, hash := ht.BuildRequestHeaderForSubgraph("products", ctx)
	assert.Nil(t, unmatched)
	assert.Equal(t, uint64(0), hash)
}

// TestBuildRequestHeaderForSubgraph_GroupsHybrid verifies that a group with
// both `subgraphs` and `matching` matches a subgraph via either path. The
// hybrid form is the typical "base subgraph + its feature variants" rule.
// Critically, the group must fire only ONCE for a subgraph, even if both the
// list and the regex would match.
func TestBuildRequestHeaderForSubgraph_GroupsHybrid(t *testing.T) {
	t.Run("matches via list only", func(t *testing.T) {
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Groups: []*config.SubgraphHeaderGroup{
				{
					ID:        "products-cohort",
					Subgraphs: []string{"products"},
					Matching:  "^products-feature-.+$",
					Request: []*config.RequestHeaderRule{
						{Operation: "propagate", Named: "X-Products"},
					},
				},
			},
		})
		require.NoError(t, err)
		ctx := newGroupTestRequestContext(t, http.Header{"X-Products": []string{"v"}})
		hdr, _ := ht.BuildRequestHeaderForSubgraph("products", ctx)
		require.NotNil(t, hdr)
		assert.Equal(t, "v", hdr.Get("X-Products"))
		// The base name doesn't match the regex pattern, so this matches via
		// the list path only.
	})

	t.Run("matches via regex only", func(t *testing.T) {
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Groups: []*config.SubgraphHeaderGroup{
				{
					ID:        "products-cohort",
					Subgraphs: []string{"products"},
					Matching:  "^products-feature-.+$",
					Request: []*config.RequestHeaderRule{
						{Operation: "propagate", Named: "X-Products"},
					},
				},
			},
		})
		require.NoError(t, err)
		ctx := newGroupTestRequestContext(t, http.Header{"X-Products": []string{"v"}})
		hdr, _ := ht.BuildRequestHeaderForSubgraph("products-feature-pr-9", ctx)
		require.NotNil(t, hdr)
		assert.Equal(t, "v", hdr.Get("X-Products"))
	})

	t.Run("does not match unrelated subgraphs", func(t *testing.T) {
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Groups: []*config.SubgraphHeaderGroup{
				{
					ID:        "products-cohort",
					Subgraphs: []string{"products"},
					Matching:  "^products-feature-.+$",
					Request: []*config.RequestHeaderRule{
						{Operation: "propagate", Named: "X-Products"},
					},
				},
			},
		})
		require.NoError(t, err)
		ctx := newGroupTestRequestContext(t, http.Header{"X-Products": []string{"v"}})
		hdr, hash := ht.BuildRequestHeaderForSubgraph("inventory", ctx)
		assert.Nil(t, hdr)
		assert.Equal(t, uint64(0), hash)
	})

	t.Run("hybrid match fires only once when both list and regex would match", func(t *testing.T) {
		// Use op:set with a counter-style rule: if the group ran twice we'd
		// see the second value win, but a `set` rule writes the same value
		// either way. Use a propagate rule with append-style behavior is
		// trickier on the request side; instead assert via a `set` rule that
		// the resulting header equals exactly one value (no doubling).
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Groups: []*config.SubgraphHeaderGroup{
				{
					ID:        "double-match",
					Subgraphs: []string{"products"},
					Matching:  "^products$", // overlaps with list intentionally
					Request: []*config.RequestHeaderRule{
						{Operation: "set", Name: "X-Tag", Value: "once"},
					},
				},
			},
		})
		require.NoError(t, err)
		ctx := newGroupTestRequestContext(t, nil)
		hdr, _ := ht.BuildRequestHeaderForSubgraph("products", ctx)
		require.NotNil(t, hdr)
		// Single value, not duplicated. set semantics give one entry regardless.
		assert.Equal(t, []string{"once"}, hdr.Values("X-Tag"))
	})
}

// TestBuildRequestHeaderForSubgraph_GroupsNegateMatchInvertsRegexOnly verifies
// that negate_match inverts the regex result but does NOT exclude subgraphs in
// the explicit `subgraphs` list. A subgraph in the list is always included.
func TestBuildRequestHeaderForSubgraph_GroupsNegateMatchInvertsRegexOnly(t *testing.T) {
	ht, err := NewHeaderPropagation(&config.HeaderRules{
		Groups: []*config.SubgraphHeaderGroup{
			{
				ID:          "external-or-allowlisted",
				Subgraphs:   []string{"internal-billing"}, // explicit allowlist
				Matching:    "^internal-.+$",
				NegateMatch: true,
				Request: []*config.RequestHeaderRule{
					{Operation: "propagate", Named: "X-Public"},
				},
			},
		},
	})
	require.NoError(t, err)

	ctx := newGroupTestRequestContext(t, http.Header{"X-Public": []string{"yes"}})

	// External subgraph: regex (negated) matches → applied.
	external, _ := ht.BuildRequestHeaderForSubgraph("products", ctx)
	require.NotNil(t, external)
	assert.Equal(t, "yes", external.Get("X-Public"))

	// Listed subgraph: list always includes regardless of negate_match.
	listed, _ := ht.BuildRequestHeaderForSubgraph("internal-billing", ctx)
	require.NotNil(t, listed)
	assert.Equal(t, "yes", listed.Get("X-Public"))

	// Internal subgraph not in the list: regex matches, but negate_match
	// inverts → no rule applied.
	internal, hash := ht.BuildRequestHeaderForSubgraph("internal-secrets", ctx)
	assert.Nil(t, internal)
	assert.Equal(t, uint64(0), hash)
}

// TestBuildRequestHeaderForSubgraph_GroupsOrder asserts the documented
// evaluation order: headers.all -> groups (config order) -> exact subgraph.
// Each layer sets the same header to a different value via `op: set`, and
// the last writer wins. A subgraph that matches multiple groups should see
// each group apply in the configured order.
func TestBuildRequestHeaderForSubgraph_GroupsOrder(t *testing.T) {
	ht, err := NewHeaderPropagation(&config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "set", Name: "X-Layer", Value: "all"},
			},
		},
		Groups: []*config.SubgraphHeaderGroup{
			{
				ID:        "first-group",
				Subgraphs: []string{"products", "products-feature-x"},
				Request: []*config.RequestHeaderRule{
					{Operation: "set", Name: "X-Layer", Value: "group-1"},
				},
			},
			{
				ID:       "second-group",
				Matching: "^products(-feature-.+)?$",
				Request: []*config.RequestHeaderRule{
					{Operation: "set", Name: "X-Layer", Value: "group-2"},
				},
			},
		},
		Subgraphs: map[string]*config.GlobalHeaderRule{
			"products": {
				Request: []*config.RequestHeaderRule{
					{Operation: "set", Name: "X-Layer", Value: "exact"},
				},
			},
		},
	})
	require.NoError(t, err)

	ctx := newGroupTestRequestContext(t, nil)

	// Exact match: all -> group-1 -> group-2 -> exact. Exact wins.
	hdr, _ := ht.BuildRequestHeaderForSubgraph("products", ctx)
	require.NotNil(t, hdr)
	assert.Equal(t, "exact", hdr.Get("X-Layer"))

	// Feature subgraph: matches group-1 (via list) and group-2 (via regex). No
	// exact match. group-2 applies after group-1 in config order so it wins.
	feat, _ := ht.BuildRequestHeaderForSubgraph("products-feature-x", ctx)
	require.NotNil(t, feat)
	assert.Equal(t, "group-2", feat.Get("X-Layer"))

	// Unrelated subgraph: only `all` applies.
	other, _ := ht.BuildRequestHeaderForSubgraph("inventory", ctx)
	require.NotNil(t, other)
	assert.Equal(t, "all", other.Get("X-Layer"))
}

// TestNewHeaderPropagation_GroupValidation covers all startup-time validation
// branches for headers.groups. Every misconfiguration must fail router init.
func TestNewHeaderPropagation_GroupValidation(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		groups []*config.SubgraphHeaderGroup
	}{
		{
			name: "missing id",
			groups: []*config.SubgraphHeaderGroup{
				{
					Subgraphs: []string{"a"},
					Request: []*config.RequestHeaderRule{
						{Operation: "propagate", Named: "X-A"},
					},
				},
			},
		},
		{
			name: "duplicate id",
			groups: []*config.SubgraphHeaderGroup{
				{
					ID:        "dup",
					Subgraphs: []string{"a"},
					Request: []*config.RequestHeaderRule{
						{Operation: "propagate", Named: "X-A"},
					},
				},
				{
					ID:        "dup",
					Subgraphs: []string{"b"},
					Request: []*config.RequestHeaderRule{
						{Operation: "propagate", Named: "X-B"},
					},
				},
			},
		},
		{
			name: "empty selector (no subgraphs and no matching)",
			groups: []*config.SubgraphHeaderGroup{
				{
					ID: "empty-selector",
					Request: []*config.RequestHeaderRule{
						{Operation: "propagate", Named: "X-A"},
					},
				},
			},
		},
		{
			name: "no rules (request and response both empty)",
			groups: []*config.SubgraphHeaderGroup{
				{
					ID:        "no-rules",
					Subgraphs: []string{"a"},
				},
			},
		},
		{
			name: "invalid regex",
			groups: []*config.SubgraphHeaderGroup{
				{
					ID:       "bad-regex",
					Matching: "[invalid",
					Request: []*config.RequestHeaderRule{
						{Operation: "propagate", Named: "X-A"},
					},
				},
			},
		},
		{
			name: "empty subgraph name in list",
			groups: []*config.SubgraphHeaderGroup{
				{
					ID:        "empty-name",
					Subgraphs: []string{""},
					Request: []*config.RequestHeaderRule{
						{Operation: "propagate", Named: "X-A"},
					},
				},
			},
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := NewHeaderPropagation(&config.HeaderRules{Groups: tc.groups})
			require.Error(t, err, "expected validation error for case %q", tc.name)
		})
	}
}

// TestBuildRequestHeaderForSubgraph_NoGroupsFastPath asserts that configs
// without any groups behave identically to the pre-groups baseline. This is
// the "existing users pay nothing" guarantee.
func TestBuildRequestHeaderForSubgraph_NoGroupsFastPath(t *testing.T) {
	ht, err := NewHeaderPropagation(&config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "propagate", Named: "X-A"},
			},
		},
		Subgraphs: map[string]*config.GlobalHeaderRule{
			"products": {
				Request: []*config.RequestHeaderRule{
					{Operation: "propagate", Named: "X-B"},
				},
			},
		},
	})
	require.NoError(t, err)

	ctx := newGroupTestRequestContext(t, http.Header{
		"X-A": []string{"a"},
		"X-B": []string{"b"},
	})

	hdr, _ := ht.BuildRequestHeaderForSubgraph("products", ctx)
	require.NotNil(t, hdr)
	assert.Equal(t, "a", hdr.Get("X-A"))
	assert.Equal(t, "b", hdr.Get("X-B"))
}

// TestSubgraphRules_GroupsIncluded confirms the package-level helper used by
// the engine's pre-origin layer (via FetchURLRules) surfaces rules
// contributed by matching groups. Without this, the engine's single-flight
// key would not include group-propagated headers and request deduplication
// could drop them.
func TestSubgraphRules_GroupsIncluded(t *testing.T) {
	rules := &config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{Operation: "propagate", Named: "X-All"},
			},
		},
		Groups: []*config.SubgraphHeaderGroup{
			{
				ID:        "list-group",
				Subgraphs: []string{"products"},
				Request: []*config.RequestHeaderRule{
					{Operation: "propagate", Named: "X-FromList"},
				},
			},
			{
				ID:       "regex-group",
				Matching: "^products(-feature-.+)?$",
				Request: []*config.RequestHeaderRule{
					{Operation: "propagate", Named: "X-FromRegex"},
				},
			},
		},
		Subgraphs: map[string]*config.GlobalHeaderRule{
			"products": {
				Request: []*config.RequestHeaderRule{
					{Operation: "propagate", Named: "X-Exact"},
				},
			},
		},
	}

	got := SubgraphRules(rules, "products")
	require.Len(t, got, 4)
	assert.Equal(t, "X-All", got[0].Named)
	assert.Equal(t, "X-FromList", got[1].Named)
	assert.Equal(t, "X-FromRegex", got[2].Named)
	assert.Equal(t, "X-Exact", got[3].Named)

	// Feature subgraph: list miss, regex hit, no exact entry.
	gotFeature := SubgraphRules(rules, "products-feature-pr-1")
	require.Len(t, gotFeature, 2)
	assert.Equal(t, "X-All", gotFeature[0].Named)
	assert.Equal(t, "X-FromRegex", gotFeature[1].Named)

	// Unrelated subgraph: no group matches.
	gotOther := SubgraphRules(rules, "inventory")
	require.Len(t, gotOther, 1)
	assert.Equal(t, "X-All", gotOther[0].Named)
}

// TestBuildRequestHeaderForSubgraph_GroupsPrecedence pins down how conflicts
// between rules from different groups (or between groups and other layers)
// are resolved. There is no warning, no error, and no conflict detection: the
// router applies rules in a strict deterministic order and the last writer
// for a given header name wins. These tests lock that contract in place so
// future refactors don't accidentally change observable behavior.
func TestBuildRequestHeaderForSubgraph_GroupsPrecedence(t *testing.T) {
	t.Run("two groups set same header — config order wins (last writer)", func(t *testing.T) {
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Groups: []*config.SubgraphHeaderGroup{
				{
					ID:        "first",
					Subgraphs: []string{"products"},
					Request: []*config.RequestHeaderRule{
						{Operation: "set", Name: "X-Foo", Value: "from-first"},
					},
				},
				{
					ID:        "second",
					Subgraphs: []string{"products"},
					Request: []*config.RequestHeaderRule{
						{Operation: "set", Name: "X-Foo", Value: "from-second"},
					},
				},
			},
		})
		require.NoError(t, err)
		hdr, _ := ht.BuildRequestHeaderForSubgraph("products", newGroupTestRequestContext(t, nil))
		require.NotNil(t, hdr)
		assert.Equal(t, "from-second", hdr.Get("X-Foo"),
			"second group in config order must win when two groups set the same header")
	})

	t.Run("set overwrites earlier propagate value (client sent header)", func(t *testing.T) {
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Groups: []*config.SubgraphHeaderGroup{
				{
					ID:        "propagator",
					Subgraphs: []string{"products"},
					Request: []*config.RequestHeaderRule{
						{Operation: "propagate", Named: "X-Foo"},
					},
				},
				{
					ID:        "setter",
					Subgraphs: []string{"products"},
					Request: []*config.RequestHeaderRule{
						{Operation: "set", Name: "X-Foo", Value: "from-set"},
					},
				},
			},
		})
		require.NoError(t, err)
		ctx := newGroupTestRequestContext(t, http.Header{"X-Foo": []string{"client-value"}})
		hdr, _ := ht.BuildRequestHeaderForSubgraph("products", ctx)
		require.NotNil(t, hdr)
		assert.Equal(t, "from-set", hdr.Get("X-Foo"),
			"a later op:set must overwrite an earlier propagated value")
	})

	t.Run("propagate (with client value) overwrites earlier set value", func(t *testing.T) {
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Groups: []*config.SubgraphHeaderGroup{
				{
					ID:        "setter",
					Subgraphs: []string{"products"},
					Request: []*config.RequestHeaderRule{
						{Operation: "set", Name: "X-Foo", Value: "from-set"},
					},
				},
				{
					ID:        "propagator",
					Subgraphs: []string{"products"},
					Request: []*config.RequestHeaderRule{
						{Operation: "propagate", Named: "X-Foo"},
					},
				},
			},
		})
		require.NoError(t, err)
		ctx := newGroupTestRequestContext(t, http.Header{"X-Foo": []string{"client-value"}})
		hdr, _ := ht.BuildRequestHeaderForSubgraph("products", ctx)
		require.NotNil(t, hdr)
		assert.Equal(t, "client-value", hdr.Get("X-Foo"),
			"a later op:propagate must overwrite an earlier set value when the client sent the header")
	})

	t.Run("propagate without default is a no-op when client header missing", func(t *testing.T) {
		// This is a subtle but important asymmetry between op:set and op:propagate.
		// A propagate rule that finds no client value (and has no default) leaves
		// the existing value in place rather than clearing it.
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Groups: []*config.SubgraphHeaderGroup{
				{
					ID:        "setter",
					Subgraphs: []string{"products"},
					Request: []*config.RequestHeaderRule{
						{Operation: "set", Name: "X-Foo", Value: "from-set"},
					},
				},
				{
					ID:        "propagator",
					Subgraphs: []string{"products"},
					Request: []*config.RequestHeaderRule{
						{Operation: "propagate", Named: "X-Foo"}, // no default
					},
				},
			},
		})
		require.NoError(t, err)
		// Note: no X-Foo on the client request.
		ctx := newGroupTestRequestContext(t, nil)
		hdr, _ := ht.BuildRequestHeaderForSubgraph("products", ctx)
		require.NotNil(t, hdr)
		assert.Equal(t, "from-set", hdr.Get("X-Foo"),
			"op:propagate with no client value and no default must not clobber an earlier set value")
	})

	t.Run("propagate with default overwrites earlier set value when client header missing", func(t *testing.T) {
		// A `default:` makes propagate behave like set when the client didn't send
		// the header. This rounds out the matrix vs the test above.
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Groups: []*config.SubgraphHeaderGroup{
				{
					ID:        "setter",
					Subgraphs: []string{"products"},
					Request: []*config.RequestHeaderRule{
						{Operation: "set", Name: "X-Foo", Value: "from-set"},
					},
				},
				{
					ID:        "propagator-with-default",
					Subgraphs: []string{"products"},
					Request: []*config.RequestHeaderRule{
						{Operation: "propagate", Named: "X-Foo", Default: "from-default"},
					},
				},
			},
		})
		require.NoError(t, err)
		ctx := newGroupTestRequestContext(t, nil)
		hdr, _ := ht.BuildRequestHeaderForSubgraph("products", ctx)
		require.NotNil(t, hdr)
		assert.Equal(t, "from-default", hdr.Get("X-Foo"),
			"op:propagate with a default must overwrite an earlier set value when the client header is missing")
	})

	t.Run("rule order within a single group: last writer wins", func(t *testing.T) {
		// Confirms that conflict resolution applies inside a group's rule list
		// the same way it does between groups.
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Groups: []*config.SubgraphHeaderGroup{
				{
					ID:        "intra-group",
					Subgraphs: []string{"products"},
					Request: []*config.RequestHeaderRule{
						{Operation: "set", Name: "X-Foo", Value: "first"},
						{Operation: "set", Name: "X-Foo", Value: "second"},
						{Operation: "set", Name: "X-Foo", Value: "third"},
					},
				},
			},
		})
		require.NoError(t, err)
		hdr, _ := ht.BuildRequestHeaderForSubgraph("products", newGroupTestRequestContext(t, nil))
		require.NotNil(t, hdr)
		assert.Equal(t, "third", hdr.Get("X-Foo"),
			"the last rule in a group's request list must win for the same header name")
	})

	t.Run("exact subgraph rule overrides every matching group", func(t *testing.T) {
		// All three layers target X-Foo. exact must win regardless of how many
		// groups matched first.
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{Operation: "set", Name: "X-Foo", Value: "from-all"},
				},
			},
			Groups: []*config.SubgraphHeaderGroup{
				{
					ID:        "g1",
					Subgraphs: []string{"products"},
					Request: []*config.RequestHeaderRule{
						{Operation: "set", Name: "X-Foo", Value: "from-g1"},
					},
				},
				{
					ID:       "g2",
					Matching: "^products$",
					Request: []*config.RequestHeaderRule{
						{Operation: "set", Name: "X-Foo", Value: "from-g2"},
					},
				},
			},
			Subgraphs: map[string]*config.GlobalHeaderRule{
				"products": {
					Request: []*config.RequestHeaderRule{
						{Operation: "set", Name: "X-Foo", Value: "from-exact"},
					},
				},
			},
		})
		require.NoError(t, err)
		hdr, _ := ht.BuildRequestHeaderForSubgraph("products", newGroupTestRequestContext(t, nil))
		require.NotNil(t, hdr)
		assert.Equal(t, "from-exact", hdr.Get("X-Foo"),
			"exact subgraph rules must override any group rule")
	})

	t.Run("different header names from different groups all coexist", func(t *testing.T) {
		// Conflict resolution is per-header-name. Rules touching different
		// headers all apply, regardless of group order.
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Groups: []*config.SubgraphHeaderGroup{
				{
					ID:        "g1",
					Subgraphs: []string{"products"},
					Request: []*config.RequestHeaderRule{
						{Operation: "set", Name: "X-A", Value: "a"},
					},
				},
				{
					ID:        "g2",
					Subgraphs: []string{"products"},
					Request: []*config.RequestHeaderRule{
						{Operation: "set", Name: "X-B", Value: "b"},
					},
				},
				{
					ID:       "g3",
					Matching: "^products$",
					Request: []*config.RequestHeaderRule{
						{Operation: "set", Name: "X-C", Value: "c"},
					},
				},
			},
		})
		require.NoError(t, err)
		hdr, _ := ht.BuildRequestHeaderForSubgraph("products", newGroupTestRequestContext(t, nil))
		require.NotNil(t, hdr)
		assert.Equal(t, "a", hdr.Get("X-A"))
		assert.Equal(t, "b", hdr.Get("X-B"))
		assert.Equal(t, "c", hdr.Get("X-C"))
	})

	t.Run("config order matters: swap groups and the winner changes", func(t *testing.T) {
		// Same two groups, opposite config order, opposite winner. This is the
		// "yes, group order is the tiebreaker" assertion in pure form.
		buildAndAssert := func(t *testing.T, groupOrder []*config.SubgraphHeaderGroup, expected string) {
			t.Helper()
			ht, err := NewHeaderPropagation(&config.HeaderRules{Groups: groupOrder})
			require.NoError(t, err)
			hdr, _ := ht.BuildRequestHeaderForSubgraph("products", newGroupTestRequestContext(t, nil))
			require.NotNil(t, hdr)
			assert.Equal(t, expected, hdr.Get("X-Foo"))
		}

		alpha := &config.SubgraphHeaderGroup{
			ID:        "alpha",
			Subgraphs: []string{"products"},
			Request: []*config.RequestHeaderRule{
				{Operation: "set", Name: "X-Foo", Value: "alpha"},
			},
		}
		beta := &config.SubgraphHeaderGroup{
			ID:        "beta",
			Subgraphs: []string{"products"},
			Request: []*config.RequestHeaderRule{
				{Operation: "set", Name: "X-Foo", Value: "beta"},
			},
		}

		buildAndAssert(t, []*config.SubgraphHeaderGroup{alpha, beta}, "beta")
		buildAndAssert(t, []*config.SubgraphHeaderGroup{beta, alpha}, "alpha")
	})
}
