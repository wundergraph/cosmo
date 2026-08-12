package prompttoquery

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1/nodev1connect"
	brotli "go.withmatt.com/connect-brotli"
)

type testNodeServiceHandler struct {
	generateQueryRequest *nodev1.GenerateQueryRequest
	authorizationHeader  string
}

func (h *testNodeServiceHandler) SelfRegister(context.Context, *connect.Request[nodev1.SelfRegisterRequest]) (*connect.Response[nodev1.SelfRegisterResponse], error) {
	return connect.NewResponse(&nodev1.SelfRegisterResponse{}), nil
}

func (h *testNodeServiceHandler) GenerateQuery(_ context.Context, req *connect.Request[nodev1.GenerateQueryRequest]) (*connect.Response[nodev1.GenerateQueryResponse], error) {
	h.generateQueryRequest = req.Msg
	h.authorizationHeader = req.Header().Get("Authorization")

	return connect.NewResponse(&nodev1.GenerateQueryResponse{
		Response: &nodev1.Response{},
		Query: &nodev1.SatisfiedQuery{
			Document:      "query GetEmployees { employees { id } }",
			OperationName: "GetEmployees",
		},
	}), nil
}

func TestClientGenerateQuery(t *testing.T) {
	handler := &testNodeServiceHandler{}
	path, nodeHandler := nodev1connect.NewNodeServiceHandler(handler, brotli.WithCompression())
	mux := http.NewServeMux()
	mux.Handle(path, nodeHandler)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	client, err := New(server.URL, "graph-token")
	require.NoError(t, err)

	resp, err := client.GenerateQuery(t.Context(), "sha256:abcdef", "List all employees")

	require.NoError(t, err)
	require.Equal(t, "Bearer graph-token", handler.authorizationHeader)
	require.Equal(t, "sha256:abcdef", handler.generateQueryRequest.GetSchemaHash())
	require.Equal(t, "List all employees", handler.generateQueryRequest.GetPrompt())
	require.Equal(t, "GetEmployees", resp.GetQuery().GetOperationName())
}
