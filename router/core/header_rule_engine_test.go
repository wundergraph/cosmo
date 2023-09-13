package core

import (
	"fmt"
	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/internal/config"
	"go.uber.org/zap"
	"net/http"
	"net/http/httptest"
	"testing"
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
	clientReq.Header.Set("X-Test-1", "test1")
	clientReq.Header.Set("X-Test-2", "test2")

	originReq, err := http.NewRequest("POST", "http://localhost", nil)
	assert.Nil(t, err)

	updatedClientReq, _ := ht.OnOriginRequest(originReq, &requestContext{
		logger:         zap.NewNop(),
		responseWriter: rr,
		request:        clientReq,
		operation:      &operationContext{},
	})

	assert.Equal(t, "test1", updatedClientReq.Header.Get("X-Test-1"))
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
	clientReq.Header.Set("X-Test-1", "test1")
	clientReq.Header.Set("X-Test-2", "test2")
	clientReq.Header.Set("Y-Test", "test3")

	originReq, err := http.NewRequest("POST", "http://localhost", nil)
	assert.Nil(t, err)

	updatedClientReq, _ := ht.OnOriginRequest(originReq, &requestContext{
		logger:         zap.NewNop(),
		responseWriter: rr,
		request:        clientReq,
		operation:      &operationContext{},
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

	originReq, err := http.NewRequest("POST", "http://localhost", nil)
	assert.Nil(t, err)

	updatedClientReq, _ := ht.OnOriginRequest(originReq, &requestContext{
		logger:         zap.NewNop(),
		responseWriter: rr,
		request:        clientReq,
		operation:      &operationContext{},
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
	clientReq.Header.Set("X-Test-1", "test1")

	for i, header := range hopHeaders {
		clientReq.Header.Set(header, fmt.Sprintf("test-%d", i))
	}

	originReq, err := http.NewRequest("POST", "http://localhost", nil)
	assert.Nil(t, err)

	updatedClientReq, _ := ht.OnOriginRequest(originReq, &requestContext{
		logger:         zap.NewNop(),
		responseWriter: rr,
		request:        clientReq,
		operation:      &operationContext{},
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
