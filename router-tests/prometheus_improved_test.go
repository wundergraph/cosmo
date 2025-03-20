package integration

import (
	"regexp"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	io_prometheus_client "github.com/prometheus/client_model/go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"go.opentelemetry.io/otel/sdk/metric"
)

// This file exists to be smaller than prometheus_test.go, and use better testing practices.
// Editors like Cursor, VSCode Copilot Agent, Zed, etc have a lot of trouble with the other file due
// to its size and testing methodology. In the new file, you should use new helpers where possible, and avoid
// asserting the values of unrelated metrics/labels.

func TestPrometheusSchemaUsage(t *testing.T) {
	t.Run("operation attributes are correctly added when enabled", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		promRegistry := prometheus.NewRegistry()

		testenv.Run(t, &testenv.Config{
			MetricReader:       metricReader,
			PrometheusRegistry: promRegistry,
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

			mf, err := promRegistry.Gather()
			require.NoError(t, err)

			schemaUsage := findMetricFamilyByName(mf, "router_graphql_schema_field_usage_total")
			assert.NotNil(t, schemaUsage)

			schemaUsageMetrics := schemaUsage.GetMetric()

			require.Len(t, schemaUsageMetrics, 8)

			for _, metric := range schemaUsageMetrics {
				assertLabelValue(t, metric.Label, "wg_operation_name", "myQuery")
				assertLabelValue(t, metric.Label, "wg_operation_type", "query")
				assertLabelValue(t, metric.Label, "wg_operation_hash", "1731669138493683283")

				assertLabelNotPresent(t, metric.Label, "wg_operation_sha256")
			}

			assertLabelValue(t, schemaUsageMetrics[0].Label, "wg_field_name", "currentMood")
			assertLabelValue(t, schemaUsageMetrics[0].Label, "wg_type_name", "Employee")

			assertLabelValue(t, schemaUsageMetrics[1].Label, "wg_field_name", "employee")
			assertLabelValue(t, schemaUsageMetrics[1].Label, "wg_type_name", "Query")

			assertLabelValue(t, schemaUsageMetrics[2].Label, "wg_field_name", "id")
			assertLabelValue(t, schemaUsageMetrics[2].Label, "wg_type_name", "Employee")

			assertLabelValue(t, schemaUsageMetrics[3].Label, "wg_field_name", "role")
			assertLabelValue(t, schemaUsageMetrics[3].Label, "wg_type_name", "Employee")

			// 'role' is an interface, so it counts for each implementing type, and the interface itself
			assertLabelValue(t, schemaUsageMetrics[4].Label, "wg_field_name", "title")
			assertLabelValue(t, schemaUsageMetrics[4].Label, "wg_type_name", "Engineer")

			assertLabelValue(t, schemaUsageMetrics[5].Label, "wg_field_name", "title")
			assertLabelValue(t, schemaUsageMetrics[5].Label, "wg_type_name", "Marketer")

			assertLabelValue(t, schemaUsageMetrics[6].Label, "wg_field_name", "title")
			assertLabelValue(t, schemaUsageMetrics[6].Label, "wg_type_name", "Operator")

			assertLabelValue(t, schemaUsageMetrics[7].Label, "wg_field_name", "title")
			assertLabelValue(t, schemaUsageMetrics[7].Label, "wg_type_name", "RoleType")
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

			schemaUsage := findMetricFamilyByName(mf, "router_graphql_schema_field_usage_total")
			assert.NotNil(t, schemaUsage)

			schemaUsageMetrics := schemaUsage.GetMetric()

			require.Len(t, schemaUsageMetrics, 8)

			for _, metric := range schemaUsageMetrics {
				assertLabelValue(t, metric.Label, "wg_operation_sha256", "f46b2e72054341523989a788e798ec5c922517e6106646120d2ff23984cfed4b")
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
						regexp.MustCompile("^wg_operation_name$"),
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

			schemaUsage := findMetricFamilyByName(mf, "router_graphql_schema_field_usage_total")
			assert.NotNil(t, schemaUsage)

			schemaUsageMetrics := schemaUsage.GetMetric()

			require.Len(t, schemaUsageMetrics, 8)

			for _, metric := range schemaUsageMetrics {
				assertLabelValue(t, metric.Label, "wg_operation_type", "query")
				assertLabelValue(t, metric.Label, "wg_operation_hash", "1731669138493683283")

				assertLabelNotPresent(t, metric.Label, "wg_operation_name")
				assertLabelNotPresent(t, metric.Label, "otel_scope_info")
			}
		})
	})
}

func assertLabelNotPresent(t *testing.T, labels []*io_prometheus_client.LabelPair, labelName string) {
	t.Helper()

	labelPair := findLabel(labels, labelName)

	if !assert.Nil(t, labelPair, "label %s not nil", labelName) {
		assert.Nil(t, labelPair.Value, "label %s value should be nil, found value `%s`", labelName, *labelPair.Value)
	}

}

func assertLabelValue(t *testing.T, labels []*io_prometheus_client.LabelPair, labelName string, expectedValue string) {
	t.Helper()

	labelPair := findLabel(labels, labelName)

	if assert.NotNil(t, labelPair, "label %s not found", labelName) {
		assert.Equal(t, expectedValue, *labelPair.Value, "label %s value is not %s", labelName, expectedValue)
	}
}

func findLabel(labels []*io_prometheus_client.LabelPair, labelName string) *io_prometheus_client.LabelPair {
	for _, label := range labels {
		if label.Name != nil && *label.Name == labelName {
			return label
		}
	}

	return nil
}
