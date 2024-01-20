package main

import (
	"context"
	"github.com/akrylysov/algnhsa"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wundergraph/cosmo/aws-lambda-router/internal"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"time"
)

func main() {
	ctx := context.Background()

	logger := logging.New(false, false, zapcore.InfoLevel)
	defer logger.Sync()

	r, err := internal.NewRouter(logger, "./router.json")
	if err != nil {
		logger.Fatal("Could not create router", zap.Error(err))
	}

	svr, err := r.NewServer(ctx)
	if err != nil {
		logger.Fatal("Could not create server", zap.Error(err))
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
