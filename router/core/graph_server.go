package core

import (
	"context"
	"crypto/ecdsa"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/cloudflare/backoff"
	"github.com/dgraph-io/ristretto"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/golang-jwt/jwt/v5"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	oteltrace "go.opentelemetry.io/otel/trace"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"golang.org/x/exp/maps"

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
	"github.com/wundergraph/cosmo/router/pkg/logging"
	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/pubsub"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
	pubsubNats "github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
	"github.com/wundergraph/cosmo/router/pkg/statistics"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
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
		engineStats             statistics.EngineStatistics
		playgroundHandler       func(http.Handler) http.Handler
		publicKey               *ecdsa.PublicKey
		executionTransport      *http.Transport
		executionTransportProxy ProxyFunc
		baseOtelAttributes      []attribute.KeyValue
		baseRouterConfigVersion string
		mux                     *chi.Mux
		// inFlightRequests is used to track the number of requests currently being processed
		// does not include websocket (hijacked) connections
		inFlightRequests        *atomic.Uint64
		graphMuxList            []*graphMux
		graphMuxListLock        sync.Mutex
		runtimeMetrics          *rmetric.RuntimeMetrics
		otlpEngineMetrics       *rmetric.EngineMetrics
		prometheusEngineMetrics *rmetric.EngineMetrics
		hostName                string
		routerListenAddr        string
	}
)

// newGraphServer creates a new server instance.
func newGraphServer(ctx context.Context, r *Router, routerConfig *nodev1.RouterConfig, proxy ProxyFunc) (*graphServer, error) {

	ctx, cancel := context.WithCancel(ctx)
	s := &graphServer{
		context:                 ctx,
		cancelFunc:              cancel,
		Config:                  &r.Config,
		engineStats:             r.EngineStats,
		executionTransport:      newHTTPTransport(r.subgraphTransportOptions.TransportTimeoutOptions, proxy),
		executionTransportProxy: proxy,
		playgroundHandler:       r.playgroundHandler,
		baseRouterConfigVersion: routerConfig.GetVersion(),
		inFlightRequests:        &atomic.Uint64{},
		graphMuxList:            make([]*graphMux, 0, 1),
		routerListenAddr:        r.listenAddr,
		hostName:                r.hostName,
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
		s.runtimeMetrics = rmetric.NewRuntimeMetrics(
			s.logger,
			s.otlpMeterProvider,
			// We track runtime metrics with base router config version
			append([]attribute.KeyValue{
				otel.WgRouterConfigVersion.String(s.baseRouterConfigVersion),
			}, baseOtelAttributes...),
			s.processStartTime,
		)

		// Start runtime metrics
		if err := s.runtimeMetrics.Start(); err != nil {
			return nil, err
		}
	}

	if err := s.setupEngineStatistics(); err != nil {
		return nil, fmt.Errorf("failed to setup engine statistics: %w", err)
	}

	if s.registrationInfo != nil {
		publicKey, err := jwt.ParseECPublicKeyFromPEM([]byte(s.registrationInfo.GetGraphPublicKey()))
		if err != nil {
			return nil, fmt.Errorf("failed to parse router public key: %w", err)
		}
		s.publicKey = publicKey
	}

	httpRouter := chi.NewRouter()

	/**
	* Middlewares
	 */

	// This recovery handler is used for everything before the graph mux to ensure that
	// we can recover from panics and log them properly.
	httpRouter.Use(recoveryhandler.New(recoveryhandler.WithLogHandler(func(w http.ResponseWriter, r *http.Request, err any) {
		s.logger.Error("[Recovery from panic]",
			zap.Any("error", err),
		)
	})))

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

	/**
	* A group where we can selectively apply middlewares to the graphql endpoint
	 */
	httpRouter.Group(func(cr chi.Router) {
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

// setupEngineStatistics creates the engine statistics for the server.
// It creates the OTLP and Prometheus metrics for the engine statistics.
func (s *graphServer) setupEngineStatistics() (err error) {
	// We only include the base router config version in the attributes for the engine statistics.
	// Same approach is used for the runtime metrics.
	baseAttributes := append([]attribute.KeyValue{
		otel.WgRouterConfigVersion.String(s.baseRouterConfigVersion)}, s.baseOtelAttributes...)

	s.otlpEngineMetrics, err = rmetric.NewEngineMetrics(
		s.logger,
		baseAttributes,
		s.otlpMeterProvider,
		s.engineStats,
		&s.metricConfig.OpenTelemetry.EngineStats,
	)

	if err != nil {
		return err
	}

	s.prometheusEngineMetrics, err = rmetric.NewEngineMetrics(
		s.logger,
		baseAttributes,
		s.promMeterProvider,
		s.engineStats,
		&s.metricConfig.Prometheus.EngineStats,
	)

	if err != nil {
		return err
	}

	return nil
}

type graphMux struct {
	mux                        *chi.Mux
	planCache                  *ristretto.Cache[uint64, *planWithMetaData]
	persistedOperationCache    *ristretto.Cache[uint64, NormalizationCacheEntry]
	normalizationCache         *ristretto.Cache[uint64, NormalizationCacheEntry]
	complexityCalculationCache *ristretto.Cache[uint64, ComplexityCacheEntry]
	validationCache            *ristretto.Cache[uint64, bool]
	operationHashCache         *ristretto.Cache[uint64, string]
	accessLogsFileLogger       *logging.BufferedLogger
	metricStore                rmetric.Store
	prometheusCacheMetrics     *rmetric.CacheMetrics
	otelCacheMetrics           *rmetric.CacheMetrics
}

// buildOperationCaches creates the caches for the graph mux.
// The caches are created based on the engine configuration.
func (s *graphMux) buildOperationCaches(srv *graphServer) (computeSha256 bool, err error) {

	// We create a new execution plan cache for each operation planner which is coupled to
	// the specific engine configuration. This is necessary because otherwise we would return invalid plans.
	//
	// when an execution plan was generated, which can be quite expensive, we want to cache it
	// this means that we can hash the input and cache the generated plan
	// the next time we get the same input, we can just return the cached plan
	// the engine is smart enough to first do normalization and then hash the input
	// this means that we can cache the normalized input and don't have to worry about
	// different inputs that would generate the same execution plan

	if srv.engineExecutionConfiguration.ExecutionPlanCacheSize > 0 {
		planCacheConfig := &ristretto.Config[uint64, *planWithMetaData]{
			Metrics:            srv.metricConfig.OpenTelemetry.GraphqlCache || srv.metricConfig.Prometheus.GraphqlCache,
			MaxCost:            srv.engineExecutionConfiguration.ExecutionPlanCacheSize,
			NumCounters:        srv.engineExecutionConfiguration.ExecutionPlanCacheSize * 10,
			IgnoreInternalCost: true,
			BufferItems:        64,
		}
		s.planCache, err = ristretto.NewCache[uint64, *planWithMetaData](planCacheConfig)
		if err != nil {
			return computeSha256, fmt.Errorf("failed to create planner cache: %w", err)
		}
	}

	if srv.engineExecutionConfiguration.EnablePersistedOperationsCache || srv.automaticPersistedQueriesConfig.Enabled {
		cacheSize := int64(1024)
		persistedOperationCacheConfig := &ristretto.Config[uint64, NormalizationCacheEntry]{
			MaxCost:            cacheSize,
			NumCounters:        cacheSize * 10,
			IgnoreInternalCost: true,
			BufferItems:        64,
			Metrics:            true,
		}

		s.persistedOperationCache, _ = ristretto.NewCache[uint64, NormalizationCacheEntry](persistedOperationCacheConfig)
	}

	if srv.engineExecutionConfiguration.EnableNormalizationCache && srv.engineExecutionConfiguration.NormalizationCacheSize > 0 {
		normalizationCacheConfig := &ristretto.Config[uint64, NormalizationCacheEntry]{
			Metrics:            srv.metricConfig.OpenTelemetry.GraphqlCache || srv.metricConfig.Prometheus.GraphqlCache,
			MaxCost:            srv.engineExecutionConfiguration.NormalizationCacheSize,
			NumCounters:        srv.engineExecutionConfiguration.NormalizationCacheSize * 10,
			IgnoreInternalCost: true,
			BufferItems:        64,
		}
		s.normalizationCache, err = ristretto.NewCache[uint64, NormalizationCacheEntry](normalizationCacheConfig)
		if err != nil {
			return computeSha256, fmt.Errorf("failed to create normalization cache: %w", err)
		}
	}

	if srv.engineExecutionConfiguration.EnableValidationCache && srv.engineExecutionConfiguration.ValidationCacheSize > 0 {
		validationCacheConfig := &ristretto.Config[uint64, bool]{
			Metrics:            srv.metricConfig.OpenTelemetry.GraphqlCache || srv.metricConfig.Prometheus.GraphqlCache,
			MaxCost:            srv.engineExecutionConfiguration.ValidationCacheSize,
			NumCounters:        srv.engineExecutionConfiguration.ValidationCacheSize * 10,
			IgnoreInternalCost: true,
			BufferItems:        64,
		}
		s.validationCache, err = ristretto.NewCache[uint64, bool](validationCacheConfig)
		if err != nil {
			return computeSha256, fmt.Errorf("failed to create validation cache: %w", err)
		}
	}

	if srv.securityConfiguration.ComplexityCalculationCache != nil && srv.securityConfiguration.ComplexityCalculationCache.Enabled && srv.securityConfiguration.ComplexityCalculationCache.CacheSize > 0 {
		complexityCalculationCacheConfig := &ristretto.Config[uint64, ComplexityCacheEntry]{
			Metrics:            srv.metricConfig.OpenTelemetry.GraphqlCache || srv.metricConfig.Prometheus.GraphqlCache,
			MaxCost:            srv.securityConfiguration.ComplexityCalculationCache.CacheSize,
			NumCounters:        srv.securityConfiguration.ComplexityCalculationCache.CacheSize * 10,
			IgnoreInternalCost: true,
			BufferItems:        64,
		}
		s.complexityCalculationCache, err = ristretto.NewCache[uint64, ComplexityCacheEntry](complexityCalculationCacheConfig)
		if err != nil {
			return computeSha256, fmt.Errorf("failed to create query depth cache: %w", err)
		}
	}

	// Currently, we only support custom attributes from the context for OTLP metrics
	if len(srv.metricConfig.Attributes) > 0 {
		for _, customAttribute := range srv.metricConfig.Attributes {
			if customAttribute.ValueFrom != nil && customAttribute.ValueFrom.ContextField == ContextFieldOperationSha256 {
				computeSha256 = true
				break
			}
		}
	} else if srv.accessLogsConfig != nil {
		for _, customAttribute := range append(srv.accessLogsConfig.Attributes, srv.accessLogsConfig.SubgraphAttributes...) {
			if customAttribute.ValueFrom != nil && customAttribute.ValueFrom.ContextField == ContextFieldOperationSha256 {
				computeSha256 = true
				break
			}
		}
	}

	if computeSha256 {
		operationHashCacheConfig := &ristretto.Config[uint64, string]{
			MaxCost:            srv.engineExecutionConfiguration.OperationHashCacheSize,
			NumCounters:        srv.engineExecutionConfiguration.OperationHashCacheSize * 10,
			IgnoreInternalCost: true,
			BufferItems:        64,
			Metrics:            srv.metricConfig.OpenTelemetry.GraphqlCache || srv.metricConfig.Prometheus.GraphqlCache,
		}
		s.operationHashCache, err = ristretto.NewCache[uint64, string](operationHashCacheConfig)
		if err != nil {
			return computeSha256, fmt.Errorf("failed to create operation hash cache: %w", err)
		}
	}

	return computeSha256, nil
}

// configureCacheMetrics sets up the cache metrics for this mux if enabled in the config.
func (s *graphMux) configureCacheMetrics(srv *graphServer, baseOtelAttributes []attribute.KeyValue) error {
	if srv.metricConfig.OpenTelemetry.GraphqlCache {
		cacheMetrics, err := rmetric.NewCacheMetrics(
			srv.logger,
			baseOtelAttributes,
			srv.otlpMeterProvider)

		if err != nil {
			return fmt.Errorf("failed to create cache metrics for OTLP: %w", err)
		}

		s.otelCacheMetrics = cacheMetrics
	}

	if srv.metricConfig.Prometheus.GraphqlCache {
		cacheMetrics, err := rmetric.NewCacheMetrics(
			srv.logger,
			baseOtelAttributes,
			srv.promMeterProvider)

		if err != nil {
			return fmt.Errorf("failed to create cache metrics for Prometheus: %w", err)
		}

		s.prometheusCacheMetrics = cacheMetrics
	}

	var metricInfos []rmetric.CacheMetricInfo

	if s.planCache != nil {
		metricInfos = append(metricInfos, rmetric.NewCacheMetricInfo("plan", srv.engineExecutionConfiguration.ExecutionPlanCacheSize, s.planCache.Metrics))
	}

	if s.normalizationCache != nil {
		metricInfos = append(metricInfos, rmetric.NewCacheMetricInfo("query_normalization", srv.engineExecutionConfiguration.NormalizationCacheSize, s.normalizationCache.Metrics))
	}

	if s.persistedOperationCache != nil {
		metricInfos = append(metricInfos, rmetric.NewCacheMetricInfo("persisted_query_normalization", 1024, s.persistedOperationCache.Metrics))
	}

	if s.validationCache != nil {
		metricInfos = append(metricInfos, rmetric.NewCacheMetricInfo("validation", srv.engineExecutionConfiguration.ValidationCacheSize, s.validationCache.Metrics))
	}

	if s.operationHashCache != nil {
		metricInfos = append(metricInfos, rmetric.NewCacheMetricInfo("query_hash", srv.engineExecutionConfiguration.OperationHashCacheSize, s.operationHashCache.Metrics))
	}

	if s.otelCacheMetrics != nil {
		if err := s.otelCacheMetrics.RegisterObservers(metricInfos); err != nil {
			return fmt.Errorf("failed to register observer for OTLP cache metrics: %w", err)
		}
	}

	if s.prometheusCacheMetrics != nil {
		if err := s.prometheusCacheMetrics.RegisterObservers(metricInfos); err != nil {
			return fmt.Errorf("failed to register observer for Prometheus cache metrics: %w", err)
		}
	}

	return nil
}

func (s *graphMux) Shutdown(ctx context.Context) error {

	var err error

	if s.planCache != nil {
		s.planCache.Close()
	}

	if s.persistedOperationCache != nil {
		s.persistedOperationCache.Close()
	}

	if s.normalizationCache != nil {
		s.normalizationCache.Close()
	}

	if s.validationCache != nil {
		s.validationCache.Close()
	}

	if s.complexityCalculationCache != nil {
		s.complexityCalculationCache.Close()
	}

	if s.accessLogsFileLogger != nil {
		if aErr := s.accessLogsFileLogger.Close(); aErr != nil {
			err = errors.Join(err, aErr)
		}
	}

	if s.otelCacheMetrics != nil {
		if aErr := s.otelCacheMetrics.Shutdown(); aErr != nil {
			err = errors.Join(err, aErr)
		}
	}

	if s.prometheusCacheMetrics != nil {
		if aErr := s.prometheusCacheMetrics.Shutdown(); aErr != nil {
			err = errors.Join(err, aErr)
		}
	}

	if s.metricStore != nil {
		if aErr := s.metricStore.Shutdown(ctx); aErr != nil {
			err = errors.Join(err, aErr)
		}
	}

	return err
}

// buildGraphMux creates a new graph mux with the given feature flags and engine configuration.
// It also creates a new execution plan cache for the mux. The mux is not mounted on the server.
// The mux is appended internally to the graph server's list of muxes to clean up later when the server is swapped.
func (s *graphServer) buildGraphMux(ctx context.Context,
	featureFlagName string,
	routerConfigVersion string,
	engineConfig *nodev1.EngineConfiguration,
	configSubgraphs []*nodev1.Subgraph) (*graphMux, error) {

	gm := &graphMux{
		metricStore: rmetric.NewNoopMetrics(),
	}

	httpRouter := chi.NewRouter()

	baseOtelAttributes := append([]attribute.KeyValue{otel.WgRouterConfigVersion.String(routerConfigVersion)}, s.baseOtelAttributes...)

	if featureFlagName != "" {
		baseOtelAttributes = append(baseOtelAttributes, otel.WgFeatureFlag.String(featureFlagName))
	}

	metricsEnabled := s.metricConfig.IsEnabled()

	// we only enable the attribute mapper if we are not using the default cloud exporter
	enableAttributeMapper := !(s.metricConfig.IsUsingCloudExporter || rmetric.IsDefaultCloudExporterConfigured(s.metricConfig.OpenTelemetry.Exporters))

	// We might want to remap or exclude known attributes based on the configuration for metrics
	mapper := newAttributeMapper(enableAttributeMapper, s.metricConfig.Attributes)
	baseMetricAttributes := mapper.mapAttributes(baseOtelAttributes)
	// Prometheus metricStore rely on OTLP metricStore
	if metricsEnabled {
		m, err := rmetric.NewStore(
			rmetric.WithPromMeterProvider(s.promMeterProvider),
			rmetric.WithOtlpMeterProvider(s.otlpMeterProvider),
			rmetric.WithBaseAttributes(baseMetricAttributes),
			rmetric.WithLogger(s.logger),
			rmetric.WithProcessStartTime(s.processStartTime),
			rmetric.WithCardinalityLimit(rmetric.DefaultCardinalityLimit),
		)
		if err != nil {
			return nil, fmt.Errorf("failed to create metric handler: %w", err)
		}

		gm.metricStore = m
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

	computeSha256, err := gm.buildOperationCaches(s)
	if err != nil {
		return nil, err
	}

	if err = gm.configureCacheMetrics(s, baseMetricAttributes); err != nil {
		return nil, err
	}

	metrics := NewRouterMetrics(&routerMetricsConfig{
		metrics:             gm.metricStore,
		gqlMetricsExporter:  s.gqlMetricsExporter,
		exportEnabled:       s.graphqlMetricsConfig.Enabled,
		routerConfigVersion: routerConfigVersion,
		logger:              s.logger,
	})

	baseLogFields := []zapcore.Field{
		zap.String("config_version", routerConfigVersion),
	}

	if featureFlagName != "" {
		baseLogFields = append(baseLogFields, zap.String("feature_flag", featureFlagName))
	}

	// Currently, we only support custom attributes from the context for OTLP metrics
	b := buildAttributesMap(s.metricConfig.Attributes)

	// Enrich the request context with the subgraph information which is required for custom modules and tracing
	subgraphResolver := NewSubgraphResolver(subgraphs)
	httpRouter.Use(func(h http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			requestLogger := s.logger.With(logging.WithRequestID(middleware.GetReqID(r.Context())))
			r = r.WithContext(withSubgraphResolver(r.Context(), subgraphResolver))

			reqContext := buildRequestContext(requestContextOptions{
				operationContext:    nil,
				requestLogger:       requestLogger,
				metricSetAttributes: b,
				metricsEnabled:      metricsEnabled,
				traceEnabled:        s.traceConfig.Enabled,
				mapper:              mapper,
				w:                   w,
				r:                   r,
			})

			r = r.WithContext(withRequestContext(r.Context(), reqContext))

			// For debugging purposes, we can validate from what version of the config the request is coming from
			if s.setConfigVersionHeader {
				w.Header().Set("X-Router-Config-Version", routerConfigVersion)
			}

			h.ServeHTTP(w, r)
		})
	})

	var recoverOpts []recoveryhandler.Option

	// If we have no access logger configured, we log the panic in the recovery handler to avoid losing the panic information
	if s.accessLogsConfig == nil {
		recoverOpts = append(recoverOpts, recoveryhandler.WithLogHandler(func(w http.ResponseWriter, r *http.Request, err any) {
			reqContext := getRequestContext(r.Context())
			if reqContext != nil {
				reqContext.logger.Error("[Recovery from panic]",
					zap.Any("error", err),
				)
			}
		}))
	}

	recoveryHandler := recoveryhandler.New(recoverOpts...)

	httpRouter.Use(recoveryHandler)

	/**
	* Initialize base attributes from headers and other sources
	 */

	var commonAttrRequestMapper func(r *http.Request) []attribute.KeyValue

	if len(s.telemetryAttributes) > 0 {
		// Common attributes across traces and metrics
		commonAttrRequestMapper = buildHeaderAttributesMapper(s.telemetryAttributes)
	}

	var metricAttrRequestMapper func(r *http.Request) []attribute.KeyValue

	// Metric attributes are only used for OTLP metrics and Prometheus metrics
	if s.metricConfig.IsEnabled() {
		metricAttrRequestMapper = buildHeaderAttributesMapper(s.metricConfig.Attributes)
	}

	httpRouter.Use(func(h http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

			reqContext := getRequestContext(r.Context())

			reqContext.telemetry.addCommonTraceAttribute(baseOtelAttributes...)
			reqContext.telemetry.addCommonTraceAttribute(otel.WgRouterConfigVersion.String(routerConfigVersion))

			if commonAttrRequestMapper != nil {
				reqContext.telemetry.addCommonAttribute(commonAttrRequestMapper(r)...)
			}
			if metricAttrRequestMapper != nil {
				reqContext.telemetry.addMetricAttribute(metricAttrRequestMapper(r)...)
			}

			h.ServeHTTP(w, r)
		})
	})

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

		middlewareOptions := []otelhttp.Option{
			otelhttp.WithSpanOptions(spanStartOptions...),
			otelhttp.WithFilter(rtrace.CommonRequestFilter),
			otelhttp.WithFilter(rtrace.PrefixRequestFilter(
				[]string{s.healthCheckPath, s.readinessCheckPath, s.livenessCheckPath}),
			),
			// Disable built-in metricStore through NoopMeterProvider
			otelhttp.WithMeterProvider(sdkmetric.NewMeterProvider()),
			otelhttp.WithSpanNameFormatter(SpanNameFormatter),
			otelhttp.WithTracerProvider(s.tracerProvider),
		}

		if s.tracePropagators != nil {
			middlewareOptions = append(middlewareOptions, otelhttp.WithPropagators(s.tracePropagators))
		}

		traceHandler := rtrace.NewMiddleware(
			rtrace.WithTracePreHandler(
				func(r *http.Request, w http.ResponseWriter) {
					reqContext := getRequestContext(r.Context())
					traceID := rtrace.GetTraceID(r.Context())
					requestLogger := reqContext.Logger().With(logging.WithTraceID(traceID))

					reqContext.logger = requestLogger

					span := oteltrace.SpanFromContext(r.Context())
					span.SetAttributes(reqContext.telemetry.traceAttrs...)

					// Set the trace ID in the response header
					if s.traceConfig.ResponseTraceHeader.Enabled {
						w.Header().Set(s.traceConfig.ResponseTraceHeader.HeaderName, traceID)
					}
				}),
			rtrace.WithOtelHttp(middlewareOptions...),
		)

		httpRouter.Use(traceHandler.Handler)
	}

	var subgraphAccessLogger *requestlogger.SubgraphAccessLogger
	if s.accessLogsConfig != nil && s.accessLogsConfig.Logger != nil {
		requestLoggerOpts := []requestlogger.Option{
			requestlogger.WithDefaultOptions(),
			requestlogger.WithNoTimeField(),
			requestlogger.WithFields(baseLogFields...),
			requestlogger.WithAttributes(s.accessLogsConfig.Attributes),
			requestlogger.WithFieldsHandler(AccessLogsFieldHandler),
		}

		var ipAnonConfig *requestlogger.IPAnonymizationConfig
		if s.ipAnonymization.Enabled {
			ipAnonConfig = &requestlogger.IPAnonymizationConfig{
				Enabled: s.ipAnonymization.Enabled,
				Method:  requestlogger.IPAnonymizationMethod(s.ipAnonymization.Method),
			}
			requestLoggerOpts = append(requestLoggerOpts, requestlogger.WithAnonymization(ipAnonConfig))
		}

		requestLogger := requestlogger.New(
			s.accessLogsConfig.Logger,
			requestLoggerOpts...,
		)
		httpRouter.Use(requestLogger)

		if s.accessLogsConfig.SubgraphEnabled {
			subgraphAccessLogger = requestlogger.NewSubgraphAccessLogger(
				s.accessLogsConfig.Logger,
				requestlogger.SubgraphOptions{
					IPAnonymizationConfig: ipAnonConfig,
					FieldsHandler:         AccessLogsFieldHandler,
					Fields:                baseLogFields,
					Attributes:            s.accessLogsConfig.SubgraphAttributes,
				})
		}
	}

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
		introspection:  s.introspection,
		baseURL:        s.baseURL,
		transport:      s.executionTransport,
		logger:         s.logger,
		trackUsageInfo: s.graphqlMetricsConfig.Enabled,
		transportOptions: &TransportOptions{
			Proxy:                    s.executionTransportProxy,
			SubgraphTransportOptions: s.subgraphTransportOptions,
			PreHandlers:              s.preOriginHandlers,
			PostHandlers:             s.postOriginHandlers,
			MetricStore:              gm.metricStore,
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
			TracePropagators:              s.tracePropagators,
			LocalhostFallbackInsideDocker: s.localhostFallbackInsideDocker,
			Logger:                        s.logger,
		},
	}

	executor, err := ecb.Build(
		ctx,
		&ExecutorBuildOptions{
			EngineConfig:             engineConfig,
			Subgraphs:                configSubgraphs,
			RouterEngineConfig:       routerEngineConfig,
			PubSubProviders:          s.pubSubProviders,
			Reporter:                 s.engineStats,
			ApolloCompatibilityFlags: s.apolloCompatibilityFlags,
			HeartbeatInterval:        s.multipartHeartbeatInterval,
		},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to build plan configuration: %w", err)
	}

	operationProcessor := NewOperationProcessor(OperationProcessorOptions{
		Executor:                            executor,
		MaxOperationSizeInBytes:             int64(s.routerTrafficConfig.MaxRequestBodyBytes),
		PersistedOperationClient:            s.persistedOperationClient,
		AutomaticPersistedOperationCacheTtl: s.automaticPersistedQueriesConfig.Cache.TTL,
		EnablePersistedOperationsCache:      s.engineExecutionConfiguration.EnablePersistedOperationsCache,
		PersistedOpsNormalizationCache:      gm.persistedOperationCache,
		NormalizationCache:                  gm.normalizationCache,
		ValidationCache:                     gm.validationCache,
		QueryDepthCache:                     gm.complexityCalculationCache,
		OperationHashCache:                  gm.operationHashCache,
		ParseKitPoolSize:                    s.engineExecutionConfiguration.ParseKitPoolSize,
		IntrospectionEnabled:                s.Config.introspection,
		ApolloCompatibilityFlags:            s.apolloCompatibilityFlags,
	})
	operationPlanner := NewOperationPlanner(executor, gm.planCache)

	if s.Config.cacheWarmup != nil && s.Config.cacheWarmup.Enabled {
		processor := NewCacheWarmupPlanningProcessor(&CacheWarmupPlanningProcessorOptions{
			OperationProcessor: operationProcessor,
			OperationPlanner:   operationPlanner,
			ComplexityLimits:   s.securityConfiguration.ComplexityLimits,
			RouterSchema:       executor.RouterSchema,
			TrackSchemaUsage:   s.graphqlMetricsConfig.Enabled,
		})
		warmupConfig := &CacheWarmupConfig{
			Log:            s.logger,
			Processor:      processor,
			Workers:        s.Config.cacheWarmup.Workers,
			ItemsPerSecond: s.Config.cacheWarmup.ItemsPerSecond,
			Timeout:        s.Config.cacheWarmup.Timeout,
		}
		switch s.Config.cacheWarmup.Source {
		case "filesystem":
			warmupConfig.Source = NewFileSystemSource(&FileSystemSourceConfig{
				RootPath: s.Config.cacheWarmup.Path,
			})
		case "s3":
			return nil, fmt.Errorf("s3 cache warmup is not supported yet")
		case "cdn":
			return nil, fmt.Errorf("cdn cache warmup is not supported yet")
		default:
			return nil, fmt.Errorf("invalid cache warmup source: %s, valid sources are: filesystem, s3, cdn", s.Config.cacheWarmup.Source)
		}
		err = WarmupCaches(ctx, warmupConfig)
		if err != nil {
			return nil, fmt.Errorf("failed to warmup caches: %w", err)
		}
	}

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
		EnableResponseHeaderPropagation:             s.headerRules != nil,
		EngineStats:                                 s.engineStats,
		TracerProvider:                              s.tracerProvider,
		Authorizer:                                  NewCosmoAuthorizer(authorizerOptions),
		SubgraphErrorPropagation:                    s.subgraphErrorPropagation,
		EngineLoaderHooks:                           NewEngineRequestHooks(gm.metricStore, subgraphAccessLogger, s.tracerProvider),
	}

	if s.redisClient != nil {
		handlerOpts.RateLimitConfig = s.rateLimit
		handlerOpts.RateLimiter, err = NewCosmoRateLimiter(&CosmoRateLimiterOptions{
			RedisClient:         s.redisClient,
			Debug:               s.rateLimit.Debug,
			RejectStatusCode:    s.rateLimit.SimpleStrategy.RejectStatusCode,
			KeySuffixExpression: s.rateLimit.KeySuffixExpression,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create rate limiter: %w", err)
		}
	}

	graphqlHandler := NewGraphQLHandler(handlerOpts)
	executor.Resolver.SetAsyncErrorWriter(graphqlHandler)

	operationBlocker, err := NewOperationBlocker(&OperationBlockerOptions{
		BlockMutations: BlockMutationOptions{
			Enabled:   s.securityConfiguration.BlockMutations.Enabled,
			Condition: s.securityConfiguration.BlockMutations.Condition,
		},
		BlockSubscriptions: BlockSubscriptionOptions{
			Enabled:   s.securityConfiguration.BlockSubscriptions.Enabled,
			Condition: s.securityConfiguration.BlockSubscriptions.Condition,
		},
		BlockNonPersisted: BlockNonPersistedOptions{
			Enabled:   s.securityConfiguration.BlockNonPersistedOperations.Enabled,
			Condition: s.securityConfiguration.BlockNonPersistedOperations.Condition,
		},
	})

	if err != nil {
		return nil, fmt.Errorf("failed to create operation blocker: %w", err)
	}

	graphqlPreHandler := NewPreHandler(&PreHandlerOptions{
		Logger:                      s.logger,
		Executor:                    executor,
		Metrics:                     metrics,
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
		ComplexityLimits:            s.securityConfiguration.ComplexityLimits,
		AlwaysIncludeQueryPlan:      s.engineExecutionConfiguration.Debug.AlwaysIncludeQueryPlan,
		AlwaysSkipLoader:            s.engineExecutionConfiguration.Debug.AlwaysSkipLoader,
		QueryPlansEnabled:           s.Config.queryPlansEnabled,
		QueryPlansLoggingEnabled:    s.engineExecutionConfiguration.Debug.PrintQueryPlans,
		TrackSchemaUsageInfo:        s.graphqlMetricsConfig.Enabled,
		ClientHeader:                s.clientHeader,
		ComputeOperationSha256:      computeSha256,
		ApolloCompatibilityFlags:    &s.apolloCompatibilityFlags,
	})

	if s.webSocketConfiguration != nil && s.webSocketConfiguration.Enabled {
		wsMiddleware := NewWebsocketMiddleware(ctx, WebsocketMiddlewareOptions{
			OperationProcessor:     operationProcessor,
			OperationBlocker:       operationBlocker,
			Planner:                operationPlanner,
			GraphQLHandler:         graphqlHandler,
			PreHandler:             graphqlPreHandler,
			Metrics:                metrics,
			AccessController:       s.accessController,
			Logger:                 s.logger,
			Stats:                  s.engineStats,
			ReadTimeout:            s.engineExecutionConfiguration.WebSocketClientReadTimeout,
			EnableNetPoll:          s.engineExecutionConfiguration.EnableNetPoll,
			NetPollTimeout:         s.engineExecutionConfiguration.WebSocketClientPollTimeout,
			NetPollConnBufferSize:  s.engineExecutionConfiguration.WebSocketClientConnBufferSize,
			WebSocketConfiguration: s.webSocketConfiguration,
			ClientHeader:           s.clientHeader,
			Attributes:             baseOtelAttributes,
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

				requestContext := getRequestContext(r.Context())

				// We don't want to count any type of subscriptions e.g. SSE as in-flight requests because they are long-lived
				if requestContext != nil && requestContext.operation != nil && requestContext.operation.opType != OperationTypeSubscription {
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

	// GraphQL over POST
	httpRouter.Post("/", graphqlHandler.ServeHTTP)
	// GraphQL over GET
	httpRouter.Get("/", graphqlHandler.ServeHTTP)

	gm.mux = httpRouter

	s.graphMuxListLock.Lock()
	defer s.graphMuxListLock.Unlock()
	s.graphMuxList = append(s.graphMuxList, gm)

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

					s.pubSubProviders.nats[providerID] = pubsubNats.NewConnector(s.logger, natsConnection, js, s.hostName, s.routerListenAddr).New(ctx)

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

	if s.runtimeMetrics != nil {
		if err := s.runtimeMetrics.Shutdown(); err != nil {
			s.logger.Error("Failed to shutdown runtime metrics", zap.Error(err))
			finalErr = errors.Join(finalErr, err)
		}
	}

	if s.otlpEngineMetrics != nil {
		if err := s.otlpEngineMetrics.Shutdown(); err != nil {
			s.logger.Error("Failed to shutdown OTLP engine metrics", zap.Error(err))
			finalErr = errors.Join(finalErr, err)
		}
	}

	if s.prometheusEngineMetrics != nil {
		if err := s.prometheusEngineMetrics.Shutdown(); err != nil {
			s.logger.Error("Failed to shutdown Prometheus engine metrics", zap.Error(err))
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
	s.graphMuxListLock.Lock()
	defer s.graphMuxListLock.Unlock()
	for _, mux := range s.graphMuxList {
		if err := mux.Shutdown(ctx); err != nil {
			s.logger.Error("Failed to shutdown graph mux", zap.Error(err))
			finalErr = errors.Join(finalErr, err)
		}
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
