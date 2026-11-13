package module_test

import (
	"fmt"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/wundergraph/cosmo/router-tests/freeport"
	module_meter_providers "github.com/wundergraph/cosmo/router-tests/modules/module-meter-providers"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
)

func moduleMeterProvidersOptions(module *module_meter_providers.ModuleMeterProvidersModule, options ...core.Option) []core.Option {
	return append(options,
		core.WithModulesConfig(map[string]any{"moduleMeterProvidersModule": module}),
		core.WithCustomModules(&module_meter_providers.ModuleMeterProvidersModule{}),
	)
}

// moduleRequestCounts are the module's request counts the registry holds, one per series.
func moduleRequestCounts(t *testing.T, registry *prometheus.Registry) []float64 {
	t.Helper()
	families, err := registry.Gather()
	require.NoError(t, err)
	var counts []float64
	for _, family := range families {
		if family.GetName() != "module_meter_providers_requests_total" {
			continue
		}
		for _, series := range family.GetMetric() {
			counts = append(counts, series.GetCounter().GetValue())
		}
	}
	return counts
}

func TestModuleMeterProviders(t *testing.T) {
	t.Parallel()

	t.Run("a module's metrics reach the Prometheus endpoint with no graph token and no OpenTelemetry exporter", func(t *testing.T) {
		t.Parallel()

		providers := make(chan int, 1)
		module := &module_meter_providers.ModuleMeterProvidersModule{OnProvision: func(count int) { providers <- count }}
		registry := prometheus.NewRegistry()
		port := freeport.GetOne(t)

		testenv.Run(t, &testenv.Config{
			RouterOptions: moduleMeterProvidersOptions(module,
				core.WithGraphApiToken(""),
				core.WithMetrics(&rmetric.Config{
					Name: "cosmo-router",
					Prometheus: rmetric.PrometheusConfig{
						Enabled: true, ListenAddr: fmt.Sprintf("localhost:%d", port), Path: "/metrics", TestRegistry: registry,
					},
				}),
			),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			testenv.AwaitChannelWithT(t, 10*time.Second, providers, func(t *testing.T, count int) {
				assert.Equal(t, 1, count, "the router gives the module its Prometheus provider only")
			}, "the module wasn't provisioned")

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `{ employees { id } }`})

			// The router's own endpoint serves the module's counter, once.
			assert.EventuallyWithT(t, func(c *assert.CollectT) {
				response, err := http.Get(fmt.Sprintf("http://localhost:%d/metrics", port))
				require.NoError(c, err)
				defer func() { _ = response.Body.Close() }()
				body, err := io.ReadAll(response.Body)
				require.NoError(c, err)
				assert.Contains(c, string(body), "module_meter_providers_requests_total")
			}, 10*time.Second, 100*time.Millisecond)
			assert.Equal(t, []float64{1}, moduleRequestCounts(t, registry))
		})
	})

	t.Run("with OpenTelemetry metrics enabled too, each exporter gets the module's metrics once", func(t *testing.T) {
		t.Parallel()

		providers := make(chan int, 1)
		module := &module_meter_providers.ModuleMeterProvidersModule{OnProvision: func(count int) { providers <- count }}
		registry := prometheus.NewRegistry()
		reader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader:       reader,
			PrometheusRegistry: registry,
			RouterOptions:      moduleMeterProvidersOptions(module),
		}, func(t *testing.T, xEnv *testenv.Environment) {
			testenv.AwaitChannelWithT(t, 10*time.Second, providers, func(t *testing.T, count int) {
				assert.Equal(t, 2, count, "the router gives the module its Prometheus and OpenTelemetry providers")
			}, "the module wasn't provisioned")

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `{ employees { id } }`})

			assert.Equal(t, []float64{1}, moduleRequestCounts(t, registry))
			var collected metricdata.ResourceMetrics
			require.NoError(t, reader.Collect(t.Context(), &collected))
			var otlpCounts []int64
			for _, scope := range collected.ScopeMetrics {
				for _, recorded := range scope.Metrics {
					if recorded.Name != "module_meter_providers.requests" {
						continue
					}
					sum, ok := recorded.Data.(metricdata.Sum[int64])
					require.True(t, ok)
					for _, point := range sum.DataPoints {
						otlpCounts = append(otlpCounts, point.Value)
					}
				}
			}
			assert.Equal(t, []int64{1}, otlpCounts)
		})
	})
}
