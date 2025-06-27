package connectrpc

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

const TestSchema = `syntax = "proto3";

package foo.v1;

option go_package = "foov1";

service Greeter {
    rpc SayHello (HelloRequest) returns (HelloReply) {}
}

message HelloRequest {
    string name = 1;
}

message HelloReply {
    string message = 1;
}
`

func TestConnect(t *testing.T) {
	mapperData, err := os.Open("testdata/base.mapper.json")
	require.NoError(t, err)

	mapping, err := readMapping(mapperData)
	require.NoError(t, err)
	require.NotNil(t, mapping)

	schemaFh, err := os.Open("testdata/base.proto")
	require.NoError(t, err)
	schema, err := io.ReadAll(schemaFh)
	require.NoError(t, err)

	c := NewConnectRPC(string(schema), mapping)
	err = c.Bootstrap()
	require.NoError(t, err)

	// Test the HTTP handler
	handler := c.Handler()
	require.NotNil(t, handler)

	// Create a test request
	body := strings.NewReader(`{"id": "12"}`)
	req := httptest.NewRequest(http.MethodPost, "/QueryTestQueryUser", body)
	req.Header.Add("Content-Type", "application/json")

	w := httptest.NewRecorder()

	// Call the handler
	handler.ServeHTTP(w, req)

	// The handler should respond (even if it's just a basic response)
	require.NotEqual(t, 0, w.Code)
	require.JSONEq(t, `{"id":"1", "name":"John Doe", "details":{"age":30}}`, w.Body.String())
}
