package internal

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/akrylysov/algnhsa"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/aws/aws-lambda-go/events"
)

func TestHandler(t *testing.T) {
	logger, err := zap.NewProduction()
	require.NoError(t, err)

	r := NewRouter(
		WithLogger(logger),
		WithRouterConfigPath("../router.json"),
		WithConfigPath("../config.yaml"),
	)
	require.NoError(t, err)

	svr, err := r.NewServer(context.Background())
	require.NoError(t, err)

	handler := algnhsa.New(svr.HttpServer().Handler, &algnhsa.Options{
		RequestType: algnhsa.RequestTypeAPIGatewayV2,
	})
	j, err := json.Marshal(events.APIGatewayV2HTTPRequest{
		Version: "2.0",
		RawPath: "/health",
	})
	require.NoError(t, err)
	response, err := handler.Invoke(context.Background(), j)
	require.NoError(t, err)
	require.NotEmpty(t, response)
}
