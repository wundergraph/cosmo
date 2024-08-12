package core

import (
	"context"
	"crypto/ecdsa"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/cloudflare/backoff"
	"github.com/dgraph-io/ristretto"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/golang-jwt/jwt/v5"
	"github.com/klauspost/compress/gzhttp"
	"github.com/klauspost/compress/gzip"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/common"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	rjwt "github.com/wundergraph/cosmo/router/internal/jwt"
	rmiddleware "github.com/wundergraph/cosmo/router/internal/middleware"
	"github.com/wundergraph/cosmo/router/internal/recoveryhandler"
	"github.com/wundergraph/cosmo/router/internal/requestlogger"
	"github.com/wundergraph/cosmo/router/internal/retrytransport"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/cors"
	"github.com/wundergraph/cosmo/router/pkg/health"
	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/pubsub"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
	pubsubNats "github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	oteltrace "go.opentelemetry.io/otel/trace"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"golang.org/x/exp/maps"
)

const (
	featureFlagHeader = "X-Feature-Flag"
	featureFlagCookie = "feature_flag"
)

type (
	// Server is the public interface of the server.
	Server interface {
		HttpServer() *http.Server
		HealthChecks() health.Checker
	}

	EnginePubSubProviders struct {
		nats  map[string]pubsub_datasource.NatsPubSub
		kafka map[string]pubsub_datasource.KafkaPubSub
	}

	// graphServer is the swappable implementation of a Graph instance which is an HTTP mux with middlewares.
	// Everytime a schema is updated, the old graph server is shutdown and a new graph server is created.
	// For feature flags, a graphql server has multiple mux and is dynamically switched based on the feature flag header or cookie.
	// All fields are shared between all feature muxes. On shutdown, all graph instances are shutdown.
	graphServer struct {
		*Config
		context                 context.Context
		cancelFunc              context.CancelFunc
		pubSubProviders         *EnginePubSubProviders
		websocketStats          WebSocketsStatistics
		playgroundHandler       func(http.Handler) http.Handler
		publicKey               *ecdsa.PublicKey
		executionTransport      *http.Transport
		baseOtelAttributes      []attribute.KeyValue
		runtimeMetrics          *rmetric.RuntimeMetrics
		metricStore             rmetric.Store
		baseRouterConfigVersion string
		mux                     *chi.Mux
		// inFlightRequests is used to track the number of requests currently being processed
		// does not include websocket (hijacked) connections
		inFlightRequests *atomic.Uint64
		graphMuxes       []*graphMux
	}
)

// newGraphServer creates a new server instance.
func newGraphServer(ctx context.Context, r *Router, routerConfig *nodev1.RouterConfig) (*graphServer, error) {
	ctx, cancel := context.WithCancel(ctx)
	s := &graphServer{
		context:                 ctx,
		cancelFunc:              cancel,
		Config:                  &r.Config,
		websocketStats:          r.WebsocketStats,
		metricStore:             rmetric.NewNoopMetrics(),
		executionTransport:      newHTTPTransport(r.subgraphTransportOptions),
		playgroundHandler:       r.playgroundHandler,
		baseRouterConfigVersion: routerConfig.GetVersion(),
		inFlightRequests:        &atomic.Uint64{},
		graphMuxes:              make([]*graphMux, 0, 1),
		pubSubProviders: &EnginePubSubProviders{
			nats:  map[string]pubsub_datasource.NatsPubSub{},
			kafka: map[string]pubsub_datasource.KafkaPubSub{},
		},
	}

	baseOtelAttributes := []attribute.KeyValue{
		otel.WgRouterVersion.String(Version),
		otel.WgRouterClusterName.String(r.clusterName),
	}

	if s.graphApiToken != "" {
		claims, err := rjwt.ExtractFederatedGraphTokenClaims(s.graphApiToken)
		if err != nil {
			return nil, err
		}
		baseOtelAttributes = append(baseOtelAttributes, otel.WgFederatedGraphID.String(claims.FederatedGraphID))
	}

	s.baseOtelAttributes = baseOtelAttributes

	if s.metricConfig.OpenTelemetry.RouterRuntime {
		// Create runtime metrics exported to OTEL
		s.runtimeMetrics = rmetric.NewRuntimeMetrics(
			s.logger,
			r.otlpMeterProvider,
			// We track runtime metrics with base router config version
			// even when we have multiple feature flags
			append([]attribute.KeyValue{
				otel.WgRouterConfigVersion.String(s.baseRouterConfigVersion),
			}, s.baseOtelAttributes...),
			s.processStartTime,
		)

		// Start runtime metrics
		if err := s.runtimeMetrics.Start(); err != nil {
			return nil, err
		}
	}

	// Prometheus metricStore rely on OTLP metricStore
	if s.metricConfig.IsEnabled() {
		m, err := rmetric.NewStore(
			rmetric.WithPromMeterProvider(s.promMeterProvider),
			rmetric.WithOtlpMeterProvider(s.otlpMeterProvider),
			rmetric.WithLogger(s.logger),
			rmetric.WithProcessStartTime(s.processStartTime),
			// Don't pass the router config version or feature flags here
			// We scope the metrics to the feature flags and config version in the handler
			rmetric.WithAttributes(baseOtelAttributes...),
		)
		if err != nil {
			return nil, fmt.Errorf("failed to create metric handler: %w", err)
		}

		s.metricStore = m
	}

	if s.registrationInfo != nil {
		publicKey, err := jwt.ParseECPublicKeyFromPEM([]byte(s.registrationInfo.GetGraphPublicKey()))
		if err != nil {
			return nil, fmt.Errorf("failed to parse router public key: %w", err)
		}
		s.publicKey = publicKey
	}

	recoveryHandler := recoveryhandler.New(
		recoveryhandler.WithLogger(s.logger),
		recoveryhandler.WithPrintStack(),
	)

	httpRouter := chi.NewRouter()

	/**
	* Middlewares
	 */

	httpRouter.Use(recoveryHandler)
	httpRouter.Use(rmiddleware.RequestSize(int64(s.routerTrafficConfig.MaxRequestBodyBytes)))
	httpRouter.Use(middleware.RequestID)
	httpRouter.Use(middleware.RealIP)
	if s.corsOptions.Enabled {
		httpRouter.Use(cors.New(*s.corsOptions))
	}

	gm, err := s.buildGraphMux(ctx, "", s.baseRouterConfigVersion, routerConfig.GetEngineConfig(), routerConfig.GetSubgraphs())
	if err != nil {
		return nil, fmt.Errorf("failed to build base mux: %w", err)
	}

	featureFlagConfigMap := routerConfig.FeatureFlagConfigs.GetConfigByFeatureFlagName()
	if len(featureFlagConfigMap) > 0 {
		s.logger.Info("Feature flags enabled", zap.Strings("flags", maps.Keys(featureFlagConfigMap)))
	}

	multiGraphHandler, err := s.buildMultiGraphHandler(ctx, gm.mux, featureFlagConfigMap)
	if err != nil {
		return nil, fmt.Errorf("failed to build feature flag handler: %w", err)
	}

	wrapper, err := gzhttp.NewWrapper(
		gzhttp.MinSize(1024), // 1KB
		gzhttp.CompressionLevel(gzip.DefaultCompression),
		gzhttp.ContentTypes(CompressibleContentTypes),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create gzip wrapper: %w", err)
	}

	/**
	* A group where we can selectively apply middlewares to the graphql endpoint
	 */
	httpRouter.Group(func(cr chi.Router) {

		// We are applying it conditionally because compressing 3MB playground is still slow even with stdlib gzip
		cr.Use(func(h http.Handler) http.Handler {
			return wrapper(h)
		})

		// Mount the feature flag handler. It calls the base mux if no feature flag is set.
		cr.Mount(r.graphqlPath, multiGraphHandler)

		if r.webSocketConfiguration != nil && r.webSocketConfiguration.Enabled && r.webSocketConfiguration.AbsintheProtocol.Enabled {
			// Mount the Absinthe protocol handler for WebSockets
			httpRouter.Mount(r.webSocketConfiguration.AbsintheProtocol.HandlerPath, multiGraphHandler)
		}
	})

	/**
	* Routes
	 */

	// We mount the playground once here when we don't have a conflict with the websocket handler
	// If we have a conflict, we mount the playground during building the individual muxes
	if s.playgroundHandler != nil && s.graphqlPath != s.playgroundPath {
		httpRouter.Get(r.playgroundPath, s.playgroundHandler(nil).ServeHTTP)
	}

	httpRouter.Get(s.healthCheckPath, r.healthcheck.Liveness())
	httpRouter.Get(s.livenessCheckPath, r.healthcheck.Liveness())
	httpRouter.Get(s.readinessCheckPath, r.healthcheck.Readiness())

	s.mux = httpRouter

	return s, nil
}

func (s *graphServer) buildMultiGraphHandler(ctx context.Context, baseMux *chi.Mux, featureFlagConfigs map[string]*nodev1.FeatureFlagRouterExecutionConfig) (http.HandlerFunc, error) {

	if len(featureFlagConfigs) == 0 {
		return baseMux.ServeHTTP, nil
	}

	featureFlagToMux := make(map[string]*chi.Mux, len(featureFlagConfigs))

	// Build all the muxes for the feature flags in serial to avoid any race conditions
	for featureFlagName, executionConfig := range featureFlagConfigs {
		gm, err := s.buildGraphMux(ctx,
			featureFlagName,
			executionConfig.GetVersion(),
			executionConfig.GetEngineConfig(),
			executionConfig.Subgraphs,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to build mux for feature flag '%s': %w", featureFlagName, err)
		}
		featureFlagToMux[featureFlagName] = gm.mux
	}

	return func(w http.ResponseWriter, r *http.Request) {

		// Extract the feature flag and run the corresponding mux
		// 1. From the request header
		// 2. From the cookie

		ff := strings.TrimSpace(r.Header.Get(featureFlagHeader))
		if ff == "" {
			cookie, err := r.Cookie(featureFlagCookie)
			if err == nil && cookie != nil {
				ff = strings.TrimSpace(cookie.Value)
			}
		}

		if mux, ok := featureFlagToMux[ff]; ok {
			w.Header().Set(featureFlagHeader, ff)
			mux.ServeHTTP(w, r)
			return
		}

		// Fall back to the base composition
		baseMux.ServeHTTP(w, r)
	}, nil
}

type graphMux struct {
	mux                *chi.Mux
	planCache          ExecutionPlanCache[uint64, *planWithMetaData]
	normalizationCache *ristretto.Cache[uint64, NormalizationCacheEntry]
	validationCache    *ristretto.Cache[uint64, bool]
}

func (s *graphMux) Shutdown(_ context.Context) {
	s.planCache.Close()
	if s.normalizationCache != nil {
		s.normalizationCache.Close()
	}
	if s.validationCache != nil {
		s.validationCache.Close()
	}
}

// buildGraphMux creates a new graph mux with the given feature flags and engine configuration.
// It also creates a new execution plan cache for the mux. The mux is not mounted on the server.
// The mux is appended internally to the graph server's list of muxes to clean up later when the server is swapped.
func (s *graphServer) buildGraphMux(ctx context.Context,
	featureFlagName string,
	routerConfigVersion string,
	engineConfig *nodev1.EngineConfiguration,
	configSubgraphs []*nodev1.Subgraph) (*graphMux, error) {

	gm := &graphMux{}

	httpRouter := chi.NewRouter()

	baseOtelAttributes := append(
		[]attribute.KeyValue{otel.WgRouterConfigVersion.String(routerConfigVersion)},
		s.baseOtelAttributes...,
	)

	if featureFlagName != "" {
		baseOtelAttributes = append(baseOtelAttributes, otel.WgFeatureFlag.String(featureFlagName))
	}

	subgraphs, err := configureSubgraphOverwrites(
		engineConfig,
		configSubgraphs,
		s.overrideRoutingURLConfiguration,
		s.overrides,
	)
	if err != nil {
		return nil, err
	}

	// We create a new execution plan cache for each operation planner which is coupled to
	// the specific engine configuration. This is necessary because otherwise we would return invalid plans.
	//
	// when an execution plan was generated, which can be quite expensive, we want to cache it
	// this means that we can hash the input and cache the generated plan
	// the next time we get the same input, we can just return the cached plan
	// the engine is smart enough to first do normalization and then hash the input
	// this means that we can cache the normalized input and don't have to worry about
	// different inputs that would generate the same execution plan

	if s.engineExecutionConfiguration.ExecutionPlanCacheSize > 0 {
		planCacheConfig := &ristretto.Config[uint64, *planWithMetaData]{
			MaxCost:     s.engineExecutionConfiguration.ExecutionPlanCacheSize,
			NumCounters: s.engineExecutionConfiguration.ExecutionPlanCacheSize * 10,
			BufferItems: 64,
		}
		gm.planCache, err = ristretto.NewCache[uint64, *planWithMetaData](planCacheConfig)
		if err != nil {
			return nil, fmt.Errorf("failed to create planner cache: %w", err)
		}
	} else {
		gm.planCache = NewNoopExecutionPlanCache()
	}

	if s.engineExecutionConfiguration.EnableNormalizationCache && s.engineExecutionConfiguration.NormalizationCacheSize > 0 {
		normalizationCacheConfig := &ristretto.Config[uint64, NormalizationCacheEntry]{
			MaxCost:     s.engineExecutionConfiguration.NormalizationCacheSize,
			NumCounters: s.engineExecutionConfiguration.NormalizationCacheSize * 10,
			BufferItems: 64,
		}
		gm.normalizationCache, err = ristretto.NewCache[uint64, NormalizationCacheEntry](normalizationCacheConfig)
		if err != nil {
			return nil, fmt.Errorf("failed to create normalization cache: %w", err)
		}
	}

	if s.engineExecutionConfiguration.EnableValidationCache && s.engineExecutionConfiguration.ValidationCacheSize > 0 {
		validationCacheConfig := &ristretto.Config[uint64, bool]{
			MaxCost:     s.engineExecutionConfiguration.ValidationCacheSize,
			NumCounters: s.engineExecutionConfiguration.ValidationCacheSize * 10,
			BufferItems: 64,
		}
		gm.validationCache, err = ristretto.NewCache[uint64, bool](validationCacheConfig)
		if err != nil {
			return nil, fmt.Errorf("failed to create validation cache: %w", err)
		}
	}

	routerMetrics := NewRouterMetrics(&routerMetricsConfig{
		metrics:             s.metricStore,
		gqlMetricsExporter:  s.gqlMetricsExporter,
		exportEnabled:       s.graphqlMetricsConfig.Enabled,
		routerConfigVersion: routerConfigVersion,
		logger:              s.logger,
	})

	var traceHandler *rtrace.Middleware
	var otelAttributesMappers []func(req *http.Request) []attribute.KeyValue

	if s.traceConfig.Enabled {
		spanStartOptions := []oteltrace.SpanStartOption{
			oteltrace.WithAttributes(
				otel.RouterServerAttribute,
				otel.WgRouterRootSpan.Bool(true),
			),
		}

		if s.traceConfig.WithNewRoot {
			spanStartOptions = append(spanStartOptions, oteltrace.WithNewRoot())
		}

		traceHandler = rtrace.NewMiddleware(
			func(r *http.Request) {
				span := oteltrace.SpanFromContext(r.Context())
				if attributes := baseAttributesFromContext(r.Context()); attributes != nil {
					span.SetAttributes(attributes...)
				}
			},
			otelhttp.WithSpanOptions(spanStartOptions...),
			otelhttp.WithFilter(rtrace.CommonRequestFilter),
			otelhttp.WithFilter(rtrace.PrefixRequestFilter(
				[]string{s.healthCheckPath, s.readinessCheckPath, s.livenessCheckPath}),
			),
			// Disable built-in metricStore through NoopMeterProvider
			otelhttp.WithMeterProvider(sdkmetric.NewMeterProvider()),
			otelhttp.WithSpanNameFormatter(SpanNameFormatter),
			otelhttp.WithTracerProvider(s.tracerProvider),
		)

		if s.traceConfig.SpanAttributesMapper != nil {
			otelAttributesMappers = append(otelAttributesMappers, s.traceConfig.SpanAttributesMapper)
		}

		otelAttributesMappers = append(otelAttributesMappers, func(req *http.Request) []attribute.KeyValue {
			return baseOtelAttributes
		})
	}

	baseLogFields := []zapcore.Field{
		zap.String("config_version", routerConfigVersion),
	}

	if featureFlagName != "" {
		baseLogFields = append(baseLogFields, zap.String("feature_flag", featureFlagName))
	}

	// Request logger
	requestLoggerOpts := []requestlogger.Option{
		requestlogger.WithDefaultOptions(),
		requestlogger.WithNoTimeField(),
		requestlogger.WithFields(baseLogFields...),
		requestlogger.WithRequestFields(func(request *http.Request) []zapcore.Field {
			return []zapcore.Field{
				zap.String("request_id", middleware.GetReqID(request.Context())),
			}
		}),
	}

	if s.ipAnonymization.Enabled {
		requestLoggerOpts = append(requestLoggerOpts, requestlogger.WithAnonymization(&requestlogger.IPAnonymizationConfig{
			Enabled: s.ipAnonymization.Enabled,
			Method:  requestlogger.IPAnonymizationMethod(s.ipAnonymization.Method),
		}))
	}

	requestLogger := requestlogger.New(
		s.logger,
		requestLoggerOpts...,
	)

	// Enrich the request context with the subgraph information which is required for custom modules and tracing
	subgraphResolver := NewSubgraphResolver(subgraphs)
	httpRouter.Use(func(h http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r = r.WithContext(withSubgraphResolver(r.Context(), subgraphResolver))

			// For debugging purposes, we can validate from what version of the config the request is coming from
			if s.setConfigVersionHeader {
				w.Header().Set("X-Router-Config-Version", routerConfigVersion)
			}

			h.ServeHTTP(w, r)
		})
	})

	if s.traceConfig.Enabled {
		httpRouter.Use(func(h http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

				var attributes []attribute.KeyValue
				for _, mapper := range otelAttributesMappers {
					attributes = append(attributes, mapper(r)...)
				}

				attributes = append(attributes, baseOtelAttributes...)

				r = r.WithContext(
					withBaseAttributes(r.Context(), attributes),
				)

				h.ServeHTTP(w, r)
			})
		})
	}

	// Register the trace middleware before the request logger, so we can log the trace ID
	if traceHandler != nil {
		httpRouter.Use(traceHandler.Handler)
	}
	httpRouter.Use(requestLogger)

	routerEngineConfig := &RouterEngineConfiguration{
		Execution:                s.engineExecutionConfiguration,
		Headers:                  s.headerRules,
		Events:                   s.eventsConfig,
		SubgraphErrorPropagation: s.subgraphErrorPropagation,
	}

	err = s.buildPubSubConfiguration(ctx, engineConfig, routerEngineConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to build pubsub configuration: %w", err)
	}

	ecb := &ExecutorConfigurationBuilder{
		introspection: s.introspection,
		baseURL:       s.baseURL,
		transport:     s.executionTransport,
		logger:        s.logger,
		includeInfo:   s.graphqlMetricsConfig.Enabled,
		transportOptions: &TransportOptions{
			RequestTimeout: s.subgraphTransportOptions.RequestTimeout,
			PreHandlers:    s.preOriginHandlers,
			PostHandlers:   s.postOriginHandlers,
			MetricStore:    s.metricStore,
			RetryOptions: retrytransport.RetryOptions{
				Enabled:       s.retryOptions.Enabled,
				MaxRetryCount: s.retryOptions.MaxRetryCount,
				MaxDuration:   s.retryOptions.MaxDuration,
				Interval:      s.retryOptions.Interval,
				ShouldRetry: func(err error, req *http.Request, resp *http.Response) bool {
					return retrytransport.IsRetryableError(err, resp) && !isMutationRequest(req.Context())
				},
			},
			TracerProvider:                s.tracerProvider,
			LocalhostFallbackInsideDocker: s.localhostFallbackInsideDocker,
			Logger:                        s.logger,
		},
	}

	executor, err := ecb.Build(
		ctx,
		&ExecutorBuildOptions{
			EngineConfig:       engineConfig,
			Subgraphs:          configSubgraphs,
			RouterEngineConfig: routerEngineConfig,
			PubSubProviders:    s.pubSubProviders,
			Reporter:           s.websocketStats,
		},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to build plan configuration: %w", err)
	}

	operationProcessor := NewOperationProcessor(OperationProcessorOptions{
		Executor:                       executor,
		MaxOperationSizeInBytes:        int64(s.routerTrafficConfig.MaxRequestBodyBytes),
		PersistedOperationClient:       s.persistedOperationClient,
		EnablePersistedOperationsCache: s.engineExecutionConfiguration.EnablePersistedOperationsCache,
		NormalizationCache:             gm.normalizationCache,
		ValidationCache:                gm.validationCache,
		ParseKitPoolSize:               s.engineExecutionConfiguration.ParseKitPoolSize,
	})
	operationPlanner := NewOperationPlanner(executor, gm.planCache)

	authorizerOptions := &CosmoAuthorizerOptions{
		FieldConfigurations:           engineConfig.FieldConfigurations,
		RejectOperationIfUnauthorized: false,
	}

	if s.Config.authorization != nil {
		authorizerOptions.RejectOperationIfUnauthorized = s.authorization.RejectOperationIfUnauthorized
	}

	handlerOpts := HandlerOptions{
		Executor:                               executor,
		Log:                                    s.logger,
		EnableExecutionPlanCacheResponseHeader: s.engineExecutionConfiguration.EnableExecutionPlanCacheResponseHeader,
		EnablePersistedOperationCacheResponseHeader: s.engineExecutionConfiguration.Debug.EnablePersistedOperationsCacheResponseHeader,
		EnableNormalizationCacheResponseHeader:      s.engineExecutionConfiguration.Debug.EnableNormalizationCacheResponseHeader,
		WebSocketStats:                              s.websocketStats,
		TracerProvider:                              s.tracerProvider,
		Authorizer:                                  NewCosmoAuthorizer(authorizerOptions),
		SubgraphErrorPropagation:                    s.subgraphErrorPropagation,
		EngineLoaderHooks:                           NewEngineRequestHooks(s.metricStore),
	}

	if s.redisClient != nil {
		handlerOpts.RateLimitConfig = s.rateLimit
		handlerOpts.RateLimiter = NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			RedisClient: s.redisClient,
			Debug:       s.rateLimit.Debug,
		})
	}

	graphqlHandler := NewGraphQLHandler(handlerOpts)
	executor.Resolver.SetAsyncErrorWriter(graphqlHandler)

	operationBlocker := NewOperationBlocker(&OperationBlockerOptions{
		BlockMutations:     s.securityConfiguration.BlockMutations,
		BlockSubscriptions: s.securityConfiguration.BlockSubscriptions,
		BlockNonPersisted:  s.securityConfiguration.BlockNonPersistedOperations,
	})

	graphqlPreHandler := NewPreHandler(&PreHandlerOptions{
		Logger:                      s.logger,
		Executor:                    executor,
		Metrics:                     routerMetrics,
		OperationProcessor:          operationProcessor,
		Planner:                     operationPlanner,
		AccessController:            s.accessController,
		OperationBlocker:            operationBlocker,
		RouterPublicKey:             s.publicKey,
		EnableRequestTracing:        s.engineExecutionConfiguration.EnableRequestTracing,
		DevelopmentMode:             s.developmentMode,
		TracerProvider:              s.tracerProvider,
		FlushTelemetryAfterResponse: s.awsLambda,
		TraceExportVariables:        s.traceConfig.ExportGraphQLVariables.Enabled,
		FileUploadEnabled:           s.fileUploadConfig.Enabled,
		MaxUploadFiles:              s.fileUploadConfig.MaxFiles,
		MaxUploadFileSize:           int(s.fileUploadConfig.MaxFileSizeBytes),
	})

	if s.webSocketConfiguration != nil && s.webSocketConfiguration.Enabled {
		wsMiddleware := NewWebsocketMiddleware(ctx, WebsocketMiddlewareOptions{
			OperationProcessor:         operationProcessor,
			OperationBlocker:           operationBlocker,
			Planner:                    operationPlanner,
			GraphQLHandler:             graphqlHandler,
			Metrics:                    routerMetrics,
			AccessController:           s.accessController,
			Logger:                     s.logger,
			Stats:                      s.websocketStats,
			ReadTimeout:                s.engineExecutionConfiguration.WebSocketReadTimeout,
			EnableWebSocketEpollKqueue: s.engineExecutionConfiguration.EnableWebSocketEpollKqueue,
			EpollKqueuePollTimeout:     s.engineExecutionConfiguration.EpollKqueuePollTimeout,
			EpollKqueueConnBufferSize:  s.engineExecutionConfiguration.EpollKqueueConnBufferSize,
			WebSocketConfiguration:     s.webSocketConfiguration,
		})

		// When the playground path is equal to the graphql path, we need to handle
		// ws upgrades and html requests on the same route.
		if s.playground && s.graphqlPath == s.playgroundPath {
			httpRouter.Use(s.playgroundHandler, wsMiddleware)
		} else {
			httpRouter.Use(wsMiddleware)
		}
	}

	httpRouter.Use(
		// Responsible for handling regular GraphQL requests over HTTP not WebSockets
		graphqlPreHandler.Handler,
		// Must be mounted after the websocket middleware to ensure that we only count non-hijacked requests like WebSockets
		func(handler http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

				opCtx := getOperationContext(r.Context())

				// We don't want to count any type of subscriptions e.g. SSE as in-flight requests because they are long-lived
				if opCtx != nil && opCtx.opType != OperationTypeSubscription {
					s.inFlightRequests.Add(1)

					// Counting like this is safe because according to the go http.ServeHTTP documentation
					// the requests is guaranteed to be finished when ServeHTTP returns
					defer s.inFlightRequests.Sub(1)
				}

				handler.ServeHTTP(w, r)
			})
		})

	// Mount built global and custom modules
	// Needs to be mounted after the pre-handler to ensure that the request was parsed and authorized
	httpRouter.Use(s.routerMiddlewares...)

	httpRouter.Post("/", graphqlHandler.ServeHTTP)

	gm.mux = httpRouter

	s.graphMuxes = append(s.graphMuxes, gm)

	return gm, nil
}

func (s *graphServer) buildPubSubConfiguration(ctx context.Context, engineConfig *nodev1.EngineConfiguration, routerEngineCfg *RouterEngineConfiguration) error {

	datasourceConfigurations := engineConfig.GetDatasourceConfigurations()
	for _, datasourceConfiguration := range datasourceConfigurations {
		if datasourceConfiguration.CustomEvents == nil {
			continue
		}

		for _, eventConfiguration := range datasourceConfiguration.GetCustomEvents().GetNats() {

			providerID := eventConfiguration.EngineEventConfiguration.GetProviderId()
			// if this source name's provider has already been initiated, do not try to initiate again
			_, ok := s.pubSubProviders.nats[providerID]
			if ok {
				continue
			}

			for _, eventSource := range routerEngineCfg.Events.Providers.Nats {
				if eventSource.ID == eventConfiguration.EngineEventConfiguration.GetProviderId() {
					options, err := buildNatsOptions(eventSource, s.logger)
					if err != nil {
						return fmt.Errorf("failed to build options for Nats provider with ID \"%s\": %w", providerID, err)
					}
					natsConnection, err := nats.Connect(eventSource.URL, options...)
					if err != nil {
						return fmt.Errorf("failed to create connection for Nats provider with ID \"%s\": %w", providerID, err)
					}
					js, err := jetstream.New(natsConnection)
					if err != nil {
						return err
					}

					s.pubSubProviders.nats[providerID] = pubsubNats.NewConnector(s.logger, natsConnection, js).New(ctx)

					break
				}
			}
		}

		for _, eventConfiguration := range datasourceConfiguration.GetCustomEvents().GetKafka() {

			providerID := eventConfiguration.EngineEventConfiguration.GetProviderId()
			// if this source name's provider has already been initiated, do not try to initiate again
			_, ok := s.pubSubProviders.kafka[providerID]
			if ok {
				continue
			}

			for _, eventSource := range routerEngineCfg.Events.Providers.Kafka {

				if eventSource.ID == providerID {
					options, err := buildKafkaOptions(eventSource)
					if err != nil {
						return fmt.Errorf("failed to build options for Kafka provider with ID \"%s\": %w", providerID, err)
					}
					ps, err := kafka.NewConnector(s.logger, options)
					if err != nil {
						return fmt.Errorf("failed to create connection for Kafka provider with ID \"%s\": %w", providerID, err)
					}

					s.pubSubProviders.kafka[providerID] = ps.New(ctx)

					break
				}
			}
		}

	}

	return nil
}

// wait waits for all in-flight requests to finish. Similar to http.Server.Shutdown we wait in intervals + jitter
// to make the shutdown process more efficient.
func (s *graphServer) wait(ctx context.Context) error {
	b := backoff.New(500*time.Millisecond, time.Millisecond)
	defer b.Reset()

	timer := time.NewTimer(b.Duration())
	defer timer.Stop()

	for {
		if s.inFlightRequests.Load() == 0 {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
			timer.Reset(b.Duration())
		}
	}
}

// Shutdown gracefully shutdown the server and waits for all in-flight requests to finish.
// After all requests are done, it will shut down the metric store and runtime metrics.
// Shutdown does cancel the context after all non-hijacked requests such as WebSockets has been handled.
func (s *graphServer) Shutdown(ctx context.Context) error {

	// Cancel the context after the graceful shutdown is done
	// to clean up resources like websocket connections, pools, etc.
	defer s.cancelFunc()

	s.logger.Debug("Shutdown of graph server initiated. Waiting for in-flight requests to finish.",
		zap.String("config_version", s.baseRouterConfigVersion),
	)

	var finalErr error

	// Wait for all in-flight requests to finish.
	// In the worst case, we wait until the context is done or all requests has timed out.
	if err := s.wait(ctx); err != nil {
		s.logger.Error("Failed to wait for in-flight requests to finish", zap.Error(err))
		finalErr = errors.Join(finalErr, err)
	}

	s.logger.Debug("Shutdown of graph server resources",
		zap.String("grace_period", s.routerGracePeriod.String()),
		zap.String("config_version", s.baseRouterConfigVersion),
	)

	// Ensure that we don't wait indefinitely for shutdown
	if s.routerGracePeriod > 0 {
		newCtx, cancel := context.WithTimeout(ctx, s.routerGracePeriod)
		defer cancel()

		ctx = newCtx
	}

	if s.metricStore != nil {
		if err := s.metricStore.Shutdown(ctx); err != nil {
			s.logger.Error("Failed to shutdown metric store", zap.Error(err))
			finalErr = errors.Join(finalErr, err)
		}
	}

	if s.runtimeMetrics != nil {
		if err := s.runtimeMetrics.Shutdown(); err != nil {
			s.logger.Error("Failed to shutdown runtime metrics", zap.Error(err))
			finalErr = errors.Join(finalErr, err)
		}
	}

	if s.pubSubProviders != nil {

		s.logger.Debug("Shutting down pubsub providers")

		for _, pubSub := range s.pubSubProviders.nats {
			if p, ok := pubSub.(pubsub.Lifecycle); ok {
				if err := p.Shutdown(ctx); err != nil {
					s.logger.Error("Failed to shutdown Nats pubsub provider", zap.Error(err))
					finalErr = errors.Join(finalErr, err)
				}
			}
		}
		for _, pubSub := range s.pubSubProviders.kafka {
			if p, ok := pubSub.(pubsub.Lifecycle); ok {
				if err := p.Shutdown(ctx); err != nil {
					s.logger.Error("Failed to shutdown Kafka pubsub provider", zap.Error(err))
					finalErr = errors.Join(finalErr, err)
				}
			}
		}
	}

	// Shutdown all graphs muxes to release resources
	// e.g. planner cache
	for _, mux := range s.graphMuxes {
		mux.Shutdown(ctx)
	}

	return finalErr
}

func configureSubgraphOverwrites(
	engineConfig *nodev1.EngineConfiguration,
	configSubgraphs []*nodev1.Subgraph,
	overrideRoutingURLConfig config.OverrideRoutingURLConfiguration,
	overrides config.OverridesConfiguration,
) ([]Subgraph, error) {
	var (
		err error
	)
	subgraphs := make([]Subgraph, 0, len(configSubgraphs))
	for _, sg := range configSubgraphs {

		subgraph := Subgraph{
			Id:   sg.Id,
			Name: sg.Name,
		}

		// Validate subgraph url. Note that it can be empty if the subgraph is virtual
		subgraph.Url, err = url.Parse(sg.RoutingUrl)
		if err != nil {
			return nil, fmt.Errorf("failed to parse subgraph url '%s': %w", sg.RoutingUrl, err)
		}
		subgraph.UrlString = subgraph.Url.String()

		overrideURL, ok := overrideRoutingURLConfig.Subgraphs[sg.Name]
		overrideSubgraph, overrideSubgraphOk := overrides.Subgraphs[sg.Name]

		var overrideSubscriptionURL string
		var overrideSubscriptionProtocol *common.GraphQLSubscriptionProtocol
		var overrideSubscriptionWebsocketSubprotocol *common.GraphQLWebsocketSubprotocol

		if overrideSubgraphOk {
			if overrideSubgraph.RoutingURL != "" {
				overrideURL = overrideSubgraph.RoutingURL
			}
			if overrideSubgraph.SubscriptionURL != "" {
				overrideSubscriptionURL = overrideSubgraph.SubscriptionURL
				_, err := url.Parse(overrideSubscriptionURL)
				if err != nil {
					return nil, fmt.Errorf("failed to parse override url '%s': %w", overrideSubscriptionURL, err)
				}
			}
			if overrideSubgraph.SubscriptionProtocol != "" {
				switch overrideSubgraph.SubscriptionProtocol {
				case "ws":
					overrideSubscriptionProtocol = common.GraphQLSubscriptionProtocol_GRAPHQL_SUBSCRIPTION_PROTOCOL_WS.Enum()
				case "sse":
					overrideSubscriptionProtocol = common.GraphQLSubscriptionProtocol_GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE.Enum()
				case "sse_post":
					overrideSubscriptionProtocol = common.GraphQLSubscriptionProtocol_GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE_POST.Enum()
				default:
					return nil, fmt.Errorf("invalid subscription protocol '%s'", overrideSubgraph.SubscriptionProtocol)
				}
			}
			if overrideSubgraph.SubscriptionWebsocketSubprotocol != "" {
				switch overrideSubgraph.SubscriptionWebsocketSubprotocol {
				case "graphql-ws":
					overrideSubscriptionWebsocketSubprotocol = common.GraphQLWebsocketSubprotocol_GRAPHQL_WEBSOCKET_SUBPROTOCOL_WS.Enum()
				case "graphql-transport-ws":
					overrideSubscriptionWebsocketSubprotocol = common.GraphQLWebsocketSubprotocol_GRAPHQL_WEBSOCKET_SUBPROTOCOL_TRANSPORT_WS.Enum()
				case "auto":
					overrideSubscriptionWebsocketSubprotocol = common.GraphQLWebsocketSubprotocol_GRAPHQL_WEBSOCKET_SUBPROTOCOL_AUTO.Enum()
				default:
					return nil, fmt.Errorf("invalid subscription websocket subprotocol '%s'", overrideSubgraph.SubscriptionWebsocketSubprotocol)
				}
			}
		}

		// check if the subgraph is overridden
		if ok || overrideSubgraphOk {
			if overrideURL != "" {
				subgraph.Url, err = url.Parse(overrideURL)
				if err != nil {
					return nil, fmt.Errorf("failed to parse override url '%s': %w", overrideURL, err)
				}
				subgraph.UrlString = subgraph.Url.String()
			}

			// Override datasource urls
			for _, conf := range engineConfig.DatasourceConfigurations {
				if conf.Id == sg.Id {
					if overrideURL != "" {
						conf.CustomGraphql.Fetch.Url.StaticVariableContent = overrideURL
						sg.RoutingUrl = overrideURL
					}
					if overrideSubscriptionURL != "" {
						conf.CustomGraphql.Subscription.Url.StaticVariableContent = overrideSubscriptionURL
					}
					if overrideSubscriptionProtocol != nil {
						conf.CustomGraphql.Subscription.Protocol = overrideSubscriptionProtocol
					}
					if overrideSubscriptionWebsocketSubprotocol != nil {
						conf.CustomGraphql.Subscription.WebsocketSubprotocol = overrideSubscriptionWebsocketSubprotocol
					}

					break
				}
			}
		}

		subgraphs = append(subgraphs, subgraph)
	}

	return subgraphs, nil
}
