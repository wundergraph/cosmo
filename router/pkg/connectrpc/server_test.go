package connectrpc

import (
	"net/http"
	"net/http/httptest"
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
	c := NewConnectRPC(TestSchema)
	err := c.Bootstrap()
	require.NoError(t, err)

	// Test the HTTP handler
	handler := c.Handler()
	require.NotNil(t, handler)

	// Create a test request
	body := strings.NewReader(`{"name": "John"}`)
	req := httptest.NewRequest(http.MethodPost, "/SayHello", body)
	req.Header.Add("Content-Type", "application/json")

	w := httptest.NewRecorder()

	// Call the handler
	handler.ServeHTTP(w, req)

	// The handler should respond (even if it's just a basic response)
	require.NotEqual(t, 0, w.Code)
	require.Equal(t, `{"message":"Hello, World!"}`, w.Body.String())
}
