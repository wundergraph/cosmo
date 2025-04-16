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

	"github.com/cespare/xxhash/v2"
	"github.com/wundergraph/cosmo/router/pkg/execution_config"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
	otelmetric "go.opentelemetry.io/otel/metric"
	oteltrace "go.opentelemetry.io/otel/trace"

	"github.com/cloudflare/backoff"
	"github.com/dgraph-io/ristretto/v2"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/golang-jwt/jwt/v5"
	"github.com/klauspost/compress/gzhttp"
	"github.com/klauspost/compress/gzip"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/internal/retrytransport"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
	"go.opentelemetry.io/otel/attribute"
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
		storageProviders        *config.StorageProviders
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
	/* Older versions of composition will not populate a compatibility version.
	 * Currently, all "old" router execution configurations are compatible as there have been no breaking
	 * changes.
	 * Upon the first breaking change to the execution config, an unpopulated compatibility version will
	 * also be unsupported (and the logic for IsRouterCompatibleWithExecutionConfig will need to be updated).
	 */
	if !execution_config.IsRouterCompatibleWithExecutionConfig(r.logger, routerConfig.CompatibilityVersion) {
		return nil, fmt.Errorf(`the compatibility version "%s" is not compatible with this router version`, routerConfig.CompatibilityVersion)
	}

	ctx, cancel := context.WithCancel(ctx)
	s := &graphServer{
		context:                 ctx,
		cancelFunc:              cancel,
		Config:                  &r.Config,
		engineStats:             r.EngineStats,
		executionTransport:      newHTTPTransport(r.subgraphTransportOptions.TransportRequestOptions, proxy),
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
		storageProviders: &r.storageProviders,
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

	// Request traffic shaping related middlewares
	httpRouter.Use(rmiddleware.RequestSize(int64(s.routerTrafficConfig.MaxRequestBodyBytes)))
	if s.routerTrafficConfig.DecompressionEnabled {
		httpRouter.Use(rmiddleware.HandleCompression(s.logger))
	}

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
		gzhttp.MinSize(1024*4), // 4KB
		gzhttp.CompressionLevel(gzip.DefaultCompression),
		gzhttp.ContentTypes(CompressibleContentTypes),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create gzip wrapper: %w", err)
	}

	if s.traceConfig.Enabled {
		handler := rtrace.NewTracingHandler(rtrace.TracingHandlerOpts{
			TraceConfig:         s.traceConfig,
			HealthCheckPath:     s.healthCheckPath,
			ReadinessCheckPath:  s.readinessCheckPath,
			LivenessCheckPath:   s.livenessCheckPath,
			CompositePropagator: s.compositePropagator,
			TracerProvider:      s.tracerProvider,
			SpanNameFormatter:   SpanNameFormatter,
		})
		httpRouter.Use(handler)
	}

	if s.batchingConfig.Enabled {
		if s.batchingConfig.MaxConcurrentRoutines <= 0 {
			return nil, errors.New("maxConcurrent must be greater than 0")
		}
		if s.batchingConfig.MaxEntriesPerBatch <= 0 {
			return nil, errors.New("maxEntriesPerBatch must be greater than 0")
		}
	}

	/**
	* A group where we can selectively apply middlewares to the graphql endpoint
	 */
	httpRouter.Group(func(cr chi.Router) {
		// We are applying it conditionally because compressing 3MB playground is still slow even with stdlib gzip
		cr.Use(func(h http.Handler) http.Handler {
			return wrapper(h)
		})

		if s.headerRules != nil {
			cr.Use(rmiddleware.CookieWhitelist(s.headerRules.CookieWhitelist, []string{featureFlagCookie}))
		}

		// Mount the feature flag handler. It calls the base mux if no feature flag is set.
		if s.batchingConfig.Enabled {
			handler := Handler(
				HandlerOpts{
					MaxEntriesPerBatch: s.batchingConfig.MaxEntriesPerBatch,
					MaxRoutines:        s.batchingConfig.MaxConcurrentRoutines,
					OmitExtensions:     s.batchingConfig.OmitExtensions,
					HandlerSent:        multiGraphHandler,
					Tracer: r.tracerProvider.Tracer(
						"wundergraph/cosmo/router/internal/batch",
						oteltrace.WithInstrumentationVersion("0.0.1"),
					),
					Digest:              xxhash.New(),
					ClientHeader:        s.clientHeader,
					BaseOtelAttributes:  s.baseOtelAttributes,
					RouterConfigVersion: s.baseRouterConfigVersion,
					Logger:              s.logger,
				},
			)
			cr.Handle(r.graphqlPath, handler)
		} else {
			cr.Handle(r.graphqlPath, multiGraphHandler)
		}

		if r.webSocketConfiguration != nil && r.webSocketConfiguration.Enabled && r.webSocketConfiguration.AbsintheProtocol.Enabled {
			// Mount the Absinthe protocol handler for WebSockets
			httpRouter.Handle(r.webSocketConfiguration.AbsintheProtocol.HandlerPath, multiGraphHandler)
		}
	})

	/**
	* Routes
	 */

	// We mount the playground once here when we don't have a conflict with the websocket handler
	// If we have a conflict, we mount the playground during building the individual muxes
	if s.playgroundHandler != nil && s.graphqlPath != s.playgroundConfig.Path {
		httpRouter.Get(r.playgroundConfig.Path, s.playgroundHandler(nil).ServeHTTP)
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

		baseMux.ServeHTTP(w, r)
	}, nil
}

// setupEngineStatistics creates the engine statistics for the server.
// It creates the OTLP and Prometheus metrics for the engine statistics.
func (s *graphServer) setupEngineStatistics() (err error) {
	// We only include the base router config version in the attributes for the engine statistics.
	// Same approach is used for the runtime metrics.
	baseAttributes := append([]attribute.KeyValue{
		otel.WgRouterConfigVersion.String(s.baseRouterConfigVersion),
	}, s.baseOtelAttributes...)

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
	} else if srv.persistedOperationsConfig.Safelist.Enabled || srv.persistedOperationsConfig.LogUnknown {
		// In these case, we'll want to compute the sha256 for every operation, in order to check that the operation
		// is present in the Persisted Operation cache
		computeSha256 = true
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

	if s.complexityCalculationCache != nil {
		s.complexityCalculationCache.Close()
	}

	if s.validationCache != nil {
		s.validationCache.Close()
	}

	if s.operationHashCache != nil {
		s.operationHashCache.Close()
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

	if err != nil {
		return fmt.Errorf("shutdown graph mux: %w", err)
	}

	return nil
}

// buildGraphMux creates a new graph mux with the given feature flags and engine configuration.
// It also creates a new execution plan cache for the mux. The mux is not mounted on the server.
// The mux is appended internally to the graph server's list of muxes to clean up later when the server is swapped.
func (s *graphServer) buildGraphMux(ctx context.Context,
	featureFlagName string,
	routerConfigVersion string,
	engineConfig *nodev1.EngineConfiguration,
	configSubgraphs []*nodev1.Subgraph,
) (*graphMux, error) {
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

	exprManager := expr.CreateNewExprManager()

	// We might want to remap or exclude known attributes based on the configuration for metrics
	mapper := newAttributeMapper(enableAttributeMapper, s.metricConfig.Attributes)
	attExpressions, attErr := newAttributeExpressions(s.metricConfig.Attributes, exprManager)
	if attErr != nil {
		return nil, attErr
	}
	baseMetricAttributes := mapper.mapAttributes(baseOtelAttributes)
	var telemetryAttExpressions *attributeExpressions
	if len(s.telemetryAttributes) > 0 {
		var telemetryAttErr error
		telemetryAttExpressions, telemetryAttErr = newAttributeExpressions(s.telemetryAttributes, exprManager)
		if telemetryAttErr != nil {
			return nil, telemetryAttErr
		}
	}

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
			r = r.WithContext(withSubgraphResolver(r.Context(), subgraphResolver))
			requestLogger := s.logger.With(logging.WithRequestID(middleware.GetReqID(r.Context())))
			// If this is a batched request attach id to the logger
			if batchedOperationId, ok := r.Context().Value(BatchedOperationId{}).(string); ok {
				requestLogger = requestLogger.With(logging.WithBatchedRequestOperationID(batchedOperationId))
			}
			reqContext := buildRequestContext(requestContextOptions{
				operationContext:              nil,
				requestLogger:                 requestLogger,
				metricSetAttributes:           b,
				metricsEnabled:                metricsEnabled,
				traceEnabled:                  s.traceConfig.Enabled,
				mapper:                        mapper,
				metricAttributeExpressions:    attExpressions,
				telemetryAttributeExpressions: telemetryAttExpressions,
				w:                             w,
				r:                             r,
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

	// Setup any router on request middlewares so that they can be used to manipulate
	// other downstream internal middlewares such as tracing or authentication
	httpRouter.Use(s.routerOnRequestHandlers...)

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
		f := func(h http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				reqContext := getRequestContext(r.Context())
				traceID := rtrace.GetTraceID(r.Context())
				requestLogger := reqContext.Logger().With(logging.WithTraceID(traceID))

				reqContext.logger = requestLogger

				span := oteltrace.SpanFromContext(r.Context())
				span.SetAttributes(reqContext.telemetry.traceAttrs...)

				// Set if the trace is sampled in the expression context
				isSampled := span.SpanContext().IsSampled()
				reqContext.expressionContext.Request.Trace.Sampled = isSampled

				// Set the trace ID in the response header
				if s.traceConfig.ResponseTraceHeader.Enabled {
					w.Header().Set(s.traceConfig.ResponseTraceHeader.HeaderName, traceID)
				}

				h.ServeHTTP(w, r)
			})
		}
		httpRouter.Use(f)
	}

	var subgraphAccessLogger *requestlogger.SubgraphAccessLogger
	if s.accessLogsConfig != nil && s.accessLogsConfig.Logger != nil {
		exprAttributes, err := requestlogger.GetAccessLogConfigExpressions(s.accessLogsConfig.Attributes, exprManager)
		if err != nil {
			return nil, fmt.Errorf("failed building router access log expressions: %w", err)
		}

		s.accessLogsConfig.Attributes = requestlogger.CleanupExpressionAttributes(s.accessLogsConfig.Attributes)

		requestLoggerOpts := []requestlogger.Option{
			requestlogger.WithDefaultOptions(),
			requestlogger.WithNoTimeField(),
			requestlogger.WithFields(baseLogFields...),
			requestlogger.WithAttributes(s.accessLogsConfig.Attributes),
			requestlogger.WithExprAttributes(exprAttributes),
			requestlogger.WithFieldsHandler(RouterAccessLogsFieldHandler),
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
			s.accessLogsConfig.SubgraphAttributes = requestlogger.CleanupExpressionAttributes(s.accessLogsConfig.SubgraphAttributes)

			subgraphAccessLogger = requestlogger.NewSubgraphAccessLogger(
				s.accessLogsConfig.Logger,
				requestlogger.SubgraphOptions{
					IPAnonymizationConfig: ipAnonConfig,
					FieldsHandler:         SubgraphAccessLogsFieldHandler,
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
		subscriptionClientOptions: &SubscriptionClientOptions{
			PingInterval: s.engineExecutionConfiguration.WebSocketClientPingInterval,
		},
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
			TracePropagators:              s.compositePropagator,
			LocalhostFallbackInsideDocker: s.localhostFallbackInsideDocker,
			Logger:                        s.logger,
		},
	}

	executor, err := ecb.Build(
		ctx,
		&ExecutorBuildOptions{
			EngineConfig:                   engineConfig,
			Subgraphs:                      configSubgraphs,
			RouterEngineConfig:             routerEngineConfig,
			PubSubProviders:                s.pubSubProviders,
			Reporter:                       s.engineStats,
			ApolloCompatibilityFlags:       s.apolloCompatibilityFlags,
			ApolloRouterCompatibilityFlags: s.apolloRouterCompatibilityFlags,
			HeartbeatInterval:              s.multipartHeartbeatInterval,
		},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to build plan configuration: %w", err)
	}

	operationProcessor := NewOperationProcessor(OperationProcessorOptions{
		Executor:                                         executor,
		MaxOperationSizeInBytes:                          int64(s.routerTrafficConfig.MaxRequestBodyBytes),
		PersistedOperationClient:                         s.persistedOperationClient,
		AutomaticPersistedOperationCacheTtl:              s.automaticPersistedQueriesConfig.Cache.TTL,
		EnablePersistedOperationsCache:                   s.engineExecutionConfiguration.EnablePersistedOperationsCache,
		PersistedOpsNormalizationCache:                   gm.persistedOperationCache,
		NormalizationCache:                               gm.normalizationCache,
		ValidationCache:                                  gm.validationCache,
		QueryDepthCache:                                  gm.complexityCalculationCache,
		OperationHashCache:                               gm.operationHashCache,
		ParseKitPoolSize:                                 s.engineExecutionConfiguration.ParseKitPoolSize,
		IntrospectionEnabled:                             s.Config.introspection,
		ApolloCompatibilityFlags:                         s.apolloCompatibilityFlags,
		ApolloRouterCompatibilityFlags:                   s.apolloRouterCompatibilityFlags,
		DisableExposingVariablesContentOnValidationError: s.engineExecutionConfiguration.DisableExposingVariablesContentOnValidationError,
	})
	operationPlanner := NewOperationPlanner(executor, gm.planCache)

	if featureFlagName == "" && s.mcpServer != nil {
		if mErr := s.mcpServer.Reload(executor.ClientSchema); mErr != nil {
			return nil, fmt.Errorf("failed to reload MCP server: %w", mErr)
		}
	}

	if s.Config.cacheWarmup != nil && s.Config.cacheWarmup.Enabled {

		if s.graphApiToken == "" {
			return nil, fmt.Errorf("graph token is required for cache warmup in order to communicate with the CDN")
		}

		processor := NewCacheWarmupPlanningProcessor(&CacheWarmupPlanningProcessorOptions{
			OperationProcessor:        operationProcessor,
			OperationPlanner:          operationPlanner,
			ComplexityLimits:          s.securityConfiguration.ComplexityLimits,
			RouterSchema:              executor.RouterSchema,
			TrackSchemaUsage:          s.graphqlMetricsConfig.Enabled,
			DisableVariablesRemapping: s.engineExecutionConfiguration.DisableVariablesRemapping,
		})

		warmupConfig := &CacheWarmupConfig{
			Log:            s.logger,
			Processor:      processor,
			Workers:        s.Config.cacheWarmup.Workers,
			ItemsPerSecond: s.Config.cacheWarmup.ItemsPerSecond,
			Timeout:        s.Config.cacheWarmup.Timeout,
		}

		warmupConfig.AfterOperation = func(item *CacheWarmupOperationPlanResult) {
			gm.metricStore.MeasureOperationPlanningTime(ctx,
				item.PlanningTime,
				nil,
				otelmetric.WithAttributes(
					append([]attribute.KeyValue{
						otel.WgOperationName.String(item.OperationName),
						otel.WgClientName.String(item.ClientName),
						otel.WgClientVersion.String(item.ClientVersion),
						otel.WgFeatureFlag.String(featureFlagName),
						otel.WgOperationHash.String(item.OperationHash),
						otel.WgOperationType.String(item.OperationType),
						otel.WgEnginePlanCacheHit.Bool(false),
					}, baseMetricAttributes...)...,
				),
			)
		}

		if s.Config.cacheWarmup.Source.Filesystem != nil {
			warmupConfig.Source = NewFileSystemSource(&FileSystemSourceConfig{
				RootPath: s.Config.cacheWarmup.Source.Filesystem.Path,
			})
		} else {
			cdnSource, err := NewCDNSource(s.Config.cdnConfig.URL, s.graphApiToken, s.logger)
			if err != nil {
				return nil, fmt.Errorf("failed to create cdn source: %w", err)
			}
			warmupConfig.Source = cdnSource
		}

		err = WarmupCaches(ctx, warmupConfig)
		if err != nil {
			// We don't want to fail the server if the cache warmup fails
			s.logger.Error("Failed to warmup caches. It will retry after server restart or graph execution config update", zap.Error(err))
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
			ExprManager:         exprManager,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create rate limiter: %w", err)
		}
	}

	if s.apolloCompatibilityFlags.SubscriptionMultipartPrintBoundary.Enabled {
		handlerOpts.ApolloSubscriptionMultipartPrintBoundary = s.apolloCompatibilityFlags.SubscriptionMultipartPrintBoundary.Enabled
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
		SafelistEnabled:             s.persistedOperationsConfig.Safelist.Enabled,
		LogUnknownOperationsEnabled: s.persistedOperationsConfig.LogUnknown,
		exprManager:                 exprManager,
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
		DisableVariablesRemapping:   s.engineExecutionConfiguration.DisableVariablesRemapping,
		ExprManager:                 exprManager,
		OmitBatchExtensions:         s.batchingConfig.OmitExtensions,
	})

	if s.webSocketConfiguration != nil && s.webSocketConfiguration.Enabled {
		wsMiddleware := NewWebsocketMiddleware(ctx, WebsocketMiddlewareOptions{
			OperationProcessor:        operationProcessor,
			OperationBlocker:          operationBlocker,
			Planner:                   operationPlanner,
			GraphQLHandler:            graphqlHandler,
			PreHandler:                graphqlPreHandler,
			Metrics:                   metrics,
			AccessController:          s.accessController,
			Logger:                    s.logger,
			Stats:                     s.engineStats,
			ReadTimeout:               s.engineExecutionConfiguration.WebSocketClientReadTimeout,
			WriteTimeout:              s.engineExecutionConfiguration.WebSocketClientWriteTimeout,
			EnableNetPoll:             s.engineExecutionConfiguration.EnableNetPoll,
			NetPollTimeout:            s.engineExecutionConfiguration.WebSocketClientPollTimeout,
			NetPollConnBufferSize:     s.engineExecutionConfiguration.WebSocketClientConnBufferSize,
			WebSocketConfiguration:    s.webSocketConfiguration,
			ClientHeader:              s.clientHeader,
			Attributes:                baseOtelAttributes,
			DisableVariablesRemapping: s.engineExecutionConfiguration.DisableVariablesRemapping,
			ApolloCompatibilityFlags:  s.apolloCompatibilityFlags,
		})

		// When the playground path is equal to the graphql path, we need to handle
		// ws upgrades and html requests on the same route.
		if s.playgroundConfig.Enabled && s.graphqlPath == s.playgroundConfig.Path {
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
	httpRouter.Post(s.graphqlPath, graphqlHandler.ServeHTTP)
	// GraphQL over GET
	httpRouter.Get(s.graphqlPath, graphqlHandler.ServeHTTP)

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

			_, ok = s.pubSubProviders.nats[providerID]
			if !ok {
				return fmt.Errorf("failed to find Nats provider with ID \"%s\". Ensure the provider definition is part of the config", providerID)
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

			_, ok = s.pubSubProviders.kafka[providerID]
			if !ok {
				return fmt.Errorf("failed to find Kafka provider with ID \"%s\". Ensure the provider definition is part of the config", providerID)
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
		finalErr = errors.Join(finalErr, fmt.Errorf("failed to wait for in-flight requests: %w", err))
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
			finalErr = errors.Join(finalErr, err)
		}
	}

	if s.otlpEngineMetrics != nil {
		if err := s.otlpEngineMetrics.Shutdown(); err != nil {
			finalErr = errors.Join(finalErr, err)
		}
	}

	if s.prometheusEngineMetrics != nil {
		if err := s.prometheusEngineMetrics.Shutdown(); err != nil {
			finalErr = errors.Join(finalErr, err)
		}
	}

	if s.pubSubProviders != nil {

		s.logger.Debug("Shutting down pubsub providers")

		for _, pubSub := range s.pubSubProviders.nats {
			if p, ok := pubSub.(pubsub.Lifecycle); ok {
				if err := p.Shutdown(ctx); err != nil {
					finalErr = errors.Join(finalErr, err)
				}
			}
		}
		for _, pubSub := range s.pubSubProviders.kafka {
			if p, ok := pubSub.(pubsub.Lifecycle); ok {
				if err := p.Shutdown(ctx); err != nil {
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
	var err error
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
