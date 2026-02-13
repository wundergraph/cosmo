package telemetry

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.17.0"
	"go.uber.org/zap/zapcore"
)

// TestAttributeProcessorIntegration tests that the attribute processor configurations
// are properly wired through the router. These tests verify:
// 1. The configuration is properly passed through testenv -> router -> trace provider
// 2. The router functions correctly with various attribute processor configurations
// 3. SanitizeUTF8 logs warnings when invalid UTF-8 is detected (when logging is enabled)
//
// The actual attribute processing logic (redaction, hashing, UTF-8 sanitization)
// is also tested in:
// - router/pkg/trace/attributeprocessor/*_test.go (unit tests)
// - router/pkg/trace/attributeprocessor_integration_test.go (integration tests)
func TestAttributeProcessorIntegration(t *testing.T) {
	t.Parallel()

	t.Run("Router works with IPAnonymization Redact enabled", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			IPAnonymization: &core.IPAnonymizationConfig{
				Enabled: true,
				Method:  core.Redact,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Contains(t, res.Body, `"employees"`)

			sn := exporter.GetSpans().Snapshots()
			require.NotEmpty(t, sn)
		})
	})

	t.Run("Router works with IPAnonymization Hash enabled", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			IPAnonymization: &core.IPAnonymizationConfig{
				Enabled: true,
				Method:  core.Hash,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Contains(t, res.Body, `"employees"`)

			sn := exporter.GetSpans().Snapshots()
			require.NotEmpty(t, sn)
		})
	})

	t.Run("Router works with IPAnonymization disabled", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			IPAnonymization: &core.IPAnonymizationConfig{
				Enabled: false,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Contains(t, res.Body, `"employees"`)

			sn := exporter.GetSpans().Snapshots()
			require.NotEmpty(t, sn)
		})
	})

	t.Run("Router works with SanitizeUTF8 enabled", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			TracingSanitizeUTF8: &config.SanitizeUTF8Config{
				Enabled:          true,
				LogSanitizations: false,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Contains(t, res.Body, `"employees"`)

			sn := exporter.GetSpans().Snapshots()
			require.NotEmpty(t, sn)
		})
	})

	t.Run("SanitizeUTF8 logs warning when invalid UTF-8 is detected", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		// Create a string with invalid UTF-8 bytes
		invalidUTF8Value := string([]byte{0x80, 0x81, 0x82})
		sanitizedValue := strings.ToValidUTF8(invalidUTF8Value, "\ufffd")
		attrKey := "custom.invalid_utf8_attr"

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			TracingSanitizeUTF8: &config.SanitizeUTF8Config{
				Enabled:          true,
				LogSanitizations: true,
			},
			// Add a custom tracing attribute with invalid UTF-8 as default value
			CustomTracingAttributes: []config.CustomAttribute{
				{
					Key:     attrKey,
					Default: invalidUTF8Value,
				},
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Contains(t, res.Body, `"employees"`)

			// Verify that spans were created
			sn := exporter.GetSpans().Snapshots()
			require.NotEmpty(t, sn)

			// Verify that the invalid UTF-8 attribute was sanitized (replaced with U+FFFD)
			sanitizedAttr := attribute.String(attrKey, sanitizedValue)
			require.Contains(t, sn[0].Attributes(), sanitizedAttr)

			// Verify that the warning log was emitted
			logEntries := xEnv.Observer().FilterMessageSnippet("Invalid UTF-8 in span attribute").All()
			require.GreaterOrEqual(t, len(logEntries), 1)

			// Verify the log contains the attribute key
			logEntry := logEntries[0]
			contextMap := logEntry.ContextMap()
			require.Equal(t, attrKey, contextMap["key"])
		})
	})

	t.Run("SanitizeUTF8 does not log when logging is disabled", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		// Create a string with invalid UTF-8 bytes
		invalidUTF8Value := string([]byte{0x80, 0x81, 0x82})
		sanitizedValue := strings.ToValidUTF8(invalidUTF8Value, "\ufffd")
		attrKey := "custom.invalid_utf8_attr_no_log"

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			TracingSanitizeUTF8: &config.SanitizeUTF8Config{
				Enabled:          true,
				LogSanitizations: false, // Logging disabled
			},
			CustomTracingAttributes: []config.CustomAttribute{
				{
					Key:     attrKey,
					Default: invalidUTF8Value,
				},
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Contains(t, res.Body, `"employees"`)

			// Verify that spans were created
			sn := exporter.GetSpans().Snapshots()
			require.NotEmpty(t, sn)

			// Verify that the invalid UTF-8 attribute was still sanitized
			sanitizedAttr := attribute.String(attrKey, sanitizedValue)
			require.Contains(t, sn[0].Attributes(), sanitizedAttr)

			// Verify that NO warning log was emitted for the sanitization
			logEntries := xEnv.Observer().FilterMessageSnippet("Invalid UTF-8 in span attribute").All()
			require.Empty(t, logEntries)
		})
	})

	t.Run("Router works with SanitizeUTF8 disabled", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			TracingSanitizeUTF8: &config.SanitizeUTF8Config{
				Enabled: false,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Contains(t, res.Body, `"employees"`)

			sn := exporter.GetSpans().Snapshots()
			require.NotEmpty(t, sn)
		})
	})

	t.Run("SanitizeUTF8 disabled leaves invalid UTF-8 unchanged", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		// Create a string with invalid UTF-8 bytes
		invalidUTF8Value := string([]byte{0x80, 0x81, 0x82})
		attrKey := "custom.invalid_utf8_unchanged"

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			TracingSanitizeUTF8: &config.SanitizeUTF8Config{
				Enabled: false, // Disabled
			},
			CustomTracingAttributes: []config.CustomAttribute{
				{
					Key:     attrKey,
					Default: invalidUTF8Value,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Contains(t, res.Body, `"employees"`)

			// Verify that spans were created
			sn := exporter.GetSpans().Snapshots()
			require.NotEmpty(t, sn)

			// Verify that the invalid UTF-8 attribute was NOT sanitized
			require.Contains(t, sn[0].Attributes(), attribute.String(attrKey, invalidUTF8Value))
		})
	})

	t.Run("Router works with both IPAnonymization and SanitizeUTF8 enabled", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			TracingSanitizeUTF8: &config.SanitizeUTF8Config{
				Enabled:          true,
				LogSanitizations: false,
			},
			IPAnonymization: &core.IPAnonymizationConfig{
				Enabled: true,
				Method:  core.Redact,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Contains(t, res.Body, `"employees"`)

			sn := exporter.GetSpans().Snapshots()
			require.NotEmpty(t, sn)
		})
	})

	t.Run("IPAnonymization redacts IP attributes", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			IPAnonymization: &core.IPAnonymizationConfig{
				Enabled: true,
				Method:  core.Redact,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Contains(t, res.Body, `"employees"`)

			sn := exporter.GetSpans().Snapshots()
			require.NotEmpty(t, sn)

			// Check that IP addresses are redacted (checks both http.client_ip and net.sock.peer.addr)
			redactedIPCount := 0
			for _, span := range sn {
				for _, attr := range span.Attributes() {
					if attr.Key == semconv.HTTPClientIPKey || attr.Key == semconv.NetSockPeerAddrKey {
						redactedIPCount++
						require.Equal(t, "[REDACTED]", attr.Value.AsString())
					}
				}
			}
			require.Positive(t, redactedIPCount)
		})
	})

	t.Run("IPAnonymization hashes IP attributes", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			IPAnonymization: &core.IPAnonymizationConfig{
				Enabled: true,
				Method:  core.Hash,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Contains(t, res.Body, `"employees"`)

			sn := exporter.GetSpans().Snapshots()
			require.NotEmpty(t, sn)

			// Check that IP addresses are hashed (64 char hex) in spans that have them
			hashedIPCount := 0
			for _, span := range sn {
				for _, attr := range span.Attributes() {
					if attr.Key == semconv.HTTPClientIPKey || attr.Key == semconv.NetSockPeerAddrKey {
						hashedIPCount++
						value := attr.Value.AsString()
						require.Len(t, value, 64)
						require.NotEqual(t, "[REDACTED]", value)
					}
				}
			}
			require.Positive(t, hashedIPCount)
		})
	})
}
