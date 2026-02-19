package core

import (
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	cachedirective "github.com/pquerna/cachecontrol/cacheobject"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestCreateMostRestrictivePolicy(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		policies       []*cachedirective.Object
		expectedHeader string
	}{
		{
			name:           "empty policies",
			policies:       []*cachedirective.Object{},
			expectedHeader: "",
		},
		{
			name: "single policy max-age",
			policies: []*cachedirective.Object{
				{RespDirectives: &cachedirective.ResponseCacheDirectives{MaxAge: 60}},
			},
			expectedHeader: "max-age=60",
		},
		{
			name: "no-store short-circuits",
			policies: []*cachedirective.Object{
				{RespDirectives: &cachedirective.ResponseCacheDirectives{NoStore: true}},
				{RespDirectives: &cachedirective.ResponseCacheDirectives{MaxAge: 300}},
			},
			expectedHeader: "no-store",
		},
		{
			name: "no-cache wins over max-age",
			policies: []*cachedirective.Object{
				{RespDirectives: &cachedirective.ResponseCacheDirectives{NoCachePresent: true}},
				{RespDirectives: &cachedirective.ResponseCacheDirectives{MaxAge: 300}},
			},
			expectedHeader: "no-cache",
		},
		{
			name: "shortest max-age wins",
			policies: []*cachedirective.Object{
				{RespDirectives: &cachedirective.ResponseCacheDirectives{MaxAge: 600}},
				{RespDirectives: &cachedirective.ResponseCacheDirectives{MaxAge: 300}},
			},
			expectedHeader: "max-age=300",
		},
		{
			name: "private wins over public",
			policies: []*cachedirective.Object{
				{RespDirectives: &cachedirective.ResponseCacheDirectives{MaxAge: 300, Public: true}},
				{RespDirectives: &cachedirective.ResponseCacheDirectives{MaxAge: 600, PrivatePresent: true}},
			},
			expectedHeader: "max-age=300, private",
		},
		{
			name: "public without private",
			policies: []*cachedirective.Object{
				{RespDirectives: &cachedirective.ResponseCacheDirectives{MaxAge: 300, Public: true}},
				{RespDirectives: &cachedirective.ResponseCacheDirectives{MaxAge: 600, Public: true}},
			},
			expectedHeader: "max-age=300, public",
		},
		{
			name: "no-cache with private",
			policies: []*cachedirective.Object{
				{RespDirectives: &cachedirective.ResponseCacheDirectives{NoCachePresent: true, PrivatePresent: true}},
			},
			expectedHeader: "no-cache, private",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			result, header := createMostRestrictivePolicy(tt.policies)
			assert.Equal(t, tt.expectedHeader, header)
			assert.NotNil(t, result)
		})
	}

	t.Run("expires header - earlier wins", func(t *testing.T) {
		t.Parallel()
		policies := []*cachedirective.Object{
			{
				RespDirectives:    &cachedirective.ResponseCacheDirectives{},
				RespExpiresHeader: time.Now().Add(10 * time.Minute),
			},
			{
				RespDirectives:    &cachedirective.ResponseCacheDirectives{},
				RespExpiresHeader: time.Now().Add(5 * time.Minute),
			},
		}
		result, header := createMostRestrictivePolicy(policies)
		assert.Equal(t, "", header)
		assert.NotNil(t, result)
		assert.False(t, result.RespExpiresHeader.IsZero())
		assert.True(t, result.RespExpiresHeader.Before(time.Now().Add(6*time.Minute)))
	})
}

func TestAddCacheControlPolicyToRules(t *testing.T) {
	t.Parallel()

	t.Run("nil rules and disabled cache returns nil", func(t *testing.T) {
		t.Parallel()
		result := AddCacheControlPolicyToRules(nil, config.CacheControlPolicy{
			Enabled: false,
		})
		assert.Nil(t, result)
	})

	t.Run("nil rules and enabled cache creates rules", func(t *testing.T) {
		t.Parallel()
		result := AddCacheControlPolicyToRules(nil, config.CacheControlPolicy{
			Enabled: true,
			Value:   "max-age=300",
		})
		require.NotNil(t, result)
		require.NotNil(t, result.All)
		require.Len(t, result.All.Response, 1)
		assert.Equal(t, config.ResponseHeaderRuleAlgorithmMostRestrictiveCacheControl, result.All.Response[0].Algorithm)
		assert.Equal(t, "max-age=300", result.All.Response[0].Default)
	})

	t.Run("existing rules with enabled cache appends", func(t *testing.T) {
		t.Parallel()
		existing := &config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Response: []*config.ResponseHeaderRule{
					{Operation: config.HeaderRuleOperationPropagate, Named: "X-Existing"},
				},
			},
		}
		result := AddCacheControlPolicyToRules(existing, config.CacheControlPolicy{
			Enabled: true,
			Value:   "max-age=300",
		})
		require.NotNil(t, result)
		require.Len(t, result.All.Response, 2)
		assert.Equal(t, "X-Existing", result.All.Response[0].Named)
		assert.Equal(t, config.ResponseHeaderRuleAlgorithmMostRestrictiveCacheControl, result.All.Response[1].Algorithm)
	})

	t.Run("subgraph-specific cache creates per-subgraph response rule", func(t *testing.T) {
		t.Parallel()
		result := AddCacheControlPolicyToRules(nil, config.CacheControlPolicy{
			Subgraphs: []config.SubgraphCacheControlRule{
				{Name: "sg1", Value: "max-age=60"},
			},
		})
		require.NotNil(t, result)
		require.Contains(t, result.Subgraphs, "sg1")
		require.Len(t, result.Subgraphs["sg1"].Response, 1)
		assert.Equal(t, "max-age=60", result.Subgraphs["sg1"].Response[0].Default)
	})

	t.Run("existing subgraph gets cache rule appended", func(t *testing.T) {
		t.Parallel()
		existing := &config.HeaderRules{
			All: &config.GlobalHeaderRule{},
			Subgraphs: map[string]*config.GlobalHeaderRule{
				"sg1": {
					Response: []*config.ResponseHeaderRule{
						{Operation: config.HeaderRuleOperationPropagate, Named: "X-Existing"},
					},
				},
			},
		}
		result := AddCacheControlPolicyToRules(existing, config.CacheControlPolicy{
			Subgraphs: []config.SubgraphCacheControlRule{
				{Name: "sg1", Value: "max-age=60"},
			},
		})
		require.NotNil(t, result)
		require.Len(t, result.Subgraphs["sg1"].Response, 2)
		assert.Equal(t, "X-Existing", result.Subgraphs["sg1"].Response[0].Named)
		assert.Equal(t, config.ResponseHeaderRuleAlgorithmMostRestrictiveCacheControl, result.Subgraphs["sg1"].Response[1].Algorithm)
	})
}

func TestApplyResponseRuleKeyValue(t *testing.T) {
	t.Parallel()

	newPropagation := func() *responseHeaderPropagation {
		return &responseHeaderPropagation{
			header: make(http.Header),
			m:      &sync.Mutex{},
		}
	}

	// We need a minimal HeaderPropagation to call the method
	hp := &HeaderPropagation{}

	t.Run("first write sets initial value", func(t *testing.T) {
		t.Parallel()
		prop := newPropagation()
		rule := &config.ResponseHeaderRule{Algorithm: config.ResponseHeaderRuleAlgorithmFirstWrite}
		hp.applyResponseRuleKeyValue(nil, prop, rule, "X-Test", []string{"first"})
		assert.Equal(t, []string{"first"}, prop.header.Values("X-Test"))
	})

	t.Run("first write ignores second value", func(t *testing.T) {
		t.Parallel()
		prop := newPropagation()
		rule := &config.ResponseHeaderRule{Algorithm: config.ResponseHeaderRuleAlgorithmFirstWrite}
		hp.applyResponseRuleKeyValue(nil, prop, rule, "X-Test", []string{"first"})
		hp.applyResponseRuleKeyValue(nil, prop, rule, "X-Test", []string{"second"})
		assert.Equal(t, []string{"first"}, prop.header.Values("X-Test"))
	})

	t.Run("last write overwrites", func(t *testing.T) {
		t.Parallel()
		prop := newPropagation()
		rule := &config.ResponseHeaderRule{Algorithm: config.ResponseHeaderRuleAlgorithmLastWrite}
		hp.applyResponseRuleKeyValue(nil, prop, rule, "X-Test", []string{"first"})
		hp.applyResponseRuleKeyValue(nil, prop, rule, "X-Test", []string{"second"})
		assert.Equal(t, []string{"second"}, prop.header.Values("X-Test"))
	})

	t.Run("append accumulates values", func(t *testing.T) {
		t.Parallel()
		prop := newPropagation()
		rule := &config.ResponseHeaderRule{Algorithm: config.ResponseHeaderRuleAlgorithmAppend}
		hp.applyResponseRuleKeyValue(nil, prop, rule, "X-Test", []string{"a"})
		hp.applyResponseRuleKeyValue(nil, prop, rule, "X-Test", []string{"b", "c"})
		assert.Equal(t, []string{"a,b,c"}, prop.header.Values("X-Test"))
	})

	t.Run("append to empty header", func(t *testing.T) {
		t.Parallel()
		prop := newPropagation()
		rule := &config.ResponseHeaderRule{Algorithm: config.ResponseHeaderRuleAlgorithmAppend}
		hp.applyResponseRuleKeyValue(nil, prop, rule, "X-Test", []string{"only"})
		assert.Equal(t, []string{"only"}, prop.header.Values("X-Test"))
	})

	t.Run("append with Set-Cookie preserves multiple header lines", func(t *testing.T) {
		t.Parallel()
		prop := newPropagation()
		rule := &config.ResponseHeaderRule{Algorithm: config.ResponseHeaderRuleAlgorithmAppend}
		hp.applyResponseRuleKeyValue(nil, prop, rule, "Set-Cookie", []string{"a=1; Path=/"})
		hp.applyResponseRuleKeyValue(nil, prop, rule, "Set-Cookie", []string{"b=2; Path=/"})
		// Set-Cookie must NOT be comma-joined (RFC 6265)
		assert.Equal(t, []string{"a=1; Path=/", "b=2; Path=/"}, prop.header.Values("Set-Cookie"))
	})
}

func TestPropagatedHeaders(t *testing.T) {
	t.Parallel()

	t.Run("set rule returns header name", func(t *testing.T) {
		t.Parallel()
		names, regexps, err := PropagatedHeaders([]*config.RequestHeaderRule{
			{Operation: config.HeaderRuleOperationSet, Name: "X-A", Value: "v"},
		})
		require.NoError(t, err)
		assert.Equal(t, []string{"X-A"}, names)
		assert.Nil(t, regexps)
	})

	t.Run("propagate named returns name", func(t *testing.T) {
		t.Parallel()
		names, regexps, err := PropagatedHeaders([]*config.RequestHeaderRule{
			{Operation: config.HeaderRuleOperationPropagate, Named: "X-B"},
		})
		require.NoError(t, err)
		assert.Equal(t, []string{"X-B"}, names)
		assert.Nil(t, regexps)
	})

	t.Run("propagate matching returns compiled regex", func(t *testing.T) {
		t.Parallel()
		names, regexps, err := PropagatedHeaders([]*config.RequestHeaderRule{
			{Operation: config.HeaderRuleOperationPropagate, Matching: "^X-.*"},
		})
		require.NoError(t, err)
		assert.Nil(t, names)
		require.Len(t, regexps, 1)
		assert.True(t, regexps[0].Pattern.MatchString("X-Custom"))
		assert.False(t, regexps[0].NegateMatch)
	})

	t.Run("propagate matching with negate", func(t *testing.T) {
		t.Parallel()
		_, regexps, err := PropagatedHeaders([]*config.RequestHeaderRule{
			{Operation: config.HeaderRuleOperationPropagate, Matching: "^X-.*", NegateMatch: true},
		})
		require.NoError(t, err)
		require.Len(t, regexps, 1)
		assert.True(t, regexps[0].NegateMatch)
	})

	t.Run("set with empty name errors", func(t *testing.T) {
		t.Parallel()
		_, _, err := PropagatedHeaders([]*config.RequestHeaderRule{
			{Operation: config.HeaderRuleOperationSet, Name: ""},
		})
		require.Error(t, err)
	})

	t.Run("propagate with no name or match errors", func(t *testing.T) {
		t.Parallel()
		_, _, err := PropagatedHeaders([]*config.RequestHeaderRule{
			{Operation: config.HeaderRuleOperationPropagate},
		})
		require.Error(t, err)
	})

	t.Run("invalid operation errors", func(t *testing.T) {
		t.Parallel()
		_, _, err := PropagatedHeaders([]*config.RequestHeaderRule{
			{Operation: "invalid"},
		})
		require.Error(t, err)
	})

	t.Run("invalid regex errors", func(t *testing.T) {
		t.Parallel()
		_, _, err := PropagatedHeaders([]*config.RequestHeaderRule{
			{Operation: config.HeaderRuleOperationPropagate, Matching: "[invalid"},
		})
		require.Error(t, err)
	})
}

func TestNewHeaderPropagation(t *testing.T) {
	t.Parallel()

	t.Run("nil rules returns nil", func(t *testing.T) {
		t.Parallel()
		hp, err := NewHeaderPropagation(nil)
		require.NoError(t, err)
		assert.Nil(t, hp)
	})

	t.Run("empty rules returns valid instance", func(t *testing.T) {
		t.Parallel()
		hp, err := NewHeaderPropagation(&config.HeaderRules{})
		require.NoError(t, err)
		require.NotNil(t, hp)
	})

	t.Run("invalid regex in request rule returns error", func(t *testing.T) {
		t.Parallel()
		_, err := NewHeaderPropagation(&config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{Operation: config.HeaderRuleOperationPropagate, Matching: "[invalid"},
				},
			},
		})
		require.Error(t, err)
	})

	t.Run("invalid regex in response rule returns error", func(t *testing.T) {
		t.Parallel()
		_, err := NewHeaderPropagation(&config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Response: []*config.ResponseHeaderRule{
					{Operation: config.HeaderRuleOperationPropagate, Matching: "[invalid"},
				},
			},
		})
		require.Error(t, err)
	})

	t.Run("HasRequestRules on nil receiver returns false", func(t *testing.T) {
		t.Parallel()
		var hp *HeaderPropagation
		assert.False(t, hp.HasRequestRules())
	})

	t.Run("HasResponseRules on nil receiver returns false", func(t *testing.T) {
		t.Parallel()
		var hp *HeaderPropagation
		assert.False(t, hp.HasResponseRules())
	})
}
