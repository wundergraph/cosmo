package core

import (
	"context"
	"crypto/ecdsa"
	"errors"
	"fmt"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/common"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/requestlogger"
	"github.com/wundergraph/cosmo/router/internal/retrytransport"
	"github.com/wundergraph/cosmo/router/pkg/config"
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
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"net/http"
	"net/url"
	"strings"
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
		BaseURL() string
	}

	EnginePubSubProviders struct {
		nats  map[string]pubsub_datasource.NatsPubSub
		kafka map[string]pubsub_datasource.KafkaPubSub
	}

	// server is the swappable implementation of the Router which is a HTTP server with middlewares.
	// Everytime a schema is updated, a new server is created. For feature flags, a separate mux is created and
	// dynamically switched based on the feature flag header or cookie. All server fields are shared between all.
	server struct {
		Config
		httpServer         *http.Server
		metricStore        rmetric.Store
		healthChecks       health.Checker
		pubSubProviders    *EnginePubSubProviders
		websocketStats     WebSocketsStatistics
		playgroundHandler  func(http.Handler) http.Handler
		publicKey          *ecdsa.PublicKey
		executionPlanCache ExecutionPlanCache
		executionTransport *http.Transport
		baseOtelAttributes []attribute.KeyValue
	}
)

func (s *server) buildMultiGraphHandler(ctx context.Context, baseMux *chi.Mux, featureFlagConfigs map[string]*nodev1.FeatureFlagRouterExecutionConfig) (http.HandlerFunc, error) {

	featureFlagToMux := make(map[string]*chi.Mux, len(featureFlagConfigs))

	// Build all the muxes for the feature flags in serial to avoid any race conditions
	for featureFlagName, executionConfig := range featureFlagConfigs {
		r, err := s.buildMux(ctx, featureFlagName, executionConfig.GetVersion(), executionConfig.GetEngineConfig(), executionConfig.Subgraphs)
		if err != nil {
			return nil, fmt.Errorf("failed to build mux for feature flag '%s': %w", featureFlagName, err)
		}
		featureFlagToMux[featureFlagName] = r
	}

	return func(w http.ResponseWriter, r *http.Request) {

		// Extract the feature flag and run the corresponding mux
		// 1. From the request header
		// 2. From the cookie

		ff := strings.TrimSpace(r.Header.Get(featureFlagHeader))
		if mux, ok := featureFlagToMux[ff]; ok {
			mux.ServeHTTP(w, r)
			return
		}

		fc, err := r.Cookie(featureFlagCookie)
		if err == nil && fc != nil {
			if mux, ok := featureFlagToMux[strings.TrimSpace(fc.Value)]; ok {
				mux.ServeHTTP(w, r)
				return
			}
		}

		// Fall back to the base composition
		baseMux.ServeHTTP(w, r)
	}, nil
}

func (s *server) buildMux(ctx context.Context,
	featureFlagName string,
	routerConfigVersion string,
	engineConfig *nodev1.EngineConfiguration,
	configSubgraphs []*nodev1.Subgraph) (*chi.Mux, error) {

	httpRouter := chi.NewRouter()

	subgraphs, err := configureSubgraphOverwrites(
		engineConfig,
		configSubgraphs,
		s.overrideRoutingURLConfiguration,
		s.overrides,
	)
	if err != nil {
		return nil, err
	}

	routerMetrics := NewRouterMetrics(&routerMetricsConfig{
		metrics:             s.metricStore,
		gqlMetricsExporter:  s.gqlMetricsExporter,
		exportEnabled:       s.graphqlMetricsConfig.Enabled,
		routerConfigVersion: routerConfigVersion,
		logger:              s.logger,
	})

	baseOtelAttributes := append(s.baseOtelAttributes, []attribute.KeyValue{
		otel.WgRouterConfigVersion.String(routerConfigVersion),
	}...)

	if featureFlagName != "" {
		baseOtelAttributes = append(baseOtelAttributes, otel.WgFeatureFlag.String(featureFlagName))
	}

	var traceHandler *rtrace.Middleware
	if s.traceConfig.Enabled {
		spanStartOptions := []oteltrace.SpanStartOption{
			oteltrace.WithAttributes(baseOtelAttributes...),
			oteltrace.WithAttributes(
				otel.RouterServerAttribute,
				otel.WgRouterRootSpan.Bool(true),
			),
		}

		if s.traceConfig.WithNewRoot {
			spanStartOptions = append(spanStartOptions, oteltrace.WithNewRoot())
		}

		traceHandler = rtrace.NewMiddleware(
			s.traceConfig.SpanAttributesMapper,
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

	// Enrich the request context with the subgraphs information
	httpRouter.Use(func(h http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r = r.WithContext(withSubgraphs(r.Context(), subgraphs))
			h.ServeHTTP(w, r)
		})
	})

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
			AttributesMapper:              s.traceConfig.SpanAttributesMapper,
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

	operationParser := NewOperationParser(OperationParserOptions{
		Executor:                executor,
		MaxOperationSizeInBytes: int64(s.routerTrafficConfig.MaxRequestBodyBytes),
		PersistentOpClient:      s.cdnPersistentOpClient,
	})
	operationPlanner := NewOperationPlanner(executor, s.executionPlanCache)

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
		WebSocketStats:                         s.websocketStats,
		TracerProvider:                         s.tracerProvider,
		Authorizer:                             NewCosmoAuthorizer(authorizerOptions),
		SubgraphErrorPropagation:               s.subgraphErrorPropagation,
		EngineLoaderHooks:                      NewEngineRequestHooks(s.metricStore, s.traceConfig.SpanAttributesMapper),
		SpanAttributesMapper:                   s.traceConfig.SpanAttributesMapper,
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
		OperationProcessor:          operationParser,
		Planner:                     operationPlanner,
		AccessController:            s.accessController,
		OperationBlocker:            operationBlocker,
		RouterPublicKey:             s.publicKey,
		EnableRequestTracing:        s.engineExecutionConfiguration.EnableRequestTracing,
		DevelopmentMode:             s.developmentMode,
		TracerProvider:              s.tracerProvider,
		FlushTelemetryAfterResponse: s.awsLambda,
		TraceExportVariables:        s.traceConfig.ExportGraphQLVariables.Enabled,
		SpanAttributesMapper:        s.traceConfig.SpanAttributesMapper,
	})

	if s.webSocketConfiguration != nil && s.webSocketConfiguration.Enabled {
		wsMiddleware := NewWebsocketMiddleware(ctx, WebsocketMiddlewareOptions{
			OperationProcessor:         operationParser,
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

	httpRouter.Use(graphqlPreHandler.Handler)

	// Mount built global and custom modules
	// Needs to be mounted after the pre-handler to ensure that the request was parsed and authorized
	httpRouter.Use(s.routerMiddlewares...)

	httpRouter.Post("/", graphqlHandler.ServeHTTP)

	return httpRouter, nil
}

func (s *server) buildPubSubConfiguration(ctx context.Context, engineConfig *nodev1.EngineConfiguration, routerEngineCfg *RouterEngineConfiguration) error {

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

// Shutdown gracefully shutdown the server.
func (s *server) Shutdown(ctx context.Context) error {

	s.healthChecks.SetReady(false)

	s.logger.Info("Gracefully shutting down the router ...",
		zap.String("grace_period", s.gracePeriod.String()),
	)

	var finalErr error

	if s.httpServer != nil {
		if err := s.httpServer.Shutdown(ctx); err != nil {
			s.logger.Error("Failed to shutdown HTTP server", zap.Error(err))
			finalErr = errors.Join(finalErr, err)
		}
	}

	if err := s.metricStore.Flush(ctx); err != nil {
		s.logger.Error("Failed to flush metric store", zap.Error(err))
		finalErr = errors.Join(finalErr, err)
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

	return finalErr
}

func (s *server) HealthChecks() health.Checker {
	return s.healthChecks
}

func (s *server) HttpServer() *http.Server {
	return s.httpServer
}

func (s *server) BaseURL() string {
	return s.baseURL
}

// listenAndServe starts the server and blocks until the server is shutdown.
func (s *server) listenAndServe() error {
	if s.tlsConfig != nil && s.tlsConfig.Enabled {
		// Leave the cert and key empty to use the default ones
		if err := s.httpServer.ListenAndServeTLS("", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	} else {
		if err := s.httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	}
	return nil
}

func configureSubgraphOverwrites(
	engineConfig *nodev1.EngineConfiguration,
	configSubgraphs []*nodev1.Subgraph,
	overrideRoutingURLConfig config.OverrideRoutingURLConfiguration,
	overrides config.OverridesConfiguration,
) ([]Subgraph, error) {
	subgraphs := make([]Subgraph, 0, len(configSubgraphs))
	for _, sg := range configSubgraphs {

		subgraph := Subgraph{
			Id:   sg.Id,
			Name: sg.Name,
		}

		// Validate subgraph url. Note that it can be empty if the subgraph is virtual
		parsedURL, err := url.Parse(sg.RoutingUrl)
		if err != nil {
			return nil, fmt.Errorf("failed to parse subgraph url '%s': %w", sg.RoutingUrl, err)
		}

		subgraph.Url = parsedURL

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
				parsedURL, err := url.Parse(overrideURL)
				if err != nil {
					return nil, fmt.Errorf("failed to parse override url '%s': %w", overrideURL, err)
				}

				subgraph.Url = parsedURL
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
