package integration_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/tidwall/sjson"
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
	result := sendData(server, persistedOperationPayload("does-not-exist"))
	assert.Equal(t, http.StatusOK, result.Code)
	assert.JSONEq(t, `{"errors": [{ "message": "PersistedQueryNotFound" }]}`, result.Body.String())
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
	res := sendDataWithHeader(server, payload, header)
	assert.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`, res.Body.String())
}
