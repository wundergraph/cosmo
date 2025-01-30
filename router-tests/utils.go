package integration

import (
	"context"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/jwks"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/trace"
	tracetest2 "go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap"
	"testing"
	"time"
)

const (
	jwksName = "my-jwks-server"
)

// NewContextWithCancel creates a new context with a cancel function that is called when the test is done.
func NewContextWithCancel(t *testing.T) context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	return ctx
}

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
	tokenDecoder, _ := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{
		{
			URL:             authServer.JWKSURL(),
			RefreshInterval: time.Second * 5,
		},
	})

	authOptions := authentication.HttpHeaderAuthenticatorOptions{
		Name:         jwksName,
		TokenDecoder: tokenDecoder,
	}
	authenticator, err := authentication.NewHttpHeaderAuthenticator(authOptions)
	require.NoError(t, err)
	return []authentication.Authenticator{authenticator}, authServer
}

func AssertAttributeNotInSet(t *testing.T, set attribute.Set, attr attribute.KeyValue) {
	t.Helper()

	_, ok := set.Value(attr.Key)
	require.False(t, ok)
}

func GetMetricByName(scopeMetric *metricdata.ScopeMetrics, name string) *metricdata.Metrics {
	for _, m := range scopeMetric.Metrics {
		if m.Name == name {
			return &m
		}
	}
	return nil
}

func GetMetricScopeByName(metrics []metricdata.ScopeMetrics, name string) *metricdata.ScopeMetrics {
	for _, m := range metrics {
		if m.Scope.Name == name {
			return &m
		}
	}
	return nil
}
