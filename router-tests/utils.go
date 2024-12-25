package integration

import (
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/sdk/trace"
	tracetest2 "go.opentelemetry.io/otel/sdk/trace/tracetest"
	"testing"
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
