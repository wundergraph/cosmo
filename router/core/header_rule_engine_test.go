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

func TestNamedPropagateHeaderRule(t *testing.T) {

	ht, err := NewHeaderTransformer(config.HeaderRules{
		All: config.GlobalHeaderRule{
			Request: []config.RequestHeaderRule{
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

	assert.Equal(t, "test1", updatedClientReq.Header.Get("X-Test-1"))
	assert.Empty(t, updatedClientReq.Header.Get("X-Test-2"))
}

func TestReNamedPropagateHeaderRule(t *testing.T) {

	ht, err := NewHeaderTransformer(config.HeaderRules{
		All: config.GlobalHeaderRule{
			Request: []config.RequestHeaderRule{
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

	assert.Equal(t, "test1", updatedClientReq.Header.Get("X-Test-Renamed"))
	assert.Empty(t, updatedClientReq.Header.Get("X-Test-1"))
	assert.Empty(t, updatedClientReq.Header.Get("X-Test-2"))
}

func TestReNamedMatchingPropagateHeaderRule(t *testing.T) {

	ht, err := NewHeaderTransformer(config.HeaderRules{
		All: config.GlobalHeaderRule{
			Request: []config.RequestHeaderRule{
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

	assert.Equal(t, "test1", updatedClientReq.Header.Get("X-Test-Renamed-1"))
	assert.Equal(t, "default", updatedClientReq.Header.Get("X-Test-Renamed-Default-2"))
	assert.Empty(t, updatedClientReq.Header.Get("X-Test-1"))
	assert.Empty(t, updatedClientReq.Header.Get("X-Test-2"))
}

func TestRegexPropagateHeaderRule(t *testing.T) {

	ht, err := NewHeaderTransformer(config.HeaderRules{
		All: config.GlobalHeaderRule{
			Request: []config.RequestHeaderRule{
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

	assert.Equal(t, "test1", updatedClientReq.Header.Get("X-Test-1"))
	assert.Equal(t, "test2", updatedClientReq.Header.Get("X-Test-2"))
	assert.Empty(t, updatedClientReq.Header.Get("Y-Test"))
}

func TestNamedPropagateDefaultValue(t *testing.T) {

	ht, err := NewHeaderTransformer(config.HeaderRules{
		All: config.GlobalHeaderRule{
			Request: []config.RequestHeaderRule{
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

	assert.Equal(t, "default", updatedClientReq.Header.Get("X-Test-1"))
}

func TestSkipHopHeadersRegex(t *testing.T) {

	ht, err := NewHeaderTransformer(config.HeaderRules{
		All: config.GlobalHeaderRule{
			Request: []config.RequestHeaderRule{
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

	for i, header := range hopHeaders {
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

	for _, header := range hopHeaders {
		assert.Empty(t, updatedClientReq.Header.Get(header), fmt.Sprintf("header %s should be empty", header))
	}

	assert.Equal(t, "test1", updatedClientReq.Header.Get("X-Test-1"))

}

func TestInvalidRegex(t *testing.T) {

	_, err := NewHeaderTransformer(config.HeaderRules{
		All: config.GlobalHeaderRule{
			Request: []config.RequestHeaderRule{
				{
					Operation: "propagate",
					Matching:  "[",
				},
			},
		},
	})
	assert.Error(t, err)
}

func TestSubgraphNamedHeaderRule(t *testing.T) {
	ht, err := NewHeaderTransformer(config.HeaderRules{
		Subgraphs: map[string]config.GlobalHeaderRule{
			"subgraph-1": {
				Request: []config.RequestHeaderRule{
					{
						Operation: "propagate",
						Named:     "X-Test-Subgraph-1",
						Default:   "Test-Value-1",
					},
				},
			},
			"subgraph-2": {
				Request: []config.RequestHeaderRule{
					{
						Operation: "propagate",
						Named:     "X-Test-Subgraph-2",
					},
				},
			},
		},
	})
	assert.Nil(t, err)

	rr := httptest.NewRecorder()

	clientReq, err := http.NewRequest("POST", "http://localhost", nil)
	require.NoError(t, err)
	clientReq.Header.Set("X-Test-Subgraph-2", "Test-Value-2")

	sg1Url, _ := url.Parse("http://subgraph-1.local")
	sg2Url, _ := url.Parse("http://subgraph-2.local")

	subgraphResolver := NewSubgraphResolver([]Subgraph{
		{
			Name:      "subgraph-1",
			Id:        "subgraph-1",
			Url:       sg1Url,
			UrlString: sg1Url.String(),
		},
		{
			Name:      "subgraph-2",
			Id:        "subgraph-2",
			Url:       sg2Url,
			UrlString: sg2Url.String(),
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

	assert.Equal(t, "Test-Value-1", updatedClientReq1.Header.Get("X-Test-Subgraph-1"))
	assert.Empty(t, updatedClientReq1.Header.Get("X-Test-Subgraph-2"))

	originReq2, err := http.NewRequest("POST", "http://subgraph-2.local", nil)
	assert.Nil(t, err)
	updatedClientReq2, _ := ht.OnOriginRequest(originReq2, ctx)

	assert.Empty(t, updatedClientReq2.Header.Get("X-Test-Subgraph-1"))
	assert.Equal(t, "Test-Value-2", updatedClientReq2.Header.Get("X-Test-Subgraph-2"))
}

func TestSubgraphRenameNamedHeaderRule(t *testing.T) {
	ht, err := NewHeaderTransformer(config.HeaderRules{
		Subgraphs: map[string]config.GlobalHeaderRule{
			"subgraph-1": {
				Request: []config.RequestHeaderRule{
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

}

func TestSubgraphRenameWithDefaultHeaderRule(t *testing.T) {
	ht, err := NewHeaderTransformer(config.HeaderRules{
		Subgraphs: map[string]config.GlobalHeaderRule{
			"subgraph-1": {
				Request: []config.RequestHeaderRule{
					{
						Operation: "propagate",
						Rename:    "X-Test-Subgraph-Renamed",
						Named:     "X-Test-Subgraph",
						Default:   "Test-Value-Default",
					},
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
	clientReq.Header.Set("X-Test-Subgraph", "Test-Value")
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

	assert.Equal(t, "Test-Value", updatedClientReq1.Header.Get("X-Test-Subgraph-Renamed"))
	assert.Equal(t, "Test-Value-Default-2", updatedClientReq1.Header.Get("X-Test-Subgraph-Renamed-2"))
	assert.Empty(t, updatedClientReq1.Header.Get("X-Test-Subgraph"))

}

func TestSubgraphRenameMatchedHeaderRule(t *testing.T) {
	ht, err := NewHeaderTransformer(config.HeaderRules{
		Subgraphs: map[string]config.GlobalHeaderRule{
			"subgraph-1": {
				Request: []config.RequestHeaderRule{
					{
						Operation: "propagate",
						Rename:    "X-Test-Subgraph-Renamed",
						Matching:  "(?i)X-Test-.*",
					},
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
	clientReq.Header.Set("X-Test-Subgraph", "Test-Value")
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

	assert.Equal(t, "Test-Value", updatedClientReq1.Header.Get("X-Test-Subgraph-Renamed"))
	assert.Equal(t, "Default", updatedClientReq1.Header.Get("X-Test-Subgraph-Default-Renamed"))
	assert.Empty(t, updatedClientReq1.Header.Get("X-Test-Subgraph"))
	assert.Empty(t, updatedClientReq1.Header.Get("X-Test-Default-Subgraph"))

}
