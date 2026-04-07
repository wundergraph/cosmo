package integration

import (
	"regexp"
	"testing"
	"time"

	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"

	"github.com/prometheus/client_golang/prometheus"
	io_prometheus_client "github.com/prometheus/client_model/go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric"
)

// This file exists to be smaller than prometheus_test.go, and use better testing practices.
// Editors like Cursor, VSCode Copilot Agent, Zed, etc have a lot of trouble with the other file due
// to its size and testing methodology. In the new file, you should use new helpers where possible, and avoid
// asserting the values of unrelated metrics/labels.

func TestPrometheusSchemaUsage(t *testing.T) {
	var SchemaFieldUsageMetricName = "router_graphql_schema_field_usage_total"

	t.Run("operation attributes are correctly added when enabled", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			MetricOptions: testenv.MetricOptions{
				PrometheusSchemaFieldUsage: testenv.PrometheusSchemaFieldUsage{
					Enabled: true,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `
query myQuery {
	employee(id: 1) {
		id
		currentMood

		role {
			departments

			... on Engineer {
				title
			}

			... on Operator {
				title
			}
		}
	}
}`,
			})
			require.JSONEq(t, `{
				"data": {
					"employee": {
						"id": 1,
						"currentMood": "HAPPY",
						"role": {
							"departments": ["ENGINEERING", "MARKETING"],
							"title": [
								"Founder",
								"CEO"
							]
						}
					}
				}
			}`, res.Body)

			// Wait for metrics to be flushed (interval is 100ms in test env)
			time.Sleep(200 * time.Millisecond)

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			schemaUsage := findMetricFamilyByName(mf, SchemaFieldUsageMetricName)
			assert.NotNil(t, schemaUsage)

			schemaUsageMetrics := schemaUsage.GetMetric()

			// Note: The aggregated batch processing now correctly tracks all field usages,
			// including fields accessed through interfaces, resulting in more accurate metrics
			require.Len(t, schemaUsageMetrics, 8)

			for _, metric := range schemaUsageMetrics {
				assertLabelValue(t, metric.Label, otel.WgOperationName, "myQuery")
				assertLabelValue(t, metric.Label, otel.WgOperationType, "query")

				assertLabelNotPresent(t, metric.Label, otel.WgOperationSha256)
			}

			// Verify we have all expected field/parent type combinations
			// Note: Order may vary, so we'll just check that all expected metrics are present
			fieldTypePairs := make(map[string]string)
			for _, metric := range schemaUsageMetrics {
				var fieldName, parentType string
				for _, label := range metric.Label {
					if *label.Name == "wg_graphql_field_name" {
						fieldName = *label.Value
					}
					if *label.Name == "wg_graphql_parent_type" {
						parentType = *label.Value
					}
				}
				if fieldName != "" && parentType != "" {
					fieldTypePairs[fieldName+":"+parentType] = parentType
				}
			}

			// Verify expected field/parent combinations exist
			require.Contains(t, fieldTypePairs, "currentMood:Employee")
			require.Contains(t, fieldTypePairs, "employee:Query")
			require.Contains(t, fieldTypePairs, "id:Employee")
			require.Contains(t, fieldTypePairs, "role:Employee")
			require.Contains(t, fieldTypePairs, "title:Engineer")
			require.Contains(t, fieldTypePairs, "title:Operator")
		})
	})

	t.Run("multiple usages of field are counted", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			MetricOptions: testenv.MetricOptions{
				PrometheusSchemaFieldUsage: testenv.PrometheusSchemaFieldUsage{
					Enabled: true,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `
				query myQuery {
					employee1: employee(id: 1) { id currentMood }
					employee2: employee(id: 2) { id }
				}`,
			})
			require.JSONEq(t, `{
			    "data": {
			        "employee1": {
			            "id": 1,
			            "currentMood": "HAPPY"
			        },
			        "employee2": {
			            "id": 2
			        }
			    }
			}`, res.Body)

			// Wait for metrics to be flushed (interval is 100ms in test env)
			time.Sleep(200 * time.Millisecond)

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			schemaUsage := findMetricFamilyByName(mf, SchemaFieldUsageMetricName)
			assert.NotNil(t, schemaUsage)

			schemaUsageMetrics := schemaUsage.GetMetric()

			require.Len(t, schemaUsageMetrics, 3)

			for _, metric := range schemaUsageMetrics {
				assertLabelValue(t, metric.Label, otel.WgOperationName, "myQuery")
				assertLabelValue(t, metric.Label, otel.WgOperationType, "query")

				assertLabelNotPresent(t, metric.Label, otel.WgOperationSha256)
			}

			assertLabelValue(t, schemaUsageMetrics[0].Label, otel.WgGraphQLFieldName, "currentMood")
			assertLabelValue(t, schemaUsageMetrics[0].Label, otel.WgGraphQLParentType, "Employee")

			assert.InEpsilon(t, 1.0, *schemaUsageMetrics[0].Counter.Value, 0.0001)

			assertLabelValue(t, schemaUsageMetrics[1].Label, otel.WgGraphQLFieldName, "employee")
			assertLabelValue(t, schemaUsageMetrics[1].Label, otel.WgGraphQLParentType, "Query")

			assert.InEpsilon(t, 2.0, *schemaUsageMetrics[1].Counter.Value, 0.0001)

			assertLabelValue(t, schemaUsageMetrics[2].Label, otel.WgGraphQLFieldName, "id")
			assertLabelValue(t, schemaUsageMetrics[2].Label, otel.WgGraphQLParentType, "Employee")

			assert.InEpsilon(t, 2.0, *schemaUsageMetrics[2].Counter.Value, 0.0001)
		})
	})

	t.Run("operation sha not included if disabled even if computed for another reason", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			RouterOptions: []core.Option{
				core.WithPersistedOperationsConfig(config.PersistedOperationsConfig{
					LogUnknown: true,
				}),
			},
			MetricOptions: testenv.MetricOptions{
				PrometheusSchemaFieldUsage: testenv.PrometheusSchemaFieldUsage{
					Enabled:             true,
					IncludeOperationSha: false,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employee(id: 1) { id currentMood role { title } } }`,
			})
			require.JSONEq(t, `{"data":{"employee":{"id":1,"currentMood":"HAPPY","role":{"title":["Founder","CEO"]}}}}`, res.Body)

			// Wait for metrics to be flushed (interval is 100ms in test env)
			time.Sleep(200 * time.Millisecond)

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			schemaUsage := findMetricFamilyByName(mf, SchemaFieldUsageMetricName)
			assert.NotNil(t, schemaUsage)

			schemaUsageMetrics := schemaUsage.GetMetric()

			require.Len(t, schemaUsageMetrics, 5)

			for _, metric := range schemaUsageMetrics {
				assertLabelNotPresent(t, metric.Label, otel.WgOperationSha256)
			}
		})
	})

	t.Run("include operation sha when enabled", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			MetricOptions: testenv.MetricOptions{
				PrometheusSchemaFieldUsage: testenv.PrometheusSchemaFieldUsage{
					Enabled:             true,
					IncludeOperationSha: true,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employee(id: 1) { id currentMood role { title } } }`,
			})
			require.JSONEq(t, `{"data":{"employee":{"id":1,"currentMood":"HAPPY","role":{"title":["Founder","CEO"]}}}}`, res.Body)

			// Wait for metrics to be flushed (interval is 100ms in test env)
			time.Sleep(200 * time.Millisecond)

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			schemaUsage := findMetricFamilyByName(mf, SchemaFieldUsageMetricName)
			assert.NotNil(t, schemaUsage)

			schemaUsageMetrics := schemaUsage.GetMetric()

			require.Len(t, schemaUsageMetrics, 5)

			for _, metric := range schemaUsageMetrics {
				assertLabelValue(t, metric.Label, otel.WgOperationSha256, "f46b2e72054341523989a788e798ec5c922517e6106646120d2ff23984cfed4b")
			}
		})
	})

	t.Run("label exclusion works correctly", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,

			MetricOptions: testenv.MetricOptions{
				MetricExclusions: testenv.MetricExclusions{
					ExcludedPrometheusMetricLabels: []*regexp.Regexp{
						regexp.MustCompile("^otel_scope_info$"),
					},
				},
				PrometheusSchemaFieldUsage: testenv.PrometheusSchemaFieldUsage{
					Enabled:             true,
					IncludeOperationSha: false,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employee(id: 1) { id currentMood role { title } } }`,
			})
			require.JSONEq(t, `{"data":{"employee":{"id":1,"currentMood":"HAPPY","role":{"title":["Founder","CEO"]}}}}`, res.Body)

			// Wait for metrics to be flushed (interval is 100ms in test env)
			time.Sleep(200 * time.Millisecond)

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			schemaUsage := findMetricFamilyByName(mf, SchemaFieldUsageMetricName)
			assert.NotNil(t, schemaUsage)

			schemaUsageMetrics := schemaUsage.GetMetric()

			require.Len(t, schemaUsageMetrics, 5)

			for _, metric := range schemaUsageMetrics {
				assertLabelValue(t, metric.Label, otel.WgOperationType, "query")

				assertLabelNotPresent(t, metric.Label, "otel_scope_info")
			}
		})
	})

	t.Run("all requests are tracked", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			MetricOptions: testenv.MetricOptions{
				PrometheusSchemaFieldUsage: testenv.PrometheusSchemaFieldUsage{
					Enabled: true,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Make 10 requests
			for range 10 {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employee(id: 1) { id } }`,
				})
				require.JSONEq(t, `{"data":{"employee":{"id":1}}}`, res.Body)
			}

			// Wait for metrics to be flushed (interval is 100ms in test env)
			time.Sleep(200 * time.Millisecond)

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			schemaUsage := findMetricFamilyByName(mf, SchemaFieldUsageMetricName)
			assert.NotNil(t, schemaUsage)

			schemaUsageMetrics := schemaUsage.GetMetric()

			// We expect 2 metrics (employee, id)
			// The counter values should be 10 for each field
			require.Len(t, schemaUsageMetrics, 2)

			for _, metric := range schemaUsageMetrics {
				assertLabelValue(t, metric.Label, otel.WgOperationName, "myQuery")
				assertLabelValue(t, metric.Label, otel.WgOperationType, "query")

				// Each field should have been counted 10 times (once per request)
				assert.InEpsilon(t, 10.0, *metric.Counter.Value, 0.0001)
			}
		})
	})

	t.Run("custom exporter settings", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			MetricOptions: testenv.MetricOptions{
				PrometheusSchemaFieldUsage: testenv.PrometheusSchemaFieldUsage{
					Enabled: true,
					Exporter: &testenv.PrometheusSchemaFieldUsageExporter{
						BatchSize:     10, // Very small batch for immediate flush
						QueueSize:     100,
						Interval:      50 * time.Millisecond, // Fast flush
						ExportTimeout: 2 * time.Second,
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Make 5 requests
			for range 5 {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employee(id: 1) { id } }`,
				})
				require.JSONEq(t, `{"data":{"employee":{"id":1}}}`, res.Body)
			}

			// Wait for metrics to be flushed (custom interval is 50ms)
			time.Sleep(100 * time.Millisecond)

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			schemaUsage := findMetricFamilyByName(mf, SchemaFieldUsageMetricName)
			assert.NotNil(t, schemaUsage)

			schemaUsageMetrics := schemaUsage.GetMetric()

			// We expect 2 metrics (employee, id)
			require.Len(t, schemaUsageMetrics, 2)

			for _, metric := range schemaUsageMetrics {
				assertLabelValue(t, metric.Label, otel.WgOperationName, "myQuery")
				assertLabelValue(t, metric.Label, otel.WgOperationType, "query")

				// Each field should have been counted 5 times
				assert.InEpsilon(t, 5.0, *metric.Counter.Value, 0.0001)
			}
		})
	})
}

func assertLabelNotPresent(t *testing.T, labels []*io_prometheus_client.LabelPair, labelKey attribute.Key) {
	t.Helper()

	labelPair := findLabel(labels, labelKey)

	if !assert.Nil(t, labelPair, "label %s not nil", labelKey) {
		assert.Nil(t, labelPair.Value, "label %s value should be nil, found value `%s`", labelKey, *labelPair.Value)
	}

}

func assertLabelValue(t *testing.T, labels []*io_prometheus_client.LabelPair, labelKey attribute.Key, expectedValue string) {
	t.Helper()

	labelPair := findLabel(labels, labelKey)

	if assert.NotNil(t, labelPair, "label %s not found", labelKey) {
		assert.Equal(t, expectedValue, *labelPair.Value, "label %s value is not %s", labelKey, expectedValue)
	}
}

func findLabel(labels []*io_prometheus_client.LabelPair, labelKey attribute.Key) *io_prometheus_client.LabelPair {
	key := rmetric.SanitizeName(string(labelKey))

	for _, label := range labels {
		if label.Name != nil && *label.Name == key {
			return label
		}
	}

	return nil
}
