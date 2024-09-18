package core

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
)

func TestPropagateHeaderRule(t *testing.T) {

	t.Run("Should propagate with named header name / named", func(t *testing.T) {

		ht, err := NewHeaderPropagation(&config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{
						Operation: "propagate",
						Named:     "X-Test-1",
					},
				},
			},
		})
		assert.Nil(t, err)

		rr := httptest.NewRecorder()

		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		clientReq.Header.Set("X-Test-1", "test1")
		clientReq.Header.Set("X-Test-2", "test2")

		originReq, err := http.NewRequest("POST", "http://localhost", nil)
		assert.Nil(t, err)

		updatedClientReq, _ := ht.OnOriginRequest(originReq, &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: NewSubgraphResolver(nil),
		})

		assert.Len(t, updatedClientReq.Header, 1)
		assert.Equal(t, "test1", updatedClientReq.Header.Get("X-Test-1"))
		assert.Empty(t, updatedClientReq.Header.Get("X-Test-2"))

	})

	t.Run("Should propagate based on matching regex / matching", func(t *testing.T) {
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{
						Operation: "propagate",
						Matching:  "(?i)X-Test-.*",
					},
				},
			},
		})
		assert.Nil(t, err)

		rr := httptest.NewRecorder()

		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		clientReq.Header.Set("X-Test-1", "test1")
		clientReq.Header.Set("X-Test-2", "test2")
		clientReq.Header.Set("Y-Test", "test3")

		originReq, err := http.NewRequest("POST", "http://localhost", nil)
		assert.Nil(t, err)

		updatedClientReq, _ := ht.OnOriginRequest(originReq, &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: NewSubgraphResolver(nil),
		})

		assert.Len(t, updatedClientReq.Header, 2)
		assert.Equal(t, "test1", updatedClientReq.Header.Get("X-Test-1"))
		assert.Equal(t, "test2", updatedClientReq.Header.Get("X-Test-2"))
		assert.Empty(t, updatedClientReq.Header.Get("Y-Test"))
	})

	t.Run("Should propagate with default value / named + default", func(t *testing.T) {
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{
						Operation: "propagate",
						Named:     "X-Test-1",
						Default:   "default",
					},
				},
			},
		})
		assert.Nil(t, err)

		rr := httptest.NewRecorder()

		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)

		originReq, err := http.NewRequest("POST", "http://localhost", nil)
		assert.Nil(t, err)

		updatedClientReq, _ := ht.OnOriginRequest(originReq, &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: NewSubgraphResolver(nil),
		})

		assert.Len(t, updatedClientReq.Header, 1)
		assert.Equal(t, "default", updatedClientReq.Header.Get("X-Test-1"))
	})

	t.Run("Should not propagate as disallowed headers / named", func(t *testing.T) {

		rules := []*config.RequestHeaderRule{
			{
				Operation: "propagate",
				Named:     "X-Test-1",
			},
		}

		for _, name := range ignoredHeaders {
			rules = append(rules, &config.RequestHeaderRule{
				Operation: "propagate",
				Named:     name,
			})
		}

		ht, err := NewHeaderPropagation(&config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: rules,
			},
		})
		assert.Nil(t, err)

		rr := httptest.NewRecorder()

		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		clientReq.Header.Set("X-Test-1", "test1")

		for i, name := range ignoredHeaders {
			clientReq.Header.Set(name, fmt.Sprintf("test-%d", i))
		}

		originReq, err := http.NewRequest("POST", "http://localhost", nil)
		assert.Nil(t, err)

		updatedClientReq, _ := ht.OnOriginRequest(originReq, &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: NewSubgraphResolver(nil),
		})

		assert.Len(t, updatedClientReq.Header, 1)
		assert.Equal(t, "test1", updatedClientReq.Header.Get("X-Test-1"))

	})
}

func TestRenamePropagateHeaderRule(t *testing.T) {

	t.Run("Rename header / named", func(t *testing.T) {

		ht, err := NewHeaderPropagation(&config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{
						Operation: "propagate",
						Named:     "X-Test-1",
						Rename:    "X-Test-Renamed",
					},
				},
			},
		})
		assert.Nil(t, err)

		rr := httptest.NewRecorder()

		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		clientReq.Header.Set("X-Test-1", "test1")
		clientReq.Header.Set("X-Test-2", "test2")

		originReq, err := http.NewRequest("POST", "http://localhost", nil)
		assert.Nil(t, err)

		updatedClientReq, _ := ht.OnOriginRequest(originReq, &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: NewSubgraphResolver(nil),
		})

		assert.Len(t, updatedClientReq.Header, 1)
		assert.Equal(t, "test1", updatedClientReq.Header.Get("X-Test-Renamed"))
		assert.Empty(t, updatedClientReq.Header.Get("X-Test-1"))
		assert.Empty(t, updatedClientReq.Header.Get("X-Test-2"))
	})

	t.Run("Rename based on matching regex pattern / matching", func(t *testing.T) {

		ht, err := NewHeaderPropagation(&config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{
						Operation: "propagate",
						Matching:  "(?i)X-Test-.*",
						Rename:    "X-Test-Renamed-1",
					},
					{
						Operation: "propagate",
						Matching:  "(?i)X-Test-Default-.*",
						Rename:    "X-Test-Renamed-Default-2",
						Default:   "default",
					},
				},
			},
		})
		assert.Nil(t, err)

		rr := httptest.NewRecorder()

		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		clientReq.Header.Set("X-Test-1", "test1")
		clientReq.Header.Set("X-Test-Default-2", "")

		originReq, err := http.NewRequest("POST", "http://localhost", nil)
		assert.Nil(t, err)

		updatedClientReq, _ := ht.OnOriginRequest(originReq, &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: NewSubgraphResolver(nil),
		})

		assert.Len(t, updatedClientReq.Header, 2)
		assert.Equal(t, "test1", updatedClientReq.Header.Get("X-Test-Renamed-1"))
		assert.Equal(t, "default", updatedClientReq.Header.Get("X-Test-Renamed-Default-2"))
		assert.Empty(t, updatedClientReq.Header.Get("X-Test-1"))
		assert.Empty(t, updatedClientReq.Header.Get("X-Test-2"))
	})

	t.Run("Should not rename to disallowed headers / named", func(t *testing.T) {

		rules := []*config.RequestHeaderRule{
			{
				Operation: "propagate",
				Named:     "X-Test-Old",
				Rename:    "X-Test-Renamed",
			},
		}

		for _, name := range ignoredHeaders {
			rules = append(rules, &config.RequestHeaderRule{
				Operation: "propagate",
				Named:     fmt.Sprintf("X-Test-%s", name),
				Rename:    name,
			})
		}

		ht, err := NewHeaderPropagation(&config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: rules,
			},
		})
		assert.Nil(t, err)

		rr := httptest.NewRecorder()

		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		clientReq.Header.Set("X-Test-Old", "test1")

		for i, name := range ignoredHeaders {
			clientReq.Header.Set(fmt.Sprintf("X-Test-%s", name), fmt.Sprintf("X-Test-%d", i))
		}

		originReq, err := http.NewRequest("POST", "http://localhost", nil)
		assert.Nil(t, err)

		updatedClientReq, _ := ht.OnOriginRequest(originReq, &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: NewSubgraphResolver(nil),
		})

		assert.Len(t, updatedClientReq.Header, 1)
		assert.Equal(t, "test1", updatedClientReq.Header.Get("X-Test-Renamed"))
	})
}

func TestSkipAllIgnoredHeaders(t *testing.T) {

	ht, err := NewHeaderPropagation(&config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{
					Operation: "propagate",
					Matching:  "(?i).*",
				},
			},
		},
	})
	assert.Nil(t, err)

	rr := httptest.NewRecorder()

	clientReq, err := http.NewRequest("POST", "http://localhost", nil)
	require.NoError(t, err)
	clientReq.Header.Set("X-Test-1", "test1")

	for i, header := range ignoredHeaders {
		clientReq.Header.Set(header, fmt.Sprintf("test-%d", i))
	}

	originReq, err := http.NewRequest("POST", "http://localhost", nil)
	assert.Nil(t, err)

	updatedClientReq, _ := ht.OnOriginRequest(originReq, &requestContext{
		logger:           zap.NewNop(),
		responseWriter:   rr,
		request:          clientReq,
		operation:        &operationContext{},
		subgraphResolver: NewSubgraphResolver(nil),
	})

	for _, header := range ignoredHeaders {
		assert.Empty(t, updatedClientReq.Header.Get(header), fmt.Sprintf("header %s should be empty", header))
	}

	assert.Equal(t, "test1", updatedClientReq.Header.Get("X-Test-1"))

}

func TestSubgraphPropagateHeaderRule(t *testing.T) {

	t.Run("Should propagate set header / named", func(t *testing.T) {

		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Subgraphs: map[string]*config.GlobalHeaderRule{
				"subgraph-1": {
					Request: []*config.RequestHeaderRule{
						{
							Operation: "propagate",
							Named:     "X-Test-Subgraph",
						},
					},
				},
			},
		})
		assert.Nil(t, err)

		rr := httptest.NewRecorder()

		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		clientReq.Header.Set("X-Test-Subgraph", "Test-Value")

		sg1Url, _ := url.Parse("http://subgraph-1.local")

		subgraphResolver := NewSubgraphResolver([]Subgraph{
			{
				Name:      "subgraph-1",
				Id:        "subgraph-1",
				Url:       sg1Url,
				UrlString: sg1Url.String(),
			},
		})

		ctx := &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: subgraphResolver,
		}

		originReq1, err := http.NewRequest("POST", "http://subgraph-1.local", nil)
		assert.Nil(t, err)
		updatedClientReq1, _ := ht.OnOriginRequest(originReq1, ctx)

		assert.Len(t, updatedClientReq1.Header, 1)
		assert.Equal(t, "Test-Value", updatedClientReq1.Header.Get("X-Test-Subgraph"))
		assert.Empty(t, updatedClientReq1.Header.Get("Test-Value"))
	})

	t.Run("Should propagate set header / matching", func(t *testing.T) {
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Subgraphs: map[string]*config.GlobalHeaderRule{
				"subgraph-1": {
					Request: []*config.RequestHeaderRule{
						{
							Operation: "propagate",
							Matching:  "(?i)X-Test-.*",
						},
					},
				},
			},
		})
		assert.Nil(t, err)

		rr := httptest.NewRecorder()

		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		clientReq.Header.Set("X-Test-Subgraph", "Test-Value")

		sg1Url, _ := url.Parse("http://subgraph-1.local")

		subgraphResolver := NewSubgraphResolver([]Subgraph{
			{
				Name:      "subgraph-1",
				Id:        "subgraph-1",
				Url:       sg1Url,
				UrlString: sg1Url.String(),
			},
		})

		ctx := &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: subgraphResolver,
		}

		originReq1, err := http.NewRequest("POST", "http://subgraph-1.local", nil)
		assert.Nil(t, err)
		updatedClientReq1, _ := ht.OnOriginRequest(originReq1, ctx)

		assert.Equal(t, "Test-Value", updatedClientReq1.Header.Get("X-Test-Subgraph"))
		assert.Empty(t, updatedClientReq1.Header.Get("Test-Value"))
	})

	t.Run("Should not propagate disallowed header / named", func(t *testing.T) {
		rules := []*config.RequestHeaderRule{
			{
				Operation: "propagate",
				Named:     "X-Test-Subgraph",
			},
		}

		for _, name := range ignoredHeaders {
			rules = append(rules, &config.RequestHeaderRule{
				Operation: "propagate",
				Named:     name,
			})
		}

		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Subgraphs: map[string]*config.GlobalHeaderRule{
				"subgraph-1": {
					Request: rules,
				},
			},
		})
		assert.Nil(t, err)

		rr := httptest.NewRecorder()

		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		clientReq.Header.Set("X-Test-Subgraph", "Test-Value")

		for i, name := range ignoredHeaders {
			clientReq.Header.Set(name, fmt.Sprintf("X-Test-%d", i))
		}

		sg1Url, _ := url.Parse("http://subgraph-1.local")

		subgraphResolver := NewSubgraphResolver([]Subgraph{
			{
				Name:      "subgraph-1",
				Id:        "subgraph-1",
				Url:       sg1Url,
				UrlString: sg1Url.String(),
			},
		})

		ctx := &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: subgraphResolver,
		}

		originReq1, err := http.NewRequest("POST", "http://subgraph-1.local", nil)
		assert.Nil(t, err)
		updatedClientReq1, _ := ht.OnOriginRequest(originReq1, ctx)

		assert.Len(t, updatedClientReq1.Header, 1)
		assert.Equal(t, "Test-Value", updatedClientReq1.Header.Get("X-Test-Subgraph"))
		assert.Empty(t, updatedClientReq1.Header.Get("Test-Value"))
	})

	t.Run("Should not propagate disallowed headers / matching", func(t *testing.T) {

		rules := []*config.RequestHeaderRule{
			{
				Operation: "propagate",
				Matching:  ".*",
			},
		}

		for _, name := range ignoredHeaders {
			rules = append(rules, &config.RequestHeaderRule{
				Operation: "propagate",
				Named:     fmt.Sprintf("X-Test-%s", name),
				Rename:    name,
			})
		}

		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Subgraphs: map[string]*config.GlobalHeaderRule{
				"subgraph-1": {
					Request: rules,
				},
			},
		})
		assert.Nil(t, err)

		rr := httptest.NewRecorder()

		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		clientReq.Header.Set("X-Test-Subgraph", "Test-Value")

		for i, name := range ignoredHeaders {
			clientReq.Header.Set(name, fmt.Sprintf("X-Test-%d", i))
		}

		sg1Url, _ := url.Parse("http://subgraph-1.local")

		subgraphResolver := NewSubgraphResolver([]Subgraph{
			{
				Name:      "subgraph-1",
				Id:        "subgraph-1",
				Url:       sg1Url,
				UrlString: sg1Url.String(),
			},
		})

		ctx := &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: subgraphResolver,
		}

		originReq1, err := http.NewRequest("POST", "http://subgraph-1.local", nil)
		assert.Nil(t, err)
		updatedClientReq1, _ := ht.OnOriginRequest(originReq1, ctx)

		assert.Len(t, updatedClientReq1.Header, 1)
		assert.Equal(t, "Test-Value", updatedClientReq1.Header.Get("X-Test-Subgraph"))
		assert.Empty(t, updatedClientReq1.Header.Get("Test-Value"))
	})

}

func TestSubgraphRenamePropagateHeaderRule(t *testing.T) {

	t.Run("Should rename header / named", func(t *testing.T) {
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Subgraphs: map[string]*config.GlobalHeaderRule{
				"subgraph-1": {
					Request: []*config.RequestHeaderRule{
						{
							Operation: "propagate",
							Named:     "X-Test-Subgraph",
							Rename:    "X-Test-Subgraph-Renamed",
						},
					},
				},
			},
		})
		assert.Nil(t, err)

		rr := httptest.NewRecorder()

		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		clientReq.Header.Set("X-Test-Subgraph", "Test-Value")

		sg1Url, _ := url.Parse("http://subgraph-1.local")

		subgraphResolver := NewSubgraphResolver([]Subgraph{
			{
				Name:      "subgraph-1",
				Id:        "subgraph-1",
				Url:       sg1Url,
				UrlString: sg1Url.String(),
			},
		})

		ctx := &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: subgraphResolver,
		}

		originReq1, err := http.NewRequest("POST", "http://subgraph-1.local", nil)
		assert.Nil(t, err)
		updatedClientReq1, _ := ht.OnOriginRequest(originReq1, ctx)

		assert.Equal(t, "Test-Value", updatedClientReq1.Header.Get("X-Test-Subgraph-Renamed"))
		assert.Empty(t, updatedClientReq1.Header.Get("X-Test-Subgraph"))
	})

	t.Run("Should fallback to default value when header value is not set / named", func(t *testing.T) {
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Subgraphs: map[string]*config.GlobalHeaderRule{
				"subgraph-1": {
					Request: []*config.RequestHeaderRule{
						{
							Operation: "propagate",
							Rename:    "X-Test-Subgraph-Renamed-2",
							Named:     "X-Test-Subgraph-2",
							Default:   "Test-Value-Default-2",
						},
					},
				},
			},
		})
		assert.Nil(t, err)

		rr := httptest.NewRecorder()

		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		clientReq.Header.Set("X-Test-Subgraph-2", "")

		sg1Url, _ := url.Parse("http://subgraph-1.local")

		subgraphResolver := NewSubgraphResolver([]Subgraph{
			{
				Name:      "subgraph-1",
				Id:        "subgraph-1",
				Url:       sg1Url,
				UrlString: sg1Url.String(),
			},
		})

		ctx := &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: subgraphResolver,
		}

		originReq1, err := http.NewRequest("POST", "http://subgraph-1.local", nil)
		assert.Nil(t, err)
		updatedClientReq1, _ := ht.OnOriginRequest(originReq1, ctx)

		assert.Equal(t, "Test-Value-Default-2", updatedClientReq1.Header.Get("X-Test-Subgraph-Renamed-2"))
		assert.Empty(t, updatedClientReq1.Header.Get("X-Test-Subgraph"))
	})

	t.Run("Should rename header and don't fallback to default value when header is set / named", func(t *testing.T) {
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Subgraphs: map[string]*config.GlobalHeaderRule{
				"subgraph-1": {
					Request: []*config.RequestHeaderRule{
						{
							Operation: "propagate",
							Rename:    "X-Test-Subgraph-Renamed",
							Named:     "X-Test-Subgraph",
							Default:   "Test-Value-Default",
						},
					},
				},
			},
		})
		assert.Nil(t, err)

		rr := httptest.NewRecorder()

		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		clientReq.Header.Set("X-Test-Subgraph", "Test-Value")

		sg1Url, _ := url.Parse("http://subgraph-1.local")

		subgraphResolver := NewSubgraphResolver([]Subgraph{
			{
				Name:      "subgraph-1",
				Id:        "subgraph-1",
				Url:       sg1Url,
				UrlString: sg1Url.String(),
			},
		})

		ctx := &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: subgraphResolver,
		}

		originReq1, err := http.NewRequest("POST", "http://subgraph-1.local", nil)
		assert.Nil(t, err)
		updatedClientReq1, _ := ht.OnOriginRequest(originReq1, ctx)

		assert.Equal(t, "Test-Value", updatedClientReq1.Header.Get("X-Test-Subgraph-Renamed"))
		assert.Empty(t, updatedClientReq1.Header.Get("X-Test-Subgraph"))
	})

	t.Run("Should rename headers based / matching rule", func(t *testing.T) {
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Subgraphs: map[string]*config.GlobalHeaderRule{
				"subgraph-1": {
					Request: []*config.RequestHeaderRule{
						{
							Operation: "propagate",
							Rename:    "X-Test-Subgraph-Renamed",
							Matching:  "(?i)X-Test-.*",
						},
					},
				},
			},
		})
		assert.Nil(t, err)

		rr := httptest.NewRecorder()

		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		clientReq.Header.Set("X-Test-Subgraph", "Test-Value")

		sg1Url, _ := url.Parse("http://subgraph-1.local")

		subgraphResolver := NewSubgraphResolver([]Subgraph{
			{
				Name:      "subgraph-1",
				Id:        "subgraph-1",
				Url:       sg1Url,
				UrlString: sg1Url.String(),
			},
		})

		ctx := &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: subgraphResolver,
		}

		originReq1, err := http.NewRequest("POST", "http://subgraph-1.local", nil)
		assert.Nil(t, err)
		updatedClientReq1, _ := ht.OnOriginRequest(originReq1, ctx)

		assert.Equal(t, "Test-Value", updatedClientReq1.Header.Get("X-Test-Subgraph-Renamed"))
		assert.Empty(t, updatedClientReq1.Header.Get("X-Test-Subgraph"))
	})

	t.Run("Should rename headers and fallback to default value when header value is not set / matching rule", func(t *testing.T) {
		ht, err := NewHeaderPropagation(&config.HeaderRules{
			Subgraphs: map[string]*config.GlobalHeaderRule{
				"subgraph-1": {
					Request: []*config.RequestHeaderRule{
						{
							Operation: "propagate",
							Rename:    "X-Test-Subgraph-Default-Renamed",
							Matching:  "(?i)X-Test-Default.*",
							Default:   "Default",
						},
					},
				},
			},
		})
		assert.Nil(t, err)

		rr := httptest.NewRecorder()

		clientReq, err := http.NewRequest("POST", "http://localhost", nil)
		require.NoError(t, err)
		clientReq.Header.Set("X-Test-Default-Subgraph", "")

		sg1Url, _ := url.Parse("http://subgraph-1.local")

		subgraphResolver := NewSubgraphResolver([]Subgraph{
			{
				Name:      "subgraph-1",
				Id:        "subgraph-1",
				Url:       sg1Url,
				UrlString: sg1Url.String(),
			},
		})

		ctx := &requestContext{
			logger:           zap.NewNop(),
			responseWriter:   rr,
			request:          clientReq,
			operation:        &operationContext{},
			subgraphResolver: subgraphResolver,
		}

		originReq1, err := http.NewRequest("POST", "http://subgraph-1.local", nil)
		assert.Nil(t, err)
		updatedClientReq1, _ := ht.OnOriginRequest(originReq1, ctx)

		assert.Equal(t, "Default", updatedClientReq1.Header.Get("X-Test-Subgraph-Default-Renamed"))
		assert.Empty(t, updatedClientReq1.Header.Get("X-Test-Default-Subgraph"))
	})
}

func TestInvalidRegex(t *testing.T) {

	_, err := NewHeaderPropagation(&config.HeaderRules{
		All: &config.GlobalHeaderRule{
			Request: []*config.RequestHeaderRule{
				{
					Operation: "propagate",
					Matching:  "[",
				},
			},
		},
	})
	assert.Error(t, err)
}
