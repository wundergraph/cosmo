package main

import (
	"context"
	"errors"
	"fmt"
	"github.com/akrylysov/algnhsa"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wundergraph/cosmo/aws-lambda-router/internal"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/trace"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"net/http"
	"os"
	"time"
)

const (
	telemetryServiceName = "aws-lambda-router"
	routerConfigPath     = "router.json"
)

var (
	defaultSampleRate = 0.2 // 20% of requests will be sampled
	enableTelemetry   = os.Getenv("DISABLE_TELEMETRY") != "true"
	stage             = os.Getenv("STAGE")
)

func main() {
	ctx := context.Background()

	logger := logging.New(false, false, zapcore.InfoLevel)
	logger = logger.With(
		zap.String("service_version", internal.Version),
	)
	defer func() {
		if err := logger.Sync(); err != nil {
			fmt.Println("Could not sync logger", err)
		}
	}()

	httpPort := os.Getenv("HTTP_PORT")

	routerConfig, err := core.SerializeConfigFromFile(routerConfigPath)
	if err != nil {
		logger.Fatal("Could not read router config", zap.Error(err), zap.String("path", routerConfigPath))
	}

	routerOpts := []core.Option{
		core.WithLogger(logger),
		core.WithPlayground(true),
		core.WithIntrospection(true),
		core.WithStaticRouterConfig(routerConfig),
		core.WithAwsLambdaRuntime(),
		core.WithGraphApiToken(os.Getenv("GRAPH_API_TOKEN")),
	}

	if httpPort != "" {
		routerOpts = append(routerOpts, core.WithListenerAddr(":"+httpPort))
	}

	if enableTelemetry {
		routerOpts = append(routerOpts,
			core.WithGraphQLMetrics(&core.GraphQLMetricsConfig{
				Enabled:           true,
				CollectorEndpoint: "https://cosmo-metrics.wundergraph.com",
			}),
			core.WithMetrics(&metric.Config{
				Name:    telemetryServiceName,
				Version: internal.Version,
				OpenTelemetry: metric.OpenTelemetry{
					Enabled: true,
				},
			}),
			core.WithTracing(&trace.Config{
				Enabled: true,
				Name:    telemetryServiceName,
				Version: internal.Version,
				Sampler: defaultSampleRate,
				Propagators: []trace.Propagator{
					trace.PropagatorTraceContext,
				},
			}),
		)
	}

	if stage != "" {
		routerOpts = append(routerOpts,
			core.WithGraphQLWebURL(fmt.Sprintf("/%s%s", os.Getenv("STAGE"), "/graphql")),
		)
	}

	r, err := core.NewRouter(routerOpts...)
	if err != nil {
		logger.Fatal("Could not create router", zap.Error(err))
	}

	svr, err := r.NewServer(ctx)
	if err != nil {
		logger.Fatal("Could not create server", zap.Error(err))
	}

	// Set the server to ready
	svr.HealthChecks().SetReady(true)

	// If HTTP_PORT is set, we assume we are running the router without lambda
	if httpPort != "" {
		if err := svr.Server().ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("Could not start server", zap.Error(err))
		}
		return
	}

	lambdaHandler := algnhsa.New(svr.Server().Handler, nil)
	lambda.StartWithOptions(lambdaHandler,
		lambda.WithContext(ctx),
		// Registered an internal extensions which gives us 500ms to shutdown
		// This mechanism does not replace telemetry flushing after a request
		// https://docs.aws.amazon.com/lambda/latest/dg/runtimes-extensions-api.html#runtimes-lifecycle-extensions-shutdown
		lambda.WithEnableSIGTERM(func() {
			logger.Info("Server shutting down")
			sCtx, cancel := context.WithTimeout(context.Background(), 400*time.Millisecond)
			defer cancel()
			if err := r.Shutdown(sCtx); err != nil {
				panic(err)
			}
			logger.Info("Server shutdown")
		}),
	)
}
