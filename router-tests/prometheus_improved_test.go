package integration

import (
	"regexp"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	io_prometheus_client "github.com/prometheus/client_model/go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
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
				Query: `query myQuery { employee(id: 1) { id currentMood role { title } } }`,
			})
			require.JSONEq(t, `{"data":{"employee":{"id":1,"currentMood":"HAPPY","role":{"title":["Founder","CEO"]}}}}`, res.Body)

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			schemaUsage := findMetricFamilyByName(mf, SchemaFieldUsageMetricName)
			assert.NotNil(t, schemaUsage)

			schemaUsageMetrics := schemaUsage.GetMetric()

			require.Len(t, schemaUsageMetrics, 8)

			for _, metric := range schemaUsageMetrics {
				assertLabelValue(t, metric.Label, otel.WgOperationName, "myQuery")
				assertLabelValue(t, metric.Label, otel.WgOperationType, "query")

				assertLabelNotPresent(t, metric.Label, otel.WgOperationSha256)
			}

			assertLabelValue(t, schemaUsageMetrics[0].Label, otel.WgGraphQLFieldName, "currentMood")
			assertLabelValue(t, schemaUsageMetrics[0].Label, otel.WgGraphQLFieldType, "Employee")

			assertLabelValue(t, schemaUsageMetrics[1].Label, otel.WgGraphQLFieldName, "employee")
			assertLabelValue(t, schemaUsageMetrics[1].Label, otel.WgGraphQLFieldType, "Query")

			assertLabelValue(t, schemaUsageMetrics[2].Label, otel.WgGraphQLFieldName, "id")
			assertLabelValue(t, schemaUsageMetrics[2].Label, otel.WgGraphQLFieldType, "Employee")

			assertLabelValue(t, schemaUsageMetrics[3].Label, otel.WgGraphQLFieldName, "role")
			assertLabelValue(t, schemaUsageMetrics[3].Label, otel.WgGraphQLFieldType, "Employee")

			// 'role' is an interface, so it counts for each implementing type, and the interface itself
			assertLabelValue(t, schemaUsageMetrics[4].Label, otel.WgGraphQLFieldName, "title")
			assertLabelValue(t, schemaUsageMetrics[4].Label, otel.WgGraphQLFieldType, "Engineer")

			assertLabelValue(t, schemaUsageMetrics[5].Label, otel.WgGraphQLFieldName, "title")
			assertLabelValue(t, schemaUsageMetrics[5].Label, otel.WgGraphQLFieldType, "Marketer")

			assertLabelValue(t, schemaUsageMetrics[6].Label, otel.WgGraphQLFieldName, "title")
			assertLabelValue(t, schemaUsageMetrics[6].Label, otel.WgGraphQLFieldType, "Operator")

			assertLabelValue(t, schemaUsageMetrics[7].Label, otel.WgGraphQLFieldName, "title")
			assertLabelValue(t, schemaUsageMetrics[7].Label, otel.WgGraphQLFieldType, "RoleType")
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
			assertLabelValue(t, schemaUsageMetrics[0].Label, otel.WgGraphQLFieldType, "Employee")

			assert.InEpsilon(t, 1.0, *schemaUsageMetrics[0].Counter.Value, 0.0001)

			assertLabelValue(t, schemaUsageMetrics[1].Label, otel.WgGraphQLFieldName, "employee")
			assertLabelValue(t, schemaUsageMetrics[1].Label, otel.WgGraphQLFieldType, "Query")

			assert.InEpsilon(t, 2.0, *schemaUsageMetrics[1].Counter.Value, 0.0001)

			assertLabelValue(t, schemaUsageMetrics[2].Label, otel.WgGraphQLFieldName, "id")
			assertLabelValue(t, schemaUsageMetrics[2].Label, otel.WgGraphQLFieldType, "Employee")

			assert.InEpsilon(t, 2.0, *schemaUsageMetrics[2].Counter.Value, 0.0001)
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

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			schemaUsage := findMetricFamilyByName(mf, SchemaFieldUsageMetricName)
			assert.NotNil(t, schemaUsage)

			schemaUsageMetrics := schemaUsage.GetMetric()

			require.Len(t, schemaUsageMetrics, 8)

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

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			schemaUsage := findMetricFamilyByName(mf, SchemaFieldUsageMetricName)
			assert.NotNil(t, schemaUsage)

			schemaUsageMetrics := schemaUsage.GetMetric()

			require.Len(t, schemaUsageMetrics, 8)

			for _, metric := range schemaUsageMetrics {
				assertLabelValue(t, metric.Label, otel.WgOperationType, "query")

				assertLabelNotPresent(t, metric.Label, "otel_scope_info")
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
	key := strings.ReplaceAll(string(labelKey), ".", "_")

	for _, label := range labels {
		if label.Name != nil && *label.Name == key {
			return label
		}
	}

	return nil
}
