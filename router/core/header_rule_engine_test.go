package core

import (
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	cachedirective "github.com/pquerna/cachecontrol/cacheobject"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// writeHeaderSourceFile writes contents to a fresh temp file and returns its path.
// Used by FromFile header rule tests.
func writeHeaderSourceFile(t *testing.T, contents string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "header-source")
	require.NoError(t, os.WriteFile(path, []byte(contents), 0o600))
	return path
}

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

func TestCreateCacheControlPolicyHeaderRules(t *testing.T) {
	t.Parallel()

	t.Run("disabled cache returns nil", func(t *testing.T) {
		t.Parallel()
		result := CreateCacheControlPolicyHeaderRules(config.CacheControlPolicy{
			Enabled: false,
		})
		assert.Nil(t, result)
	})

	t.Run("enabled cache returns global after-rule", func(t *testing.T) {
		t.Parallel()
		result := CreateCacheControlPolicyHeaderRules(config.CacheControlPolicy{
			Enabled: true,
			Value:   "max-age=300",
		})
		require.NotNil(t, result)
		require.Len(t, result.All, 1)
		assert.Equal(t, config.ResponseHeaderRuleAlgorithmMostRestrictiveCacheControl, result.All[0].Algorithm)
		assert.Equal(t, "max-age=300", result.All[0].Default)
		assert.Nil(t, result.Subgraphs)
	})

	t.Run("subgraph-specific cache returns per-subgraph after-rule", func(t *testing.T) {
		t.Parallel()
		result := CreateCacheControlPolicyHeaderRules(config.CacheControlPolicy{
			Subgraphs: []config.SubgraphCacheControlRule{
				{Name: "sg1", Value: "max-age=60"},
			},
		})
		require.NotNil(t, result)
		assert.Nil(t, result.All)
		require.Contains(t, result.Subgraphs, "sg1")
		require.Len(t, result.Subgraphs["sg1"], 1)
		assert.Equal(t, "max-age=60", result.Subgraphs["sg1"][0].Default)
	})

	t.Run("global and subgraph rules coexist", func(t *testing.T) {
		t.Parallel()
		result := CreateCacheControlPolicyHeaderRules(config.CacheControlPolicy{
			Enabled: true,
			Value:   "max-age=300",
			Subgraphs: []config.SubgraphCacheControlRule{
				{Name: "sg1", Value: "max-age=60"},
			},
		})
		require.NotNil(t, result)
		require.Len(t, result.All, 1)
		assert.Equal(t, "max-age=300", result.All[0].Default)
		require.Contains(t, result.Subgraphs, "sg1")
		assert.Equal(t, "max-age=60", result.Subgraphs["sg1"][0].Default)
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

func TestApplyResponseRuleSetWritesToSubgraphResponse(t *testing.T) {
	t.Parallel()

	newPropagation := func() *responseHeaderPropagation {
		return &responseHeaderPropagation{
			header: make(http.Header),
			m:      &sync.Mutex{},
		}
	}

	hp := &HeaderPropagation{}

	t.Run("set writes to subgraph response header, not propagation header", func(t *testing.T) {
		t.Parallel()
		prop := newPropagation()
		res := &http.Response{Header: make(http.Header)}
		rule := &config.ResponseHeaderRule{
			Operation: config.HeaderRuleOperationSet,
			Name:      "X-Custom",
			Value:     "test-value",
		}
		hp.applyResponseRule(prop, res, rule)
		require.Equal(t, "", prop.header.Get("X-Custom"), "set should not write to propagation header")
		require.Equal(t, "test-value", res.Header.Get("X-Custom"), "set should write to subgraph response header")
	})

	t.Run("set Cache-Control writes to subgraph response header", func(t *testing.T) {
		t.Parallel()
		prop := newPropagation()
		res := &http.Response{Header: make(http.Header)}
		rule := &config.ResponseHeaderRule{
			Operation: config.HeaderRuleOperationSet,
			Name:      "Cache-Control",
			Value:     "max-age=300",
		}
		hp.applyResponseRule(prop, res, rule)
		require.Equal(t, "", prop.header.Get("Cache-Control"), "set should not write to propagation header")
		require.Equal(t, "max-age=300", res.Header.Get("Cache-Control"), "set should write to subgraph response header")
	})

	t.Run("propagate still writes to propagation header", func(t *testing.T) {
		t.Parallel()
		prop := newPropagation()
		rule := &config.ResponseHeaderRule{
			Operation: config.HeaderRuleOperationPropagate,
			Named:     "X-Custom",
			Algorithm: config.ResponseHeaderRuleAlgorithmFirstWrite,
		}
		res := &http.Response{
			Header: http.Header{"X-Custom": []string{"from-subgraph"}},
		}
		hp.applyResponseRule(prop, res, rule)
		require.Equal(t, "from-subgraph", prop.header.Get("X-Custom"))
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
	t.Run("set with FromFile returns header name", func(t *testing.T) {
		t.Parallel()
		path := writeHeaderSourceFile(t, "secret-value")
		names, regexps, err := PropagatedHeaders([]*config.RequestHeaderRule{
			{Operation: config.HeaderRuleOperationSet, Name: "X-Secret", FromFile: &config.FileHeaderSource{Path: path}},
		})
		require.NoError(t, err)
		assert.Equal(t, []string{"X-Secret"}, names)
		assert.Nil(t, regexps)
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
		hp, err := NewHeaderPropagation(t.Context(), zap.NewNop(), nil, nil)
		require.NoError(t, err)
		assert.Nil(t, hp)
	})

	t.Run("empty rules returns valid instance", func(t *testing.T) {
		t.Parallel()
		hp, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{}, nil)
		require.NoError(t, err)
		require.NotNil(t, hp)
	})

	t.Run("invalid regex in request rule returns error", func(t *testing.T) {
		t.Parallel()
		_, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{Operation: config.HeaderRuleOperationPropagate, Matching: "[invalid"},
				},
			},
		}, nil)
		require.Error(t, err)
	})

	t.Run("invalid regex in response rule returns error", func(t *testing.T) {
		t.Parallel()
		_, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Response: []*config.ResponseHeaderRule{
					{Operation: config.HeaderRuleOperationPropagate, Matching: "[invalid"},
				},
			},
		}, nil)
		require.Error(t, err)
	})

	t.Run("nil receiver returns false for Has*Rules", func(t *testing.T) {
		t.Parallel()
		var hp *HeaderPropagation
		assert.False(t, hp.HasRequestRules())
		assert.False(t, hp.HasResponseRules())
	})
}

func TestNewHeaderPropagation_FromFile(t *testing.T) {
	t.Parallel()

	t.Run("loads file contents into memory at startup", func(t *testing.T) {
		t.Parallel()

		path := writeHeaderSourceFile(t, "secret-token")

		hp, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{
						Operation: config.HeaderRuleOperationSet,
						Name:      "X-Auth",
						FromFile:  &config.FileHeaderSource{Path: path, RefreshInterval: time.Second},
					},
				},
			},
		}, nil)
		require.NoError(t, err)
		require.NotNil(t, hp)

		// The buffered content must be the file's exact bytes — no trimming, no decoding.
		content, ok := hp.fileSourceContents[path]
		require.True(t, ok, "expected file source content to be cached under the file path")
		assert.Equal(t, "secret-token", content.buffer.String())
	})

	t.Run("missing file returns error", func(t *testing.T) {
		t.Parallel()

		missing := filepath.Join(t.TempDir(), "does-not-exist")
		_, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{
						Operation: config.HeaderRuleOperationSet,
						Name:      "X-Auth",
						FromFile:  &config.FileHeaderSource{Path: missing, RefreshInterval: time.Second},
					},
				},
			},
		}, nil)
		require.Error(t, err)
		assert.ErrorContains(t, err, "does not exist")
	})

	t.Run("multiple rules referencing the same path share one in-memory copy", func(t *testing.T) {
		t.Parallel()

		path := writeHeaderSourceFile(t, "shared-value")

		hp, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{Operation: config.HeaderRuleOperationSet, Name: "X-A", FromFile: &config.FileHeaderSource{Path: path, RefreshInterval: time.Second}},
					{Operation: config.HeaderRuleOperationSet, Name: "X-B", FromFile: &config.FileHeaderSource{Path: path, RefreshInterval: time.Second}},
				},
			},
		}, nil)
		require.NoError(t, err)

		assert.Len(t, hp.fileSourceContents, 1, "expected the file to be loaded once and shared across rules")
	})

	t.Run("zero refresh_interval is defaulted to 30s", func(t *testing.T) {
		t.Parallel()

		path := writeHeaderSourceFile(t, "x")
		rule := &config.RequestHeaderRule{
			Operation: config.HeaderRuleOperationSet,
			Name:      "X-A",
			FromFile:  &config.FileHeaderSource{Path: path},
		}

		_, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
			All: &config.GlobalHeaderRule{Request: []*config.RequestHeaderRule{rule}},
		}, nil)
		require.NoError(t, err)
		assert.Equal(t, 30*time.Second, rule.FromFile.RefreshInterval, "engine must apply the 30s default for rules built outside YAML loading")
	})

	t.Run("subgraph-scoped FromFile rule is loaded", func(t *testing.T) {
		t.Parallel()

		path := writeHeaderSourceFile(t, "sg-secret")

		hp, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
			Subgraphs: map[string]*config.GlobalHeaderRule{
				"sg-1": {
					Request: []*config.RequestHeaderRule{
						{Operation: config.HeaderRuleOperationSet, Name: "X-Auth", FromFile: &config.FileHeaderSource{Path: path, RefreshInterval: time.Second}},
					},
				},
			},
		}, nil)
		require.NoError(t, err)

		content, ok := hp.fileSourceContents[path]
		require.True(t, ok)
		assert.Equal(t, "sg-secret", content.buffer.String())
	})

	t.Run("Set rule mixing Expression and FromFile skips file watcher but still compiles expression", func(t *testing.T) {
		t.Parallel()

		path := writeHeaderSourceFile(t, "file-value")
		expression := "request.header.Get('X-Origin')"

		hp, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{
						Operation:  config.HeaderRuleOperationSet,
						Name:       "X-Auth",
						Expression: expression,
						FromFile:   &config.FileHeaderSource{Path: path, RefreshInterval: time.Second},
					},
				},
			},
		}, nil)
		require.NoError(t, err)
		require.NotNil(t, hp)

		_, watcherCreated := hp.fileSourceContents[path]
		assert.False(t, watcherCreated, "mixed Expression+FromFile rule must not register a file source / watcher")
		assert.Empty(t, hp.fileSourceContents, "no file source content should be cached for mixed rules")

		_, compiled := hp.compiledRules[expression]
		assert.True(t, compiled, "expression compilation is independent of file source validation — the expression is still compiled and wins at apply time (see applyRequestRuleToHeader)")
	})

	t.Run("Propagate rule with FromFile skips file watcher", func(t *testing.T) {
		t.Parallel()

		path := writeHeaderSourceFile(t, "ignored")

		hp, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{
						Operation: config.HeaderRuleOperationPropagate,
						Named:     "X-Auth",
						FromFile:  &config.FileHeaderSource{Path: path, RefreshInterval: time.Second},
					},
				},
			},
		}, nil)
		require.NoError(t, err)
		require.NotNil(t, hp)

		assert.Empty(t, hp.fileSourceContents, "FromFile is only meaningful for set rules — propagate rules must not register a file source")
	})

	t.Run("missing file is not statted when rule is invalid", func(t *testing.T) {
		t.Parallel()

		// If validation didn't skip invalid rules, this would error because the file
		// doesn't exist. NewHeaderPropagation must succeed — proving the file is never
		// touched for mixed rules.
		missing := filepath.Join(t.TempDir(), "never-read")
		expression := "request.header.Get('X-Origin')"

		hp, err := NewHeaderPropagation(t.Context(), zap.NewNop(), &config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{
						Operation:  config.HeaderRuleOperationSet,
						Name:       "X-Auth",
						Expression: expression,
						FromFile:   &config.FileHeaderSource{Path: missing, RefreshInterval: time.Second},
					},
				},
			},
		}, nil)
		require.NoError(t, err, "validation must short-circuit before os.Stat for mixed rules")
		require.NotNil(t, hp)
		assert.Empty(t, hp.fileSourceContents)
	})
}
