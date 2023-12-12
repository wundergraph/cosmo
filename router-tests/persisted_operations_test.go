package integration_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/sjson"
	"github.com/wundergraph/cosmo/router/config"
	"github.com/wundergraph/cosmo/router/core"
)

func persistedOperationPayload(sha56Hash string) []byte {
	return []byte(fmt.Sprintf(`{
		"extensions": {
			"persistedQuery": {
				"version":1,
				"sha256Hash": "%s"
			}
		}
	}`, sha56Hash))
}

func TestPersistedOperationNotFound(t *testing.T) {
	server := setupServer(t)
	result := sendData(server, "/graphql", persistedOperationPayload("does-not-exist"))
	assert.Equal(t, http.StatusBadRequest, result.Code)
	assert.JSONEq(t, `{"data": null, "errors": [{ "message": "PersistedQueryNotFound" }]}`, result.Body.String())
}

func TestPersistedOperation(t *testing.T) {
	const (
		operationID   = "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"
		operationName = "Employees"
	)
	server := setupServer(t)
	header := make(http.Header)
	header.Add("graphql-client-name", "my-client")
	payload := persistedOperationPayload(operationID)
	payload, _ = sjson.SetBytes(payload, "operationName", operationName)
	res := sendDataWithHeader(server, "/graphql", payload, header)
	assert.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`, res.Body.String())
}

func TestPersistedOperationsCache(t *testing.T) {
	// Requesting the same persisted operation twice should only make one request to the CDN
	const (
		operationID   = "dc67510fb4289672bea757e862d6b00e83db5d3cbbcfb15260601b6f29bb2b8f"
		operationName = "Employees"
	)

	sendTwoRequests := func(t *testing.T, server *core.Server) {
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		payload := persistedOperationPayload(operationID)
		payload, _ = sjson.SetBytes(payload, "operationName", operationName)
		res1 := sendDataWithHeader(server, "/graphql", payload, header)
		assert.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`, res1.Body.String())
		res2 := sendDataWithHeader(server, "/graphql", payload, header)
		assert.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`, res2.Body.String())
	}

	retrieveNumberOfCDNRequests := func(t *testing.T, cdnURL string) int {
		requestLogResp, err := http.Get(cdnURL)
		require.NoError(t, err)
		defer requestLogResp.Body.Close()
		var requestLog []string
		if err := json.NewDecoder(requestLogResp.Body).Decode(&requestLog); err != nil {
			t.Fatal(err)
		}
		return len(requestLog)
	}

	t.Run("with cache", func(t *testing.T) {
		server, cfg := setupServerConfig(t)
		sendTwoRequests(t, server)
		numberOfCDNRequests := retrieveNumberOfCDNRequests(t, cfg.CDN.URL)
		assert.Equal(t, 1, numberOfCDNRequests)
	})

	t.Run("without cache", func(t *testing.T) {
		cdnURL := setupCDNServer(t)
		server, _ := setupServerConfig(t, core.WithCDN(config.CDNConfiguration{
			URL:       cdnURL,
			CacheSize: 0,
		}))
		sendTwoRequests(t, server)
		numberOfCDNRequests := retrieveNumberOfCDNRequests(t, cdnURL)
		assert.Equal(t, 2, numberOfCDNRequests)
	})
}
