package integration

import (
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/jwks"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"go.opentelemetry.io/otel/sdk/trace"
	tracetest2 "go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap"
	"testing"
	"time"
)

const (
	jwksName = "my-jwks-server"
)

func RequireSpanWithName(t *testing.T, exporter *tracetest2.InMemoryExporter, name string) trace.ReadOnlySpan {
	require.NotNil(t, exporter)
	require.NotNil(t, exporter.GetSpans())
	require.NotNil(t, exporter.GetSpans().Snapshots())
	sn := exporter.GetSpans().Snapshots()
	var testSpan trace.ReadOnlySpan
	for _, span := range sn {
		if span.Name() == name {
			testSpan = span
			break
		}
	}
	require.NotNil(t, testSpan)
	return testSpan
}

func configureAuth(t *testing.T) ([]authentication.Authenticator, *jwks.Server) {
	authServer, err := jwks.NewServer(t)
	require.NoError(t, err)
	t.Cleanup(authServer.Close)
	tokenDecoder, _ := authentication.NewJwksTokenDecoder(zap.NewNop(), authServer.JWKSURL(), time.Second*5)
	authOptions := authentication.HttpHeaderAuthenticatorOptions{
		Name:         jwksName,
		URL:          authServer.JWKSURL(),
		TokenDecoder: tokenDecoder,
	}
	authenticator, err := authentication.NewHttpHeaderAuthenticator(authOptions)
	require.NoError(t, err)
	return []authentication.Authenticator{authenticator}, authServer
}
