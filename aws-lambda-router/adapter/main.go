package main

import (
	"context"
	_ "embed"
	"fmt"
	"github.com/akrylysov/algnhsa"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/trace"
	"go.uber.org/zap"
	"os"
	"time"
)

const (
	telemetryServiceName = "aws-lambda-router"
)

func newRouter(logger *zap.Logger) (*core.Router, error) {
	routerConfig, err := core.SerializeConfigFromFile("./router.json")
	if err != nil {
		logger.Fatal("Could not read router config", zap.Error(err), zap.String("path", "./router.json"))
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
			Sampler: 1,
			Propagators: []trace.Propagator{
				trace.PropagatorTraceContext,
			},
		}),
		core.WithAwsLambdaRuntime(),
		core.WithListenerAddr(":8089"), // for local debugging
		core.WithGraphApiToken(os.Getenv("GRAPH_API_TOKEN")),
	}

	if os.Getenv("STAGE") != "" {
		routerOpts = append(routerOpts, core.WithGraphQLWebURL(fmt.Sprintf("/%s%s", os.Getenv("STAGE"), "/graphql")))
	}

	return core.NewRouter(routerOpts...)
}

func main() {
	ctx := context.Background()

	zapLogger, err := zap.NewProduction()
	if err != nil {
		panic(err)
	}

	router, err := newRouter(zapLogger)
	if err != nil {
		zapLogger.Fatal("Could not create router", zap.Error(err))
	}

	svr, err := router.NewServer(ctx)
	if err != nil {
		zapLogger.Fatal("Could not create server", zap.Error(err))
	}

	svr.HealthChecks().SetReady(true)

	// Comment out to debug locally
	// svr.Server().ListenAndServe()

	lambdaHandler := algnhsa.New(svr.Server().Handler, nil)
	lambda.StartWithOptions(lambdaHandler,
		lambda.WithContext(ctx),
		// Registered an internal extensions which gives us 500ms to shutdown
		// This mechanism does not replace flushing after a request
		// https://docs.aws.amazon.com/lambda/latest/dg/runtimes-extensions-api.html#runtimes-lifecycle-extensions-shutdown
		lambda.WithEnableSIGTERM(func() {
			zapLogger.Info("Server shutting down")
			sCtx, cancel := context.WithTimeout(context.Background(), 400*time.Millisecond)
			defer cancel()
			if err := router.Shutdown(sCtx); err != nil {
				panic(err)
			}
			zapLogger.Info("Server shutdown")
		}),
	)
}
