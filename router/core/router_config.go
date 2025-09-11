package core

import (
	"crypto/tls"
	"net/http"
	"time"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/graphqlmetrics"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	rd "github.com/wundergraph/cosmo/router/internal/rediscloser"
	"github.com/wundergraph/cosmo/router/internal/retrytransport"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/selfregister"
	"github.com/wundergraph/cosmo/router/pkg/cors"
	"github.com/wundergraph/cosmo/router/pkg/health"
	"github.com/wundergraph/cosmo/router/pkg/mcpserver"
	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.uber.org/atomic"
	"go.uber.org/zap"
)

type Config struct {
	clusterName                     string
	instanceID                      string
	logger                          *zap.Logger
	traceConfig                     *rtrace.Config
	metricConfig                    *rmetric.Config
	tracerProvider                  *sdktrace.TracerProvider
	otlpMeterProvider               *sdkmetric.MeterProvider
	promMeterProvider               *sdkmetric.MeterProvider
	gqlMetricsExporter              *graphqlmetrics.Exporter
	corsOptions                     *cors.Config
	setConfigVersionHeader          bool
	routerGracePeriod               time.Duration
	staticExecutionConfig           *nodev1.RouterConfig
	awsLambda                       bool
	shutdown                        atomic.Bool
	bootstrapped                    atomic.Bool
	ipAnonymization                 *IPAnonymizationConfig
	listenAddr                      string
	baseURL                         string
	graphqlWebURL                   string
	playgroundPath                  string
	graphqlPath                     string
	playground                      bool
	introspection                   bool
	queryPlansEnabled               bool
	graphApiToken                   string
	healthCheckPath                 string
	readinessCheckPath              string
	livenessCheckPath               string
	playgroundConfig                config.PlaygroundConfig
	cacheControlPolicy              config.CacheControlPolicy
	routerConfigPollerConfig        *RouterConfigPollerConfig
	cdnConfig                       config.CDNConfiguration
	persistedOperationClient        *persistedoperation.Client
	persistedOperationsConfig       config.PersistedOperationsConfig
	automaticPersistedQueriesConfig config.AutomaticPersistedQueriesConfig
	apolloCompatibilityFlags        config.ApolloCompatibilityFlags
	apolloRouterCompatibilityFlags  config.ApolloRouterCompatibilityFlags
	storageProviders                config.StorageProviders
	demoMode                        bool
	eventsConfig                    config.EventsConfiguration
	prometheusServer                *http.Server
	modulesConfig                   map[string]interface{}
	executionConfig                 *ExecutionConfig
	routerOnRequestHandlers         []func(http.Handler) http.Handler
	routerMiddlewares               []func(http.Handler) http.Handler
	preOriginHandlers               []TransportPreHandler
	postOriginHandlers              []TransportPostHandler
	headerRules                     *config.HeaderRules
	subgraphTransportOptions        *SubgraphTransportOptions
	subgraphCircuitBreakerOptions   *SubgraphCircuitBreakerOptions
	graphqlMetricsConfig            *GraphQLMetricsConfig
	routerTrafficConfig             *config.RouterTrafficConfiguration
	batchingConfig                  *BatchingConfig
	fileUploadConfig                *config.FileUpload
	accessController                *AccessController
	retryOptions                    retrytransport.RetryOptions
	redisClient                     rd.RDCloser
	mcpServer                       *mcpserver.GraphQLSchemaServer
	processStartTime                time.Time
	developmentMode                 bool
	healthcheck                     health.Checker
	accessLogsConfig                *AccessLogsConfig
	// If connecting to localhost inside Docker fails, fallback to the docker internal address for the host
	localhostFallbackInsideDocker bool
	tlsServerConfig               *tls.Config
	tlsConfig                     *TlsConfig
	telemetryAttributes           []config.CustomAttribute
	tracePropagators              []propagation.TextMapPropagator
	compositePropagator           propagation.TextMapPropagator
	// Poller
	configPoller                 configpoller.ConfigPoller
	selfRegister                 selfregister.SelfRegister
	registrationInfo             *nodev1.RegistrationInfo
	securityConfiguration        config.SecurityConfiguration
	customModules                []Module
	engineExecutionConfiguration config.EngineExecutionConfiguration
	// should be removed once the users have migrated to the new overrides config
	overrideRoutingURLConfiguration config.OverrideRoutingURLConfiguration
	// the new overrides config
	overrides                     config.OverridesConfiguration
	authorization                 *config.AuthorizationConfiguration
	rateLimit                     *config.RateLimitConfiguration
	webSocketConfiguration        *config.WebSocketConfiguration
	subgraphErrorPropagation      config.SubgraphErrorPropagationConfiguration
	clientHeader                  config.ClientHeader
	cacheWarmup                   *config.CacheWarmupConfiguration
	subscriptionHeartbeatInterval time.Duration
	hostName                      string
	mcp                           config.MCPConfiguration
	plugins                       config.PluginsConfiguration
	tracingAttributes             []config.CustomAttribute
}

// Usage returns an anonymized version of the config for usage tracking
// The anonymized usage map is not containing any sensitive information
// It's not a anonymized copy of the config, but a map of properties explaining how the Router is configured
// The purpose is to get a high level understanding of which features are used
// instead of how exactly the Router is configured
func (c *Config) Usage() map[string]any {

	type Exporter struct {
		Name, Endpoint string
	}

	usage := make(map[string]any)

	usage["cors"] = c.corsOptions != nil && c.corsOptions.Enabled
	usage["aws_lambda"] = c.awsLambda
	usage["ip_anonymization"] = c.ipAnonymization != nil && c.ipAnonymization.Enabled
	usage["playground"] = c.playground
	usage["introspection"] = c.introspection
	usage["query_plans_enabled"] = c.queryPlansEnabled
	usage["graph_api_token"] = c.graphApiToken != ""
	usage["automatic_persisted_queries"] = c.automaticPersistedQueriesConfig.Enabled

	usage["apollo_compatibility_flags_enable_all"] = c.apolloCompatibilityFlags.EnableAll
	usage["apollo_compatibility_flags_replace_invalid_var_errors_enabled"] = c.apolloCompatibilityFlags.ReplaceInvalidVarErrors.Enabled
	usage["apollo_compatibility_flags_replace_validation_error_status_enabled"] = c.apolloCompatibilityFlags.ReplaceValidationErrorStatus.Enabled
	usage["apollo_compatibility_flags_replace_undefined_op_field_errors_enabled"] = c.apolloCompatibilityFlags.ReplaceUndefinedOpFieldErrors.Enabled
	usage["apollo_compatibility_flags_subscription_multipart_print_boundary_enabled"] = c.apolloCompatibilityFlags.SubscriptionMultipartPrintBoundary.Enabled
	usage["apollo_compatibility_flags_suppress_fetch_errors_enabled"] = c.apolloCompatibilityFlags.SuppressFetchErrors.Enabled
	usage["apollo_compatibility_flags_truncate_floats_enabled"] = c.apolloCompatibilityFlags.TruncateFloats.Enabled
	usage["apollo_compatibility_flags_value_completion_enabled"] = c.apolloCompatibilityFlags.ValueCompletion.Enabled
	usage["apollo_compatibility_flags_use_graphql_validation_failed_status_enabled"] = c.apolloCompatibilityFlags.UseGraphQLValidationFailedStatus.Enabled

	usage["apollo_router_compatibility_flags_replace_invalid_var_errors_enabled"] = c.apolloRouterCompatibilityFlags.ReplaceInvalidVarErrors.Enabled
	usage["apollo_router_compatibility_flags_subrequest_http_error_enabled"] = c.apolloRouterCompatibilityFlags.SubrequestHTTPError.Enabled
	usage["apollo_router_compatibility_flags_replace_invalid_var_errors_enabled"] = c.apolloRouterCompatibilityFlags.ReplaceInvalidVarErrors.Enabled

	usage["demo_mode"] = c.demoMode

	usage["tracing_enabled"] = c.traceConfig.Enabled
	if c.traceConfig != nil {
		exporters := make([]Exporter, len(c.traceConfig.Exporters))
		for i, exporter := range c.traceConfig.Exporters {
			exporters[i].Name = string(exporter.Exporter)
			exporters[i].Endpoint = exporter.Endpoint
		}
		usage["tracing_exporters"] = exporters
	}

	metricsEnabled := c.metricConfig != nil && c.metricConfig.IsEnabled()
	usage["metrics_enabled"] = metricsEnabled
	if metricsEnabled {
		usage["metrics_using_cloud_exporter"] = c.metricConfig.IsUsingCloudExporter
		usage["metrics_otel_enabled"] = c.metricConfig.OpenTelemetry.Enabled
		if c.metricConfig.OpenTelemetry.Enabled {
			exporters := make([]Exporter, len(c.metricConfig.OpenTelemetry.Exporters))
			for i, exporter := range c.metricConfig.OpenTelemetry.Exporters {
				exporters[i].Name = string(exporter.Exporter)
				exporters[i].Endpoint = exporter.Endpoint
			}
			usage["metrics_otel_exporters"] = exporters
			usage["metrics_otel_exclude_metrics"] = c.metricConfig.OpenTelemetry.ExcludeMetrics
			usage["metrics_otel_exclude_metrics_labels"] = c.metricConfig.OpenTelemetry.ExcludeMetricLabels
			usage["metrics_otel_engine_stats_enabled"] = c.metricConfig.OpenTelemetry.EngineStats.Enabled()
			usage["metrics_otel_graphql_cache"] = c.metricConfig.OpenTelemetry.GraphqlCache
			usage["metrics_otel_router_runtime"] = c.metricConfig.OpenTelemetry.RouterRuntime
			usage["metrics_otel_connection_stats"] = c.metricConfig.OpenTelemetry.ConnectionStats
		}
		usage["metrics_prometheus_enabled"] = c.metricConfig.Prometheus.Enabled
		if c.metricConfig.Prometheus.Enabled {
			usage["metrics_prometheus_graphql_cache"] = c.metricConfig.Prometheus.GraphqlCache
			usage["metrics_prometheus_engine_stats_enabled"] = c.metricConfig.Prometheus.EngineStats.Enabled()
			usage["metrics_prometheus_engine_stats_subscriptions"] = c.metricConfig.Prometheus.EngineStats.Subscription
			usage["metrics_prometheus_exclude_metrics"] = c.metricConfig.Prometheus.ExcludeMetrics
			usage["metrics_prometheus_exclude_metrics_labels"] = c.metricConfig.Prometheus.ExcludeMetricLabels
			usage["metrics_prometheus_exclude_scope_info"] = c.metricConfig.Prometheus.ExcludeScopeInfo
			usage["metrics_prometheus_schema_field_usage_enabled"] = c.metricConfig.Prometheus.PromSchemaFieldUsage.Enabled
			usage["metrics_prometheus_connection_stats"] = c.metricConfig.Prometheus.ConnectionStats
		}
	}

	usage["edfs_nats"] = len(c.eventsConfig.Providers.Nats) > 0
	usage["edfs_kafka"] = len(c.eventsConfig.Providers.Kafka) > 0

	usage["prometheus"] = c.prometheusServer != nil
	usage["custom_modules"] = len(c.customModules) > 0
	usage["header_rules"] = c.headerRules != nil && (c.headerRules.All != nil || len(c.headerRules.Subgraphs) > 0)
	usage["subgraph_transport_options"] = c.subgraphTransportOptions != nil
	usage["subgraph_circuit_breaker_options"] = c.subgraphCircuitBreakerOptions.IsEnabled()
	usage["graphql_metrics"] = c.graphqlMetricsConfig != nil && c.graphqlMetricsConfig.Enabled
	usage["batching"] = c.batchingConfig != nil && c.batchingConfig.Enabled
	if c.batchingConfig != nil && c.batchingConfig.Enabled {
		usage["batching_max_concurrent_routines"] = c.batchingConfig.MaxConcurrentRoutines
		usage["batching_max_entries_per_batch"] = c.batchingConfig.MaxEntriesPerBatch
		usage["batching_omit_extensions"] = c.batchingConfig.OmitExtensions
	}
	usage["file_upload"] = c.fileUploadConfig != nil && c.fileUploadConfig.Enabled
	if c.fileUploadConfig != nil && c.fileUploadConfig.Enabled {
		usage["file_upload_max_file_size"] = c.fileUploadConfig.MaxFileSizeBytes
		usage["file_upload_max_files"] = c.fileUploadConfig.MaxFiles
	}
	usage["access_controller"] = c.accessController != nil
	usage["retry_options"] = c.retryOptions.Enabled
	usage["development_mode"] = c.developmentMode
	usage["access_logs"] = c.accessLogsConfig != nil
	usage["localhost_fallback_inside_docker"] = c.localhostFallbackInsideDocker
	usage["tls_server"] = c.tlsServerConfig != nil
	usage["tls_client"] = c.tlsConfig != nil
	usage["self_register"] = c.selfRegister != nil
	usage["registration_info"] = c.registrationInfo != nil

	usage["security_configuration_block_mutations"] = c.securityConfiguration.BlockMutations.Enabled
	usage["security_configuration_block_subscriptions"] = c.securityConfiguration.BlockSubscriptions.Enabled
	usage["security_configuration_block_non_persisted_operations"] = c.securityConfiguration.BlockNonPersistedOperations.Enabled
	usage["security_configuration_complexity_calculation_cache"] = c.securityConfiguration.ComplexityCalculationCache != nil && c.securityConfiguration.ComplexityCalculationCache.Enabled
	usage["security_configuration_complexity_limits"] = c.securityConfiguration.ComplexityLimits != nil
	usage["security_configuration_depth_limit"] = c.securityConfiguration.DepthLimit != nil && c.securityConfiguration.DepthLimit.Enabled

	usage["engine_execution_configuration_enable_single_flight"] = c.engineExecutionConfiguration.EnableSingleFlight
	usage["engine_execution_configuration_enable_request_tracing"] = c.engineExecutionConfiguration.EnableRequestTracing
	usage["engine_execution_configuration_enable_net_poll"] = c.engineExecutionConfiguration.EnableNetPoll
	usage["engine_execution_configuration_execution_plan_cache_size"] = c.engineExecutionConfiguration.ExecutionPlanCacheSize
	usage["engine_execution_configuration_minify_subgraph_operations"] = c.engineExecutionConfiguration.MinifySubgraphOperations
	usage["engine_execution_configuration_enable_persisted_operations_cache"] = c.engineExecutionConfiguration.EnablePersistedOperationsCache
	usage["engine_execution_configuration_enable_normalization_cache"] = c.engineExecutionConfiguration.EnableNormalizationCache
	usage["engine_execution_configuration_normalization_cache_size"] = c.engineExecutionConfiguration.NormalizationCacheSize
	usage["engine_execution_configuration_operation_hash_cache_size"] = c.engineExecutionConfiguration.OperationHashCacheSize
	usage["engine_execution_configuration_parsekit_pool_size"] = c.engineExecutionConfiguration.ParseKitPoolSize
	usage["engine_execution_configuration_enable_validation_cache"] = c.engineExecutionConfiguration.EnableValidationCache
	usage["engine_execution_configuration_validation_cache_size"] = c.engineExecutionConfiguration.ValidationCacheSize
	usage["engine_execution_configuration_disable_exposing_variables_content_on_validation_error"] = c.engineExecutionConfiguration.DisableExposingVariablesContentOnValidationError
	usage["engine_execution_configuration_resolver_max_recyclable_parser_size"] = c.engineExecutionConfiguration.ResolverMaxRecyclableParserSize
	usage["engine_execution_configuration_enable_subgraph_fetch_operation_name"] = c.engineExecutionConfiguration.EnableSubgraphFetchOperationName
	usage["engine_execution_configuration_disable_variables_remapping"] = c.engineExecutionConfiguration.DisableVariablesRemapping

	usage["overrides_subgraphs"] = len(c.overrides.Subgraphs) > 0
	usage["authorization"] = c.authorization != nil
	usage["rate_limiting"] = c.rateLimit != nil

	if c.webSocketConfiguration != nil {
		usage["web_socket_configuration_enabled"] = c.webSocketConfiguration.Enabled
		usage["web_socket_configuration_absinthe_protocol"] = c.webSocketConfiguration.AbsintheProtocol.Enabled
		usage["web_socket_configuration_client_info_from_initial_payload"] = c.webSocketConfiguration.ClientInfoFromInitialPayload.Enabled
		usage["web_socket_configuration_authentication_from_initial_payload"] = c.webSocketConfiguration.Authentication.FromInitialPayload.Enabled
		usage["web_socket_configuration_authentication_export_token"] = c.webSocketConfiguration.Authentication.FromInitialPayload.ExportToken.Enabled
		usage["web_socket_configuration_forward_upgrade_headers"] = c.webSocketConfiguration.ForwardUpgradeHeaders.Enabled
		usage["web_socket_configuration_forward_upgrade_query_params"] = c.webSocketConfiguration.ForwardUpgradeQueryParams.Enabled

	} else {
		usage["web_socket_configuration_enabled"] = false
	}

	usage["subgraph_error_propagation_enabled"] = c.subgraphErrorPropagation.Enabled
	if c.subgraphErrorPropagation.Enabled {
		usage["subgraph_error_propagation_propagate_status_codes"] = c.subgraphErrorPropagation.PropagateStatusCodes
		usage["subgraph_error_propagation_mode"] = string(c.subgraphErrorPropagation.Mode)
		usage["subgraph_error_propagation_rewrite_paths"] = c.subgraphErrorPropagation.RewritePaths
		usage["subgraph_error_propagation_omit_locations"] = c.subgraphErrorPropagation.OmitLocations
		usage["subgraph_error_propagation_omit_extensions"] = c.subgraphErrorPropagation.OmitExtensions
		usage["subgraph_error_propagation_attach_service_name"] = c.subgraphErrorPropagation.AttachServiceName
		usage["subgraph_error_propagation_default_extension_code"] = c.subgraphErrorPropagation.DefaultExtensionCode
		usage["subgraph_error_propagation_allowed_extension_fields"] = c.subgraphErrorPropagation.AllowedExtensionFields
		usage["subgraph_error_propagation_allowed_fields"] = c.subgraphErrorPropagation.AllowedFields
	}

	if c.routerConfigPollerConfig != nil {
		usage["fallback_execution_config_storage_enabled"] = c.routerConfigPollerConfig.ExecutionConfig.FallbackStorage.Enabled
	}
	usage["cache_warmup"] = c.cacheWarmup != nil && c.cacheWarmup.Enabled
	if c.cacheWarmup != nil && c.cacheWarmup.Enabled {
		if c.cacheWarmup.Source.Filesystem != nil {
			usage["cache_warmup_source"] = "filesystem"
		} else {
			usage["cache_warmup_source"] = "cdn"
		}
		usage["cache_warmup_workers"] = c.cacheWarmup.Workers
		usage["cache_warmup_items_per_second"] = c.cacheWarmup.ItemsPerSecond
		usage["cache_warmup_timeout"] = c.cacheWarmup.Timeout.String()
	}

	usage["mcp"] = c.mcp.Enabled
	usage["mcp_enable_arbitrary_operations"] = c.mcp.EnableArbitraryOperations
	usage["mcp_exclude_mutations"] = c.mcp.ExcludeMutations
	usage["mcp_expose_schema"] = c.mcp.ExposeSchema

	usage["cosmo_cdn"] = c.cdnConfig.URL == "https://cosmo-cdn.wundergraph.com"

	usage["static_execution_config"] = c.staticExecutionConfig != nil

	if c.clusterName != "" {
		usage["cluster_name"] = c.clusterName
	} else {
		usage["cluster_name"] = "unknown"
	}

	if c.instanceID != "" {
		usage["instance_id"] = c.instanceID
	} else {
		usage["instance_id"] = "unknown"
	}

	usage["plugins_enabled"] = c.plugins.Enabled

	return usage
}
