package integration

import (
	"regexp"
	"testing"

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
					Enabled:    true,
					SampleRate: 1.0,
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

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			schemaUsage := findMetricFamilyByName(mf, SchemaFieldUsageMetricName)
			assert.NotNil(t, schemaUsage)

			schemaUsageMetrics := schemaUsage.GetMetric()

			require.Len(t, schemaUsageMetrics, 7)

			for _, metric := range schemaUsageMetrics {
				assertLabelValue(t, metric.Label, otel.WgOperationName, "myQuery")
				assertLabelValue(t, metric.Label, otel.WgOperationType, "query")

				assertLabelNotPresent(t, metric.Label, otel.WgOperationSha256)
			}

			assertLabelValue(t, schemaUsageMetrics[0].Label, otel.WgGraphQLFieldName, "currentMood")
			assertLabelValue(t, schemaUsageMetrics[0].Label, otel.WgGraphQLParentType, "Employee")

			assertLabelValue(t, schemaUsageMetrics[1].Label, otel.WgGraphQLFieldName, "departments")
			assertLabelValue(t, schemaUsageMetrics[1].Label, otel.WgGraphQLParentType, "RoleType")

			assertLabelValue(t, schemaUsageMetrics[2].Label, otel.WgGraphQLFieldName, "employee")
			assertLabelValue(t, schemaUsageMetrics[2].Label, otel.WgGraphQLParentType, "Query")

			assertLabelValue(t, schemaUsageMetrics[3].Label, otel.WgGraphQLFieldName, "id")
			assertLabelValue(t, schemaUsageMetrics[3].Label, otel.WgGraphQLParentType, "Employee")

			assertLabelValue(t, schemaUsageMetrics[4].Label, otel.WgGraphQLFieldName, "role")
			assertLabelValue(t, schemaUsageMetrics[4].Label, otel.WgGraphQLParentType, "Employee")

			assertLabelValue(t, schemaUsageMetrics[5].Label, otel.WgGraphQLFieldName, "title")
			assertLabelValue(t, schemaUsageMetrics[5].Label, otel.WgGraphQLParentType, "Engineer")

			assertLabelValue(t, schemaUsageMetrics[6].Label, otel.WgGraphQLFieldName, "title")
			assertLabelValue(t, schemaUsageMetrics[6].Label, otel.WgGraphQLParentType, "Operator")
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
					Enabled:    true,
					SampleRate: 1.0,
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
					SampleRate:          1.0,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employee(id: 1) { id currentMood role { title } } }`,
			})
			require.JSONEq(t, `{"data":{"employee":{"id":1,"currentMood":"HAPPY","role":{"title":["Founder","CEO"]}}}}`, res.Body)

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
					SampleRate:          1.0,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employee(id: 1) { id currentMood role { title } } }`,
			})
			require.JSONEq(t, `{"data":{"employee":{"id":1,"currentMood":"HAPPY","role":{"title":["Founder","CEO"]}}}}`, res.Body)

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
					SampleRate:          1.0,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query myQuery { employee(id: 1) { id currentMood role { title } } }`,
			})
			require.JSONEq(t, `{"data":{"employee":{"id":1,"currentMood":"HAPPY","role":{"title":["Founder","CEO"]}}}}`, res.Body)

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

	t.Run("sampling reduces tracked requests", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			MetricOptions: testenv.MetricOptions{
				PrometheusSchemaFieldUsage: testenv.PrometheusSchemaFieldUsage{
					Enabled:    true,
					SampleRate: 0.1, // 10% sampling
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Make 100 requests
			for i := 0; i < 100; i++ {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employee(id: 1) { id } }`,
				})
				require.JSONEq(t, `{"data":{"employee":{"id":1}}}`, res.Body)
			}

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			schemaUsage := findMetricFamilyByName(mf, SchemaFieldUsageMetricName)
			assert.NotNil(t, schemaUsage)

			schemaUsageMetrics := schemaUsage.GetMetric()

			// With 10% sampling and 100 requests, we expect roughly 10 sampled request
			// Each request has 2 fields (employee, id), so we expect ~20 metrics total
			// We verify that it's significantly less than 200 (which would be 100% sampling)
			require.Greater(t, len(schemaUsageMetrics), 0, "At least 1 request should be sampled")
			require.Less(t, len(schemaUsageMetrics), 20, "Should sample significantly less than 100% of requests (expected ~2 metrics, allowing up to 20)")

			// Verify that the sampled metrics have correct structure
			for _, metric := range schemaUsageMetrics {
				assertLabelValue(t, metric.Label, otel.WgOperationName, "myQuery")
				assertLabelValue(t, metric.Label, otel.WgOperationType, "query")
			}
		})
	})

	t.Run("100% sample rate tracks all requests", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			MetricOptions: testenv.MetricOptions{
				PrometheusSchemaFieldUsage: testenv.PrometheusSchemaFieldUsage{
					Enabled:    true,
					SampleRate: 1.0, // 100% sampling (default)
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Make 10 requests
			for i := 0; i < 10; i++ {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employee(id: 1) { id } }`,
				})
				require.JSONEq(t, `{"data":{"employee":{"id":1}}}`, res.Body)
			}

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			schemaUsage := findMetricFamilyByName(mf, SchemaFieldUsageMetricName)
			assert.NotNil(t, schemaUsage)

			schemaUsageMetrics := schemaUsage.GetMetric()

			// With 100% sampling and 10 requests, we expect 2 metrics (employee, id)
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

	t.Run("0% sample rate tracks no requests", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
			MetricOptions: testenv.MetricOptions{
				PrometheusSchemaFieldUsage: testenv.PrometheusSchemaFieldUsage{
					Enabled:    true,
					SampleRate: 0.0, // 0% sampling
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Make 10 requests
			for i := 0; i < 10; i++ {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query myQuery { employee(id: 1) { id } }`,
				})
				require.JSONEq(t, `{"data":{"employee":{"id":1}}}`, res.Body)
			}

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			schemaUsage := findMetricFamilyByName(mf, SchemaFieldUsageMetricName)

			// With 0% sampling, no metrics should be recorded
			if schemaUsage != nil {
				require.Len(t, schemaUsage.GetMetric(), 0, "No metrics should be recorded with 0%% sampling")
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
