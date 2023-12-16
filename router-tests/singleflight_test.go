package integration_test

import (
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/config"
	"github.com/wundergraph/cosmo/router/core"
	"go.uber.org/atomic"
)

type customTransport struct {
	delay        time.Duration
	requestCount atomic.Int64
	baseRT       http.RoundTripper
}

func (c *customTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	c.requestCount.Inc()
	if c.delay > 0 {
		time.Sleep(c.delay)
	}
	return c.baseRT.RoundTrip(r)
}

func TestSingleFlight(t *testing.T) {
	t.Parallel()
	var (
		numOfOperations = 10
		wg              sync.WaitGroup
	)
	transport := &customTransport{
		baseRT: http.DefaultTransport,
		delay:  time.Millisecond * 10,
	}
	server := setupServer(t, core.WithCustomRoundTripper(transport))
	wg.Add(numOfOperations)
	trigger := make(chan struct{})
	for i := 0; i < numOfOperations; i++ {
		go func() {
			defer wg.Done()
			<-trigger
			result := sendData(server, "/graphql", []byte(`{"query":"{ employees { id } }"}`))
			assert.Equal(t, http.StatusOK, result.Result().StatusCode)
			assert.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`, result.Body.String())
		}()
	}
	close(trigger)
	wg.Wait()
	// We expect that the number of requests is less than the number of operations
	assert.NotEqual(t, int64(numOfOperations), transport.requestCount.Load())
	t.Logf("Number of origin requests: %d", transport.requestCount.Load())
}

func TestSingleFlightMutations(t *testing.T) {
	t.Parallel()
	var (
		numOfOperations = 5
		wg              sync.WaitGroup
	)
	transport := &customTransport{
		baseRT: http.DefaultTransport,
		delay:  time.Millisecond * 10,
	}
	server := setupServer(t, core.WithCustomRoundTripper(transport))
	wg.Add(numOfOperations)
	trigger := make(chan struct{})
	for i := 0; i < numOfOperations; i++ {
		go func() {
			defer wg.Done()
			<-trigger
			result := sendData(server, "/graphql", []byte(`{"query":"mutation { updateEmployeeTag(id: 1, tag: \"test\") { id tag } }"}`))
			assert.Equal(t, http.StatusOK, result.Result().StatusCode)
			assert.Equal(t, `{"data":{"updateEmployeeTag":{"id":1,"tag":"test"}}}`, result.Body.String())
		}()
	}
	close(trigger)
	wg.Wait()
	// As this is a mutation, we expect that the number of requests is equal to the number of operations
	assert.Equal(t, int64(numOfOperations), transport.requestCount.Load())
}

func TestSingleFlightDifferentHeaders(t *testing.T) {
	t.Parallel()
	var (
		numOfOperations = 10
		wg              sync.WaitGroup
	)
	transport := &customTransport{
		baseRT: http.DefaultTransport,
		delay:  time.Millisecond * 10,
	}
	server := setupServer(t,
		core.WithCustomRoundTripper(transport),
		core.WithHeaderRules(config.HeaderRules{
			All: config.GlobalHeaderRule{
				Request: []config.RequestHeaderRule{
					{
						Named:     "Authorization",
						Operation: config.HeaderRuleOperationPropagate,
					},
				},
			},
		}),
	)
	wg.Add(numOfOperations)
	for i := 0; i < numOfOperations; i++ {
		go func(num int) {
			defer wg.Done()
			result := sendDataWithHeader(server, "/graphql", []byte(`{"query":"{ employees { id } }"}`), http.Header{
				"Authorization": []string{fmt.Sprintf("Bearer test-%d", num)},
			})
			assert.Equal(t, http.StatusOK, result.Result().StatusCode)
			assert.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`, result.Body.String())
		}(i)
	}
	wg.Wait()
	// As the Authorization header is propagated, and the value is different for each request,
	// we expect that the number of requests is equal to the number of operations
	assert.Equal(t, int64(numOfOperations), transport.requestCount.Load())
}

func TestSingleFlightSameHeaders(t *testing.T) {
	t.Parallel()
	var (
		numOfOperations = 10
		wg              sync.WaitGroup
	)
	transport := &customTransport{
		baseRT: http.DefaultTransport,
		delay:  time.Millisecond * 10,
	}
	server := setupServer(t,
		core.WithCustomRoundTripper(transport),
		core.WithHeaderRules(config.HeaderRules{
			All: config.GlobalHeaderRule{
				Request: []config.RequestHeaderRule{
					{
						Named:     "Authorization",
						Operation: config.HeaderRuleOperationPropagate,
					},
				},
			},
		}),
	)
	wg.Add(numOfOperations)
	trigger := make(chan struct{})
	for i := 0; i < numOfOperations; i++ {
		go func() {
			defer wg.Done()
			<-trigger
			result := sendDataWithHeader(server, "/graphql", []byte(`{"query":"{ employees { id } }"}`), http.Header{
				"Authorization": []string{"Bearer test"},
			})
			assert.Equal(t, http.StatusOK, result.Result().StatusCode)
			assert.Equal(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`, result.Body.String())
		}()
	}
	close(trigger)
	wg.Wait()
	// As the Authorization header is propagated, and the value is the same for each request,
	// we expect that the number of requests is less than the number of operations
	assert.NotEqual(t, int64(numOfOperations), transport.requestCount.Load())
	t.Logf("Number of origin requests: %d", transport.requestCount.Load())
}
