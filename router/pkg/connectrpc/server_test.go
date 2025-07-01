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

	c := NewConnectRPC("", []ConnectRPCData{
		{
			Schema:  string(schema),
			Mapping: mapping,
		},
	})
	err = c.Bootstrap()
	require.NoError(t, err)

	// Create a test request
	body := strings.NewReader(`{"id": "1"}`)
	req := httptest.NewRequest(http.MethodPost, "/service.v1.DefaultService/QueryTestQueryUser", body)
	req.Header.Add("Content-Type", "application/json")

	w := httptest.NewRecorder()

	// Call the handler
	found := c.HandlerFunc(w, req)
	require.True(t, found)

	// The handler should respond (even if it's just a basic response)
	require.NotEqual(t, 0, w.Code)
	require.JSONEq(t, `{"id":"1", "name":"John Doe", "details":{"age":30}}`, w.Body.String())
}
