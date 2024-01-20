package internal

import (
	"fmt"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/trace"
	"go.uber.org/zap"
	"os"
)

const (
	telemetryServiceName = "aws-lambda-router"
)

func NewRouter(logger *zap.Logger, routerConfigPath string) (*core.Router, error) {
	routerConfig, err := core.SerializeConfigFromFile(routerConfigPath)
	if err != nil {
		logger.Fatal("Could not read router config", zap.Error(err), zap.String("path", routerConfigPath))
	}

	routerOpts := []core.Option{
		core.WithLogger(logger),
		core.WithPlayground(true),
		core.WithIntrospection(true),
		core.WithStaticRouterConfig(routerConfig),
		core.WithGraphQLMetrics(&core.GraphQLMetricsConfig{
			Enabled:           true,
			CollectorEndpoint: "https://cosmo-metrics.wundergraph.com",
		}),
		core.WithMetrics(&metric.Config{
			Name:    telemetryServiceName,
			Version: Version,
			OpenTelemetry: metric.OpenTelemetry{
				Enabled: true,
			},
		}),
		core.WithTracing(&trace.Config{
			Enabled: true,
			Name:    telemetryServiceName,
			Version: Version,
			Sampler: 0.2,
			Propagators: []trace.Propagator{
				trace.PropagatorTraceContext,
			},
		}),
		core.WithAwsLambdaRuntime(),
		core.WithListenerAddr(":8089"), // port only specified for local debugging
		core.WithGraphApiToken(os.Getenv("GRAPH_API_TOKEN")),
	}

	if os.Getenv("STAGE") != "" {
		routerOpts = append(routerOpts, core.WithGraphQLWebURL(fmt.Sprintf("/%s%s", os.Getenv("STAGE"), "/graphql")))
	}

	return core.NewRouter(routerOpts...)
}
