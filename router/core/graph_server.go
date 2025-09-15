package core

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/cespare/xxhash/v2"
	"github.com/cloudflare/backoff"
	"github.com/dgraph-io/ristretto/v2"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/golang-jwt/jwt/v5"
	"github.com/klauspost/compress/gzhttp"
	"github.com/klauspost/compress/gzip"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	oteltrace "go.opentelemetry.io/otel/trace"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"golang.org/x/exp/maps"
	"golang.org/x/sync/errgroup"

	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/common"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/circuit"
	"github.com/wundergraph/cosmo/router/internal/expr"
	rjwt "github.com/wundergraph/cosmo/router/internal/jwt"
	rmiddleware "github.com/wundergraph/cosmo/router/internal/middleware"
	"github.com/wundergraph/cosmo/router/internal/recoveryhandler"
	"github.com/wundergraph/cosmo/router/internal/requestlogger"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/cors"
	"github.com/wundergraph/cosmo/router/pkg/execution_config"
	"github.com/wundergraph/cosmo/router/pkg/grpcconnector"
	"github.com/wundergraph/cosmo/router/pkg/grpcconnector/grpccommon"
	"github.com/wundergraph/cosmo/router/pkg/grpcconnector/grpcplugin"
	"github.com/wundergraph/cosmo/router/pkg/grpcconnector/grpcpluginoci"
	"github.com/wundergraph/cosmo/router/pkg/grpcconnector/grpcremote"
	"github.com/wundergraph/cosmo/router/pkg/health"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
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

	// graphServer is the swappable implementation of a Graph instance which is an HTTP mux with middlewares.
	// Everytime a schema is updated, the old graph server is shutdown and a new graph server is created.
	// For feature flags, a graphql server has multiple mux and is dynamically switched based on the feature flag header or cookie.
	// All fields are shared between all feature muxes. On shutdown, all graph instances are shutdown.
	graphServer struct {
		*Config
		context                 context.Context
		cancelFunc              context.CancelFunc
		storageProviders        *config.StorageProviders
		engineStats             statistics.EngineStatistics
		playgroundHandler       func(http.Handler) http.Handler
		publicKey               *ecdsa.PublicKey
		baseTransport           *http.Transport
		subgraphTransports      map[string]*http.Transport
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
		connectionMetrics       *rmetric.ConnectionMetrics
		instanceData            InstanceData
		pubSubProviders         []datasource.Provider
		traceDialer             *TraceDialer
		connector               *grpcconnector.Connector
		circuitBreakerManager   *circuit.Manager
	}
)

// BuildGraphMuxOptions contains the configuration options for building a graph mux.
type BuildGraphMuxOptions struct {
	FeatureFlagName     string
	RouterConfigVersion string
	EngineConfig        *nodev1.EngineConfiguration
	ConfigSubgraphs     []*nodev1.Subgraph
	RoutingUrlGroupings map[string]map[string]bool
}

func (b BuildGraphMuxOptions) IsBaseGraph() bool {
	return b.FeatureFlagName == ""
}

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

	isConnStoreEnabled := r.Config.metricConfig.OpenTelemetry.ConnectionStats || r.Config.metricConfig.Prometheus.ConnectionStats
	var traceDialer *TraceDialer
	if isConnStoreEnabled {
		traceDialer = NewTraceDialer()
	}

	// Base transport
	baseTransport := newHTTPTransport(r.subgraphTransportOptions.TransportRequestOptions, proxy, traceDialer, "")

	// Subgraph transports
	subgraphTransports := map[string]*http.Transport{}
	for subgraph, subgraphOpts := range r.subgraphTransportOptions.SubgraphMap {
		subgraphBaseTransport := newHTTPTransport(subgraphOpts, proxy, traceDialer, subgraph)
		subgraphTransports[subgraph] = subgraphBaseTransport
	}

	ctx, cancel := context.WithCancel(ctx)
	s := &graphServer{
		context:                 ctx,
		cancelFunc:              cancel,
		Config:                  &r.Config,
		engineStats:             r.EngineStats,
		baseTransport:           baseTransport,
		subgraphTransports:      subgraphTransports,
		playgroundHandler:       r.playgroundHandler,
		traceDialer:             traceDialer,
		baseRouterConfigVersion: routerConfig.GetVersion(),
		inFlightRequests:        &atomic.Uint64{},
		graphMuxList:            make([]*graphMux, 0, 1),
		instanceData: InstanceData{
			HostName:      r.hostName,
			ListenAddress: r.listenAddr,
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

	baseDefaultMuxAttributes := append([]attribute.KeyValue{otel.WgRouterConfigVersion.String(s.baseRouterConfigVersion)}, baseOtelAttributes...)

	mapper := newAttributeMapper(!rmetric.IsUsingDefaultCloudExporter(s.metricConfig), s.metricConfig.Attributes)
	mappedMetricAttributes := mapper.mapAttributes(baseDefaultMuxAttributes)

	if s.metricConfig.OpenTelemetry.RouterRuntime {
		// We track runtime metrics with base router config version
		s.runtimeMetrics = rmetric.NewRuntimeMetrics(
			s.logger,
			s.otlpMeterProvider,
			mappedMetricAttributes,
			s.processStartTime,
		)

		// Start runtime metrics
		if err := s.runtimeMetrics.Start(); err != nil {
			return nil, err
		}
	}

	if isConnStoreEnabled {
		connStore, err := rmetric.NewConnectionMetricStore(
			s.logger,
			nil,
			s.otlpMeterProvider,
			s.promMeterProvider,
			s.metricConfig,
			s.traceDialer.connectionPoolStats,
		)
		if err != nil {
			return nil, err
		}
		s.connectionMetrics = connStore
	}

	if err := s.setupEngineStatistics(mappedMetricAttributes); err != nil {
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

	if s.routerTrafficConfig.DecompressionEnabled {
		httpRouter.Use(rmiddleware.HandleCompression(s.logger))
	}

	// Request traffic shaping related middlewares, happens after decompression to prevent unbounded decompression attacks
	httpRouter.Use(rmiddleware.RequestSize(int64(s.routerTrafficConfig.MaxRequestBodyBytes)))

	httpRouter.Use(middleware.RequestID)
	httpRouter.Use(middleware.RealIP)
	if s.corsOptions.Enabled {
		httpRouter.Use(cors.New(*s.corsOptions))
	}

	if s.subgraphCircuitBreakerOptions.IsEnabled() {
		manager, err := circuit.NewManager(s.subgraphCircuitBreakerOptions.CircuitBreaker)
		if err != nil {
			return nil, err
		}
		s.circuitBreakerManager = manager
	}

	routingUrlGroupings, err := getRoutingUrlGroupingForCircuitBreakers(routerConfig, s.overrideRoutingURLConfiguration, s.overrides)
	if err != nil {
		return nil, err
	}

	gm, err := s.buildGraphMux(ctx, BuildGraphMuxOptions{
		RouterConfigVersion: s.baseRouterConfigVersion,
		EngineConfig:        routerConfig.GetEngineConfig(),
		ConfigSubgraphs:     routerConfig.GetSubgraphs(),
		RoutingUrlGroupings: routingUrlGroupings,
	})
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
		gzhttp.MinSize(int(s.routerTrafficConfig.ResponseCompressionMinSize)),
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

func getRoutingUrlGroupingForCircuitBreakers(
	routerConfig *nodev1.RouterConfig,
	overrideRoutingURLConfiguration config.OverrideRoutingURLConfiguration,
	overridesConfiguration config.OverridesConfiguration,
) (map[string]map[string]bool, error) {
	routingUrlGroupings := make(map[string]map[string]bool)

	overwrites, err := configureSubgraphOverwrites(
		routerConfig.GetEngineConfig(),
		routerConfig.GetSubgraphs(),
		overrideRoutingURLConfiguration,
		overridesConfiguration,
		true,
	)
	if err != nil {
		return nil, err
	}
	for _, subgraph := range overwrites {
		if _, ok := routingUrlGroupings[subgraph.UrlString]; !ok {
			routingUrlGroupings[subgraph.UrlString] = make(map[string]bool)
		}
		routingUrlGroupings[subgraph.UrlString][subgraph.Name] = true
	}

	if routerConfig.FeatureFlagConfigs != nil {
		for _, ffConfig := range routerConfig.FeatureFlagConfigs.ConfigByFeatureFlagName {
			ffOverwrites, err := configureSubgraphOverwrites(
				ffConfig.GetEngineConfig(),
				ffConfig.GetSubgraphs(),
				overrideRoutingURLConfiguration,
				overridesConfiguration,
				true,
			)
			if err != nil {
				return nil, err
			}
			for _, subgraph := range ffOverwrites {
				if _, ok := routingUrlGroupings[subgraph.UrlString]; !ok {
					routingUrlGroupings[subgraph.UrlString] = make(map[string]bool)
				}
				routingUrlGroupings[subgraph.UrlString][subgraph.Name] = true
			}
		}
	}

	return routingUrlGroupings, nil
}

func (s *graphServer) buildMultiGraphHandler(
	ctx context.Context,
	baseMux *chi.Mux,
	featureFlagConfigs map[string]*nodev1.FeatureFlagRouterExecutionConfig,
) (http.HandlerFunc, error) {
	if len(featureFlagConfigs) == 0 {
		return baseMux.ServeHTTP, nil
	}

	featureFlagToMux := make(map[string]*chi.Mux, len(featureFlagConfigs))

	// Build all the muxes for the feature flags in serial to avoid any race conditions
	for featureFlagName, executionConfig := range featureFlagConfigs {
		gm, err := s.buildGraphMux(ctx, BuildGraphMuxOptions{
			FeatureFlagName:     featureFlagName,
			RouterConfigVersion: executionConfig.GetVersion(),
			EngineConfig:        executionConfig.GetEngineConfig(),
			ConfigSubgraphs:     executionConfig.Subgraphs,
		})
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
func (s *graphServer) setupEngineStatistics(baseAttributes []attribute.KeyValue) (err error) {
	// We only include the base router config version in the attributes for the engine statistics.
	// Same approach is used for the runtime metrics.
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
	streamMetricStore          rmetric.StreamMetricStore
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

	// Prometheus schema field usage metrics can use sha256, so we need to ensure it is computed
	if srv.metricConfig.Prometheus.PromSchemaFieldUsage.Enabled && srv.metricConfig.Prometheus.PromSchemaFieldUsage.IncludeOperationSha {
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

	if s.streamMetricStore != nil {
		if aErr := s.streamMetricStore.Shutdown(ctx); aErr != nil {
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
func (s *graphServer) buildGraphMux(
	ctx context.Context,
	opts BuildGraphMuxOptions,
) (*graphMux, error) {
	gm := &graphMux{
		metricStore:       rmetric.NewNoopMetrics(),
		streamMetricStore: rmetric.NewNoopStreamMetricStore(),
	}

	httpRouter := chi.NewRouter()

	// we only enable the attribute mapper if we are not using the default cloud exporter
	baseMuxAttributes := append([]attribute.KeyValue{otel.WgRouterConfigVersion.String(opts.RouterConfigVersion)}, s.baseOtelAttributes...)

	if !opts.IsBaseGraph() {
		baseMuxAttributes = append(baseMuxAttributes, otel.WgFeatureFlag.String(opts.FeatureFlagName))
	}

	metricsEnabled := s.metricConfig.IsEnabled()

	exprManager := expr.CreateNewExprManager()

	// We might want to remap or exclude known attributes based on the configuration for metrics
	mapper := newAttributeMapper(!rmetric.IsUsingDefaultCloudExporter(s.metricConfig), s.metricConfig.Attributes)
	baseMetricAttributes := mapper.mapAttributes(baseMuxAttributes)

	metricAttExpressions, attErr := newAttributeExpressions(s.metricConfig.Attributes, exprManager)
	if attErr != nil {
		return nil, attErr
	}
	var telemetryAttExpressions *attributeExpressions
	if len(s.telemetryAttributes) > 0 {
		var telemetryAttErr error
		telemetryAttExpressions, telemetryAttErr = newAttributeExpressions(s.telemetryAttributes, exprManager)
		if telemetryAttErr != nil {
			return nil, telemetryAttErr
		}
	}

	var tracingAttExpressions *attributeExpressions
	if len(s.tracingAttributes) > 0 {
		var tracingAttrErr error
		tracingAttExpressions, tracingAttrErr = newAttributeExpressions(s.tracingAttributes, exprManager)
		if tracingAttrErr != nil {
			return nil, tracingAttrErr
		}
	}

	// Prometheus metricStore rely on OTLP metricStore
	if metricsEnabled {
		attrKeyValues := []attribute.KeyValue{
			otel.WgRouterConfigVersion.String(opts.RouterConfigVersion),
			otel.WgRouterVersion.String(Version),
		}
		if !opts.IsBaseGraph() {
			attrKeyValues = append(attrKeyValues, otel.WgFeatureFlag.String(opts.FeatureFlagName))
		}
		routerInfoBaseAttrs := otelmetric.WithAttributeSet(attribute.NewSet(attrKeyValues...))

		// From a users perspective this is similar to engine metrics, etc
		// but in this case we use the same metric store
		otlpOpts := rmetric.MetricOpts{
			EnableCircuitBreaker: s.metricConfig.OpenTelemetry.Enabled,
		}
		promOpts := rmetric.MetricOpts{
			EnableCircuitBreaker: s.metricConfig.Prometheus.Enabled,
		}

		m, err := rmetric.NewStore(otlpOpts, promOpts,
			rmetric.WithPromMeterProvider(s.promMeterProvider),
			rmetric.WithOtlpMeterProvider(s.otlpMeterProvider),
			rmetric.WithBaseAttributes(baseMetricAttributes),
			rmetric.WithLogger(s.logger),
			rmetric.WithProcessStartTime(s.processStartTime),
			rmetric.WithCardinalityLimit(s.metricConfig.CardinalityLimit),
			rmetric.WithRouterInfoAttributes(routerInfoBaseAttrs),
		)
		if err != nil {
			return nil, fmt.Errorf("failed to create metric handler: %w", err)
		}

		gm.metricStore = m
	}

	// We initialize circuit breakers for all subgraphs in the base configuration (non-ff)
	// so we don't duplicate circuit breakers for subgraphs and they can be used in the feature flags even
	// We initialize it in the buildGraphMux because we want to use the base metric configuration
	if opts.IsBaseGraph() && s.subgraphCircuitBreakerOptions.IsEnabled() {
		// If either otel or prom metrics are enabled for circuit breakers
		// we will enable circuit breaker metric collections
		isCircuitBreakerMetricsEnabled := s.metricConfig.OpenTelemetry.CircuitBreaker || s.metricConfig.Prometheus.CircuitBreaker

		err := s.circuitBreakerManager.Initialize(circuit.ManagerOpts{
			SubgraphCircuitBreakers: s.subgraphCircuitBreakerOptions.SubgraphMap,
			MetricStore:             gm.metricStore,
			UseMetrics:              metricsEnabled && isCircuitBreakerMetricsEnabled,
			BaseOtelAttributes:      baseMetricAttributes,
			AllGroupings:            opts.RoutingUrlGroupings,
		})
		if err != nil {
			return nil, err
		}
	}

	if s.metricConfig.OpenTelemetry.Streams || s.metricConfig.Prometheus.Streams {
		store, err := rmetric.NewStreamMetricStore(
			s.logger,
			baseMetricAttributes,
			s.otlpMeterProvider,
			s.promMeterProvider,
			s.metricConfig)
		if err != nil {
			return nil, err
		}
		gm.streamMetricStore = store
	}

	subgraphs, err := configureSubgraphOverwrites(
		opts.EngineConfig,
		opts.ConfigSubgraphs,
		s.overrideRoutingURLConfiguration,
		s.overrides,
		false,
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
		routerConfigVersion: opts.RouterConfigVersion,
		logger:              s.logger,

		promSchemaUsageEnabled:             s.metricConfig.Prometheus.PromSchemaFieldUsage.Enabled,
		promSchemaUsageIncludeOperationSha: s.metricConfig.Prometheus.PromSchemaFieldUsage.IncludeOperationSha,
	})

	baseLogFields := []zapcore.Field{
		zap.String("config_version", opts.RouterConfigVersion),
	}

	if !opts.IsBaseGraph() {
		baseLogFields = append(baseLogFields, zap.String("feature_flag", opts.FeatureFlagName))
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
				metricAttributeExpressions:    metricAttExpressions,
				telemetryAttributeExpressions: telemetryAttExpressions,
				tracingAttributeExpressions:   tracingAttExpressions,
				w:                             w,
				r:                             r,
			})

			r = r.WithContext(withRequestContext(r.Context(), reqContext))

			// For debugging purposes, we can validate from what version of the config the request is coming from
			if s.setConfigVersionHeader {
				w.Header().Set("X-Router-Config-Version", opts.RouterConfigVersion)
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

	var tracingAttrRequestMapper func(r *http.Request) []attribute.KeyValue
	if len(s.tracingAttributes) > 0 {
		tracingAttrRequestMapper = buildHeaderAttributesMapper(s.tracingAttributes)
	}

	var metricAttrRequestMapper func(r *http.Request) []attribute.KeyValue
	if s.metricConfig.IsEnabled() {
		// Metric attributes are only used for OTLP metrics and Prometheus metrics
		metricAttrRequestMapper = buildHeaderAttributesMapper(s.metricConfig.Attributes)
	}

	httpRouter.Use(func(h http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			reqContext := getRequestContext(r.Context())

			reqContext.telemetry.addCommonTraceAttribute(baseMuxAttributes...)

			if commonAttrRequestMapper != nil {
				reqContext.telemetry.addCommonAttribute(commonAttrRequestMapper(r)...)
			}
			if tracingAttrRequestMapper != nil {
				reqContext.telemetry.addCommonTraceAttribute(tracingAttrRequestMapper(r)...)
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

		accessLogAttributes := requestlogger.CleanupExpressionAttributes(s.accessLogsConfig.Attributes)

		requestLoggerOpts := []requestlogger.Option{
			requestlogger.WithDefaultOptions(),
			requestlogger.WithNoTimeField(),
			requestlogger.WithFields(baseLogFields...),
			requestlogger.WithAttributes(accessLogAttributes),
			requestlogger.WithExprAttributes(exprAttributes),
			requestlogger.WithFieldsHandler(RouterAccessLogsFieldHandler),
			requestlogger.WithIgnoreQueryParamsList(s.accessLogsConfig.IgnoreQueryParamsList),
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
			subgraphExprAttributes, err := requestlogger.GetAccessLogConfigExpressions(s.accessLogsConfig.SubgraphAttributes, exprManager)
			if err != nil {
				return nil, fmt.Errorf("failed building router access log expressions: %w", err)
			}

			subgraphAttributes := requestlogger.CleanupExpressionAttributes(s.accessLogsConfig.SubgraphAttributes)

			subgraphAccessLogger = requestlogger.NewSubgraphAccessLogger(
				s.accessLogsConfig.Logger,
				requestlogger.SubgraphOptions{
					IPAnonymizationConfig: ipAnonConfig,
					FieldsHandler:         SubgraphAccessLogsFieldHandler,
					Fields:                baseLogFields,
					Attributes:            subgraphAttributes,
					ExprAttributes:        subgraphExprAttributes,
				})
		}

		if exprManager.VisitorManager.IsResponseBodyUsedInExpressions() {
			httpRouter.Use(func(h http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					buf := bytes.Buffer{}
					ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

					ww.Tee(&buf)

					h.ServeHTTP(ww, r)

					reqContext := getRequestContext(r.Context())
					reqContext.expressionContext.Response.Body.Raw = buf.String()
				})
			})
		}
	}

	routerEngineConfig := &RouterEngineConfiguration{
		Execution:                s.engineExecutionConfiguration,
		Headers:                  s.headerRules,
		Events:                   s.eventsConfig,
		SubgraphErrorPropagation: s.subgraphErrorPropagation,
		StreamMetricStore:        gm.streamMetricStore,
	}

	// map[string]*http.Transport cannot be coerced into map[string]http.RoundTripper, unfortunately
	subgraphTippers := map[string]http.RoundTripper{}
	for subgraph, subgraphTransport := range s.subgraphTransports {
		subgraphTippers[subgraph] = subgraphTransport
	}

	if err := s.setupConnector(ctx, opts.EngineConfig, opts.ConfigSubgraphs, telemetryAttExpressions, tracingAttExpressions); err != nil {
		return nil, fmt.Errorf("failed to setup plugin host: %w", err)
	}

	enableTraceClient := s.connectionMetrics != nil || exprManager.VisitorManager.IsSubgraphTraceUsedInExpressions()

	var baseConnMetricStore rmetric.ConnectionMetricStore = &rmetric.NoopConnectionMetricStore{}
	if s.connectionMetrics != nil {
		baseConnMetricStore = s.connectionMetrics
	}

	// Build retry options and handle any expression compilation errors
	processedRetryOptions, err := ProcessRetryOptions(s.retryOptions)
	if err != nil {
		return nil, fmt.Errorf("failed to process retry options: %w", err)
	}

	ecb := &ExecutorConfigurationBuilder{
		introspection:    s.introspection,
		baseURL:          s.baseURL,
		baseTripper:      s.baseTransport,
		subgraphTrippers: subgraphTippers,
		pluginHost:       s.connector,
		logger:           s.logger,
		trackUsageInfo:   s.graphqlMetricsConfig.Enabled || s.metricConfig.Prometheus.PromSchemaFieldUsage.Enabled,
		subscriptionClientOptions: &SubscriptionClientOptions{
			PingInterval: s.engineExecutionConfiguration.WebSocketClientPingInterval,
			PingTimeout:  s.engineExecutionConfiguration.WebSocketClientPingTimeout,
			ReadTimeout:  s.engineExecutionConfiguration.WebSocketClientReadTimeout,
			FrameTimeout: s.engineExecutionConfiguration.WebSocketClientFrameTimeout,
		},
		transportOptions: &TransportOptions{
			SubgraphTransportOptions:      s.subgraphTransportOptions,
			PreHandlers:                   s.preOriginHandlers,
			PostHandlers:                  s.postOriginHandlers,
			MetricStore:                   gm.metricStore,
			ConnectionMetricStore:         baseConnMetricStore,
			RetryOptions:                  *processedRetryOptions,
			TracerProvider:                s.tracerProvider,
			TracePropagators:              s.compositePropagator,
			LocalhostFallbackInsideDocker: s.localhostFallbackInsideDocker,
			Logger:                        s.logger,
			EnableTraceClient:             enableTraceClient,
			CircuitBreaker:                s.circuitBreakerManager,
		},
	}

	executor, providers, err := ecb.Build(
		ctx,
		&ExecutorBuildOptions{
			EngineConfig:                   opts.EngineConfig,
			Subgraphs:                      opts.ConfigSubgraphs,
			RouterEngineConfig:             routerEngineConfig,
			Reporter:                       s.engineStats,
			ApolloCompatibilityFlags:       s.apolloCompatibilityFlags,
			ApolloRouterCompatibilityFlags: s.apolloRouterCompatibilityFlags,
			HeartbeatInterval:              s.subscriptionHeartbeatInterval,
			PluginsEnabled:                 s.plugins.Enabled,
			InstanceData:                   s.instanceData,
		},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to build plan configuration: %w", err)
	}

	s.pubSubProviders = providers
	if pubSubStartupErr := s.startupPubSubProviders(ctx); pubSubStartupErr != nil {
		return nil, pubSubStartupErr
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
		ParserTokenizerLimits: astparser.TokenizerLimits{
			MaxDepth:  s.Config.securityConfiguration.ParserLimits.ApproximateDepthLimit,
			MaxFields: s.Config.securityConfiguration.ParserLimits.TotalFieldsLimit,
		},
		OperationNameLengthLimit:                         s.securityConfiguration.OperationNameLengthLimit,
		ApolloCompatibilityFlags:                         s.apolloCompatibilityFlags,
		ApolloRouterCompatibilityFlags:                   s.apolloRouterCompatibilityFlags,
		DisableExposingVariablesContentOnValidationError: s.engineExecutionConfiguration.DisableExposingVariablesContentOnValidationError,
		ComplexityLimits:                                 s.securityConfiguration.ComplexityLimits,
	})
	operationPlanner := NewOperationPlanner(executor, gm.planCache)

	// We support the MCP only on the base graph. Feature flags are not supported yet.
	if opts.IsBaseGraph() && s.mcpServer != nil {
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
						otel.WgFeatureFlag.String(opts.FeatureFlagName),
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
		FieldConfigurations:           opts.EngineConfig.FieldConfigurations,
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
		EngineLoaderHooks: NewEngineRequestHooks(
			gm.metricStore,
			subgraphAccessLogger,
			s.tracerProvider,
			tracingAttExpressions,
			telemetryAttExpressions,
			metricAttExpressions,
			exprManager.VisitorManager.IsSubgraphResponseBodyUsedInExpressions(),
		),
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
		BlockPersisted: BlockPersistedOptions{
			Enabled:   s.securityConfiguration.BlockPersistedOperations.Enabled,
			Condition: s.securityConfiguration.BlockPersistedOperations.Condition,
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
		TrackSchemaUsageInfo:        s.graphqlMetricsConfig.Enabled || s.metricConfig.Prometheus.PromSchemaFieldUsage.Enabled,
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

func (s *graphServer) setupConnector(
	ctx context.Context,
	config *nodev1.EngineConfiguration,
	configSubgraphs []*nodev1.Subgraph,
	telemetryAttributeExpressions *attributeExpressions,
	tracingAttributeExpressions *attributeExpressions,
) error {
	s.connector = grpcconnector.NewConnector()

	for _, dsConfig := range config.DatasourceConfigurations {
		grpcConfig := dsConfig.GetCustomGraphql().GetGrpc()
		if grpcConfig == nil {
			continue
		}

		var sg *nodev1.Subgraph

		for _, subgraph := range configSubgraphs {
			if subgraph.Id == dsConfig.Id {
				sg = subgraph
				break
			}
		}

		if sg == nil {
			return fmt.Errorf("subgraph %s not found", dsConfig.Id)
		}

		pluginConfig := grpcConfig.GetPlugin()
		if pluginConfig == nil {
			remoteProvider, err := grpcremote.NewRemoteGRPCProvider(grpcremote.RemoteGRPCProviderConfig{
				Logger:   s.logger,
				Endpoint: sg.RoutingUrl,
			})

			if err != nil {
				return fmt.Errorf("failed to create standalone plugin for subgraph %s: %w", dsConfig.Id, err)
			}

			err = s.connector.RegisterClientProvider(sg.Name, remoteProvider)
			if err != nil {
				return fmt.Errorf("failed to register standalone plugin: %w", err)
			}

			continue
		}

		if !s.plugins.Enabled {
			continue
		}

		basePath := ""

		if s.plugins.Path != "" {
			basePath = s.plugins.Path
		}

		startupConfig := newGRPCStartupParams(s.traceConfig, s.ipAnonymization)

		tracer := s.tracerProvider.Tracer("wundergraph/cosmo/router/engine/grpc", oteltrace.WithInstrumentationVersion("0.0.1"))

		getTraceAttributes := CreateGRPCTraceGetter(
			telemetryAttributeExpressions,
			tracingAttributeExpressions,
		)

		if imgRef := pluginConfig.GetImageReference(); imgRef != nil {
			ref := fmt.Sprintf("%s/%s:%s",
				s.plugins.Registry.URL,
				imgRef.GetRepository(),
				imgRef.GetReference(),
			)

			grpcPlugin, err := grpcpluginoci.NewGRPCOCIPlugin(grpcpluginoci.GRPCPluginConfig{
				Logger:             s.logger,
				ImageRef:           ref,
				RegistryToken:      s.graphApiToken,
				StartupConfig:      startupConfig,
				Tracer:             tracer,
				GetTraceAttributes: getTraceAttributes,
			})
			if err != nil {
				return fmt.Errorf("failed to create grpc oci plugin for subgraph %s: %w", dsConfig.Id, err)
			}

			err = s.connector.RegisterClientProvider(sg.Name, grpcPlugin)
			if err != nil {
				return fmt.Errorf("failed to register grpc plugin: %w", err)
			}
		} else {
			pluginPath, err := filepath.Abs(filepath.Join(basePath, pluginConfig.GetName(), "bin", fmt.Sprintf("%s_%s", runtime.GOOS, runtime.GOARCH)))
			if err != nil {
				return fmt.Errorf("failed to get plugin path: %w", err)
			}

			grpcPlugin, err := grpcplugin.NewGRPCPlugin(grpcplugin.GRPCPluginConfig{
				Logger:             s.logger,
				PluginName:         pluginConfig.GetName(),
				PluginPath:         pluginPath,
				StartupConfig:      startupConfig,
				Tracer:             tracer,
				GetTraceAttributes: getTraceAttributes,
			})
			if err != nil {
				return fmt.Errorf("failed to create grpc plugin for subgraph %s: %w", dsConfig.Id, err)
			}

			err = s.connector.RegisterClientProvider(sg.Name, grpcPlugin)
			if err != nil {
				return fmt.Errorf("failed to register grpc plugin: %w", err)
			}
		}
	}

	if err := s.connector.Run(ctx); err != nil {
		return fmt.Errorf("failed to run plugin host: %w", err)
	}

	return nil
}

func newGRPCStartupParams(traceConfig *rtrace.Config, ipAnonymization *IPAnonymizationConfig) grpccommon.GRPCStartupParams {
	startupConfig := grpccommon.GRPCStartupParams{}

	if traceConfig.Enabled && len(traceConfig.Exporters) > 0 {
		enabledExporters := make([]grpccommon.GRPCExporter, 0)
		for _, exporter := range traceConfig.Exporters {
			if exporter != nil && !exporter.Disabled {
				transformedExporter := grpccommon.GRPCExporter{
					Endpoint:      exporter.Endpoint,
					Exporter:      string(exporter.Exporter),
					BatchTimeout:  exporter.BatchTimeout,
					ExportTimeout: exporter.ExportTimeout,
					Headers:       exporter.Headers,
					HTTPPath:      exporter.HTTPPath,
				}
				enabledExporters = append(enabledExporters, transformedExporter)
			}
		}

		// Convert to []string
		propagators := make([]string, 0, len(traceConfig.Propagators))
		for _, propagator := range traceConfig.Propagators {
			propagators = append(propagators, string(propagator))
		}

		startupConfig.Telemetry = &grpccommon.GRPCTelemetry{
			Tracing: &grpccommon.GRPCTracing{
				Exporters:   enabledExporters,
				Propagators: propagators,
				Sampler:     traceConfig.Sampler,
			},
		}
	}

	if ipAnonymization != nil {
		startupConfig.IPAnonymization = &grpccommon.GRPCIPAnonymization{
			Enabled: ipAnonymization.Enabled,
			Method:  string(ipAnonymization.Method),
		}
	}

	return startupConfig
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

	if s.connectionMetrics != nil {
		if aErr := s.connectionMetrics.Shutdown(ctx); aErr != nil {
			finalErr = errors.Join(finalErr, aErr)
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

	if err := s.shutdownPubSubProviders(ctx); err != nil {
		finalErr = errors.Join(finalErr, err)
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

	// Close idle connections on base and subgraph transports
	s.baseTransport.CloseIdleConnections()
	for _, subgraphTransport := range s.subgraphTransports {
		subgraphTransport.CloseIdleConnections()
	}

	if s.connector != nil {
		s.logger.Debug("Stopping old plugins")
		if err := s.connector.StopAllProviders(); err != nil {
			finalErr = errors.Join(finalErr, err)
		}
	}

	return finalErr
}

// startupPubSubProviders starts all pubsub providers
// It returns an error if any of the providers fail to start
// or if some providers takes to long to start
func (s *graphServer) startupPubSubProviders(ctx context.Context) error {
	// Default timeout for pubsub provider startup
	const defaultStartupTimeout = 5 * time.Second

	return s.providersActionWithTimeout(ctx, func(ctx context.Context, provider datasource.Provider) error {
		return provider.Startup(ctx)
	}, defaultStartupTimeout, "pubsub provider startup timed out")
}

// shutdownPubSubProviders shuts down all pubsub providers
// It returns an error if any of the providers fail to shutdown
// or if some providers takes to long to shutdown
func (s *graphServer) shutdownPubSubProviders(ctx context.Context) error {
	// Default timeout for pubsub provider shutdown
	const defaultShutdownTimeout = 5 * time.Second

	return s.providersActionWithTimeout(ctx, func(ctx context.Context, provider datasource.Provider) error {
		return provider.Shutdown(ctx)
	}, defaultShutdownTimeout, "pubsub provider shutdown timed out")
}

func (s *graphServer) providersActionWithTimeout(ctx context.Context, action func(ctx context.Context, provider datasource.Provider) error, timeout time.Duration, timeoutMessage string) error {
	cancellableCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	providersGroup := new(errgroup.Group)
	for _, provider := range s.pubSubProviders {
		providersGroup.Go(func() error {
			actionDone := make(chan error, 1)
			go func() {
				actionDone <- action(cancellableCtx, provider)
			}()
			select {
			case err := <-actionDone:
				return err
			case <-timer.C:
				return errors.New(timeoutMessage)
			}
		})
	}

	return providersGroup.Wait()
}

func configureSubgraphOverwrites(
	engineConfig *nodev1.EngineConfiguration,
	configSubgraphs []*nodev1.Subgraph,
	overrideRoutingURLConfig config.OverrideRoutingURLConfiguration,
	overridesConfig config.OverridesConfiguration,
	skipOverrides bool,
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
		overrideSubgraph, overrideSubgraphOk := overridesConfig.Subgraphs[sg.Name]

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

			// If skipOverrides is true we do not want to update the references and only care about
			// getting a subgraph result with the overridden url
			if !skipOverrides {
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
		}

		subgraphs = append(subgraphs, subgraph)
	}

	return subgraphs, nil
}
