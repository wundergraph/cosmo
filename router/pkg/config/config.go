package config

import (
	"fmt"
	"os"
	"time"

	"github.com/caarlos0/env/v11"
	"github.com/goccy/go-yaml"
	"github.com/joho/godotenv"

	"github.com/wundergraph/cosmo/router/internal/unique"
	"github.com/wundergraph/cosmo/router/pkg/otel/otelconfig"
)

const (
	DefaultConfigPath = "config.yaml"
)

type Graph struct {
	// Token is required if no router config path is provided
	Token string `yaml:"token,omitempty" env:"GRAPH_API_TOKEN"`
	// SignKey is used to validate the signature of the received config. The same key is used to publish the subgraph in sign mode.
	SignKey string `yaml:"sign_key,omitempty" env:"GRAPH_CONFIG_SIGN_KEY"`
}

type CustomStaticAttribute struct {
	Key   string `yaml:"key"`
	Value string `yaml:"value"`
}

type CustomDynamicAttribute struct {
	RequestHeader  string `yaml:"request_header,omitempty"`
	ContextField   string `yaml:"context_field,omitempty"`
	ResponseHeader string `yaml:"response_header,omitempty"`
}

type CustomAttribute struct {
	Key       string                  `yaml:"key"`
	Default   string                  `yaml:"default"`
	ValueFrom *CustomDynamicAttribute `yaml:"value_from,omitempty"`
}

type TracingExporterConfig struct {
	BatchTimeout  time.Duration `yaml:"batch_timeout,omitempty" envDefault:"10s"`
	ExportTimeout time.Duration `yaml:"export_timeout,omitempty" envDefault:"30s"`
}

type TracingGlobalFeatures struct {
	ExportGraphQLVariables bool `yaml:"export_graphql_variables" envDefault:"false" env:"TRACING_EXPORT_GRAPHQL_VARIABLES"`
	WithNewRoot            bool `yaml:"with_new_root" envDefault:"false" env:"TRACING_WITH_NEW_ROOT"`
}

type TracingExporter struct {
	Disabled              bool                `yaml:"disabled"`
	Exporter              otelconfig.Exporter `yaml:"exporter,omitempty"`
	Endpoint              string              `yaml:"endpoint,omitempty"`
	HTTPPath              string              `yaml:"path,omitempty" envDefault:"/v1/traces"`
	Headers               map[string]string   `yaml:"headers,omitempty"`
	TracingExporterConfig `yaml:",inline"`
}

type ResponseTraceHeader struct {
	Enabled    bool   `yaml:"enabled"`
	HeaderName string `yaml:"header_name" envDefault:"x-wg-trace-id"`
}

type Tracing struct {
	Enabled             bool                `yaml:"enabled" envDefault:"true" env:"TRACING_ENABLED"`
	SamplingRate        float64             `yaml:"sampling_rate" envDefault:"1" env:"TRACING_SAMPLING_RATE"`
	ParentBasedSampler  bool                `yaml:"parent_based_sampler" envDefault:"true" env:"TRACING_PARENT_BASED_SAMPLER"`
	Exporters           []TracingExporter   `yaml:"exporters"`
	Propagation         PropagationConfig   `yaml:"propagation"`
	ResponseTraceHeader ResponseTraceHeader `yaml:"response_trace_id"`

	TracingGlobalFeatures `yaml:",inline"`
}

type PropagationConfig struct {
	TraceContext bool `yaml:"trace_context" envDefault:"true"`
	Jaeger       bool `yaml:"jaeger"`
	B3           bool `yaml:"b3"`
	Baggage      bool `yaml:"baggage"`
	Datadog      bool `yaml:"datadog"`
}

type EngineStats struct {
	Subscriptions bool `yaml:"subscriptions" envDefault:"false" env:"ENGINE_STATS_SUBSCRIPTIONS"`
}

type Prometheus struct {
	Enabled             bool        `yaml:"enabled" envDefault:"true" env:"PROMETHEUS_ENABLED"`
	Path                string      `yaml:"path" envDefault:"/metrics" env:"PROMETHEUS_HTTP_PATH"`
	ListenAddr          string      `yaml:"listen_addr" envDefault:"127.0.0.1:8088" env:"PROMETHEUS_LISTEN_ADDR"`
	GraphqlCache        bool        `yaml:"graphql_cache" envDefault:"false" env:"PROMETHEUS_GRAPHQL_CACHE"`
	EngineStats         EngineStats `yaml:"engine_stats" envPrefix:"PROMETHEUS_"`
	ExcludeMetrics      RegExArray  `yaml:"exclude_metrics,omitempty" env:"PROMETHEUS_EXCLUDE_METRICS"`
	ExcludeMetricLabels RegExArray  `yaml:"exclude_metric_labels,omitempty" env:"PROMETHEUS_EXCLUDE_METRIC_LABELS"`
}

type MetricsOTLPExporter struct {
	Disabled    bool                           `yaml:"disabled"`
	Exporter    otelconfig.Exporter            `yaml:"exporter" envDefault:"http"`
	Endpoint    string                         `yaml:"endpoint"`
	HTTPPath    string                         `yaml:"path" envDefault:"/v1/metrics"`
	Headers     map[string]string              `yaml:"headers"`
	Temporality otelconfig.ExporterTemporality `yaml:"temporality"`
}

type Metrics struct {
	Attributes []CustomAttribute `yaml:"attributes"`
	OTLP       MetricsOTLP       `yaml:"otlp"`
	Prometheus Prometheus        `yaml:"prometheus"`
}

type MetricsOTLP struct {
	Enabled             bool                  `yaml:"enabled" envDefault:"true" env:"METRICS_OTLP_ENABLED"`
	RouterRuntime       bool                  `yaml:"router_runtime" envDefault:"true" env:"METRICS_OTLP_ROUTER_RUNTIME"`
	GraphqlCache        bool                  `yaml:"graphql_cache" envDefault:"false" env:"METRICS_OTLP_GRAPHQL_CACHE"`
	EngineStats         EngineStats           `yaml:"engine_stats" envPrefix:"METRICS_OTLP_"`
	ExcludeMetrics      RegExArray            `yaml:"exclude_metrics,omitempty" env:"METRICS_OTLP_EXCLUDE_METRICS"`
	ExcludeMetricLabels RegExArray            `yaml:"exclude_metric_labels,omitempty" env:"METRICS_OTLP_EXCLUDE_METRIC_LABELS"`
	Exporters           []MetricsOTLPExporter `yaml:"exporters"`
}

type Telemetry struct {
	ServiceName        string                  `yaml:"service_name" envDefault:"cosmo-router" env:"TELEMETRY_SERVICE_NAME"`
	Attributes         []CustomAttribute       `yaml:"attributes"`
	ResourceAttributes []CustomStaticAttribute `yaml:"resource_attributes"`
	Tracing            Tracing                 `yaml:"tracing"`
	Metrics            Metrics                 `yaml:"metrics"`
}

type CORS struct {
	Enabled          bool          `yaml:"enabled" envDefault:"true" env:"CORS_ENABLED"`
	AllowOrigins     []string      `yaml:"allow_origins" envDefault:"*" env:"CORS_ALLOW_ORIGINS"`
	AllowMethods     []string      `yaml:"allow_methods" envDefault:"HEAD,GET,POST" env:"CORS_ALLOW_METHODS"`
	AllowHeaders     []string      `yaml:"allow_headers" envDefault:"Origin,Content-Length,Content-Type" env:"CORS_ALLOW_HEADERS"`
	AllowCredentials bool          `yaml:"allow_credentials" envDefault:"true" env:"CORS_ALLOW_CREDENTIALS"`
	MaxAge           time.Duration `yaml:"max_age" envDefault:"5m" env:"CORS_MAX_AGE"`
}

type TrafficShapingRules struct {
	// All is a set of rules that apply to all requests
	All GlobalSubgraphRequestRule `yaml:"all"`
	// Apply to requests from clients to the router
	Router RouterTrafficConfiguration `yaml:"router"`
	// Subgraphs is a set of rules that apply to requests from the router to subgraphs. The key is the subgraph name.
	Subgraphs map[string]*GlobalSubgraphRequestRule `yaml:"subgraphs,omitempty"`
}

type FileUpload struct {
	Enabled          bool        `yaml:"enabled" envDefault:"true" env:"FILE_UPLOAD_ENABLED"`
	MaxFileSizeBytes BytesString `yaml:"max_file_size" envDefault:"50MB" env:"FILE_UPLOAD_MAX_FILE_SIZE"`
	MaxFiles         int         `yaml:"max_files" envDefault:"10" env:"FILE_UPLOAD_MAX_FILES"`
}

type RouterTrafficConfiguration struct {
	// MaxRequestBodyBytes is the maximum size of the request body in bytes
	MaxRequestBodyBytes BytesString `yaml:"max_request_body_size" envDefault:"5MB"`
	// MaxHeaderBytes is the maximum size of the request headers in bytes
	MaxHeaderBytes BytesString `yaml:"max_header_bytes" envDefault:"0MiB" env:"MAX_HEADER_BYTES"`
}

type GlobalSubgraphRequestRule struct {
	BackoffJitterRetry BackoffJitterRetry `yaml:"retry"`
	// See https://blog.cloudflare.com/the-complete-guide-to-golang-net-http-timeouts/
	RequestTimeout         time.Duration `yaml:"request_timeout,omitempty" envDefault:"60s"`
	DialTimeout            time.Duration `yaml:"dial_timeout,omitempty" envDefault:"30s"`
	ResponseHeaderTimeout  time.Duration `yaml:"response_header_timeout,omitempty" envDefault:"0s"`
	ExpectContinueTimeout  time.Duration `yaml:"expect_continue_timeout,omitempty" envDefault:"0s"`
	TLSHandshakeTimeout    time.Duration `yaml:"tls_handshake_timeout,omitempty" envDefault:"10s"`
	KeepAliveIdleTimeout   time.Duration `yaml:"keep_alive_idle_timeout,omitempty" envDefault:"0s"`
	KeepAliveProbeInterval time.Duration `yaml:"keep_alive_probe_interval,omitempty" envDefault:"30s"`
}

type SubgraphTrafficRequestRule struct {
	RequestTimeout time.Duration `yaml:"request_timeout,omitempty" envDefault:"60s"`
}

type GraphqlMetrics struct {
	Enabled           bool   `yaml:"enabled" envDefault:"true" env:"GRAPHQL_METRICS_ENABLED"`
	CollectorEndpoint string `yaml:"collector_endpoint" envDefault:"https://cosmo-metrics.wundergraph.com" env:"GRAPHQL_METRICS_COLLECTOR_ENDPOINT"`
}

type BackoffJitterRetry struct {
	Enabled     bool          `yaml:"enabled" envDefault:"true" env:"RETRY_ENABLED"`
	Algorithm   string        `yaml:"algorithm" envDefault:"backoff_jitter"`
	MaxAttempts int           `yaml:"max_attempts" envDefault:"5"`
	MaxDuration time.Duration `yaml:"max_duration" envDefault:"10s"`
	Interval    time.Duration `yaml:"interval" envDefault:"3s"`
}

type SubgraphCacheControlRule struct {
	Name  string `yaml:"name"`
	Value string `yaml:"value"`
}

type CacheControlPolicy struct {
	Enabled   bool                       `yaml:"enabled" envDefault:"false" env:"CACHE_CONTROL_POLICY_ENABLED"`
	Value     string                     `yaml:"value" env:"CACHE_CONTROL_POLICY_VALUE"`
	Subgraphs []SubgraphCacheControlRule `yaml:"subgraphs,omitempty"`
}

type HeaderRules struct {
	// All is a set of rules that apply to all requests
	All       *GlobalHeaderRule            `yaml:"all,omitempty"`
	Subgraphs map[string]*GlobalHeaderRule `yaml:"subgraphs,omitempty"`
}

type GlobalHeaderRule struct {
	// Request is a set of rules that apply to requests
	Request  []*RequestHeaderRule  `yaml:"request,omitempty"`
	Response []*ResponseHeaderRule `yaml:"response,omitempty"`
}

type HeaderRuleOperation string

const (
	HeaderRuleOperationPropagate HeaderRuleOperation = "propagate"
	HeaderRuleOperationSet       HeaderRuleOperation = "set"
)

type HeaderRule interface {
	GetOperation() HeaderRuleOperation
	GetMatching() string
}

type RequestHeaderRule struct {
	// Operation describes the header operation to perform e.g. "propagate"
	Operation HeaderRuleOperation `yaml:"op"`
	// Propagate options
	// Matching is the regex to match the header name against
	Matching string `yaml:"matching"`
	// Named is the exact header name to match
	Named string `yaml:"named"`
	// Rename renames the header's key to the provided value
	Rename string `yaml:"rename,omitempty"`
	// Default is the default value to set if the header is not present
	Default string `yaml:"default"`

	// Set header options
	// Name is the name of the header to set
	Name string `yaml:"name"`
	// Value is the value of the header to set
	Value string `yaml:"value"`
	// ValueFrom is the context field to get the value from, in propagating to subgraphs
	ValueFrom *CustomDynamicAttribute `yaml:"value_from,omitempty"`
}

func (r *RequestHeaderRule) GetOperation() HeaderRuleOperation {
	return r.Operation
}

func (r *RequestHeaderRule) GetMatching() string {
	return r.Matching
}

type ResponseHeaderRuleAlgorithm string

const (
	// ResponseHeaderRuleAlgorithmFirstWrite propagates the first response header from a subgraph to the client
	ResponseHeaderRuleAlgorithmFirstWrite ResponseHeaderRuleAlgorithm = "first_write"
	// ResponseHeaderRuleAlgorithmLastWrite propagates the last response header from a subgraph to the client
	ResponseHeaderRuleAlgorithmLastWrite ResponseHeaderRuleAlgorithm = "last_write"
	// ResponseHeaderRuleAlgorithmAppend appends all response headers from all subgraphs to a comma separated list of values in the client response
	ResponseHeaderRuleAlgorithmAppend ResponseHeaderRuleAlgorithm = "append"
	// ResponseHeaderRuleAlgorithmMostRestrictiveCacheControl propagates the most restrictive cache control header from all subgraph responses to the client
	ResponseHeaderRuleAlgorithmMostRestrictiveCacheControl ResponseHeaderRuleAlgorithm = "most_restrictive_cache_control"
)

type ResponseHeaderRule struct {
	// Operation describes the header operation to perform e.g. "propagate"
	Operation HeaderRuleOperation `yaml:"op"`
	// Matching is the regex to match the header name against
	Matching string `yaml:"matching"`
	// Named is the exact header name to match
	Named string `yaml:"named"`
	// Rename renames the header's key to the provided value
	Rename string `yaml:"rename,omitempty"`
	// Default is the default value to set if the header is not present
	Default string `yaml:"default"`
	// Algorithm is the algorithm to use when multiple headers are present
	Algorithm ResponseHeaderRuleAlgorithm `yaml:"algorithm,omitempty"`

	// Set header options
	// Name is the name of the header to set
	Name string `yaml:"name"`
	// Value is the value of the header to set
	Value string `yaml:"value"`
}

func (r *ResponseHeaderRule) GetOperation() HeaderRuleOperation {
	return r.Operation
}

func (r *ResponseHeaderRule) GetMatching() string {
	return r.Matching
}

type EngineDebugConfiguration struct {
	PrintOperationTransformations                bool `envDefault:"false" env:"ENGINE_DEBUG_PRINT_OPERATION_TRANSFORMATIONS" yaml:"print_operation_transformations"`
	PrintOperationEnableASTRefs                  bool `envDefault:"false" env:"ENGINE_DEBUG_PRINT_OPERATION_ENABLE_AST_REFS" yaml:"print_operation_enable_ast_refs"`
	PrintPlanningPaths                           bool `envDefault:"false" env:"ENGINE_DEBUG_PRINT_PLANNING_PATHS" yaml:"print_planning_paths"`
	PrintQueryPlans                              bool `envDefault:"false" env:"ENGINE_DEBUG_PRINT_QUERY_PLANS" yaml:"print_query_plans"`
	PrintIntermediateQueryPlans                  bool `envDefault:"false" env:"ENGINE_DEBUG_PRINT_INTERMEDIATE_QUERY_PLANS" yaml:"print_intermediate_query_plans"`
	PrintNodeSuggestions                         bool `envDefault:"false" env:"ENGINE_DEBUG_PRINT_NODE_SUGGESTIONS" yaml:"print_node_suggestions"`
	ConfigurationVisitor                         bool `envDefault:"false" env:"ENGINE_DEBUG_CONFIGURATION_VISITOR" yaml:"configuration_visitor"`
	PlanningVisitor                              bool `envDefault:"false" env:"ENGINE_DEBUG_PLANNING_VISITOR" yaml:"planning_visitor"`
	DatasourceVisitor                            bool `envDefault:"false" env:"ENGINE_DEBUG_DATASOURCE_VISITOR" yaml:"datasource_visitor"`
	ReportWebSocketConnections                   bool `envDefault:"false" env:"ENGINE_DEBUG_REPORT_WEBSOCKET_CONNECTIONS" yaml:"report_websocket_connections"`
	ReportMemoryUsage                            bool `envDefault:"false" env:"ENGINE_DEBUG_REPORT_MEMORY_USAGE" yaml:"report_memory_usage"`
	EnableResolverDebugging                      bool `envDefault:"false" env:"ENGINE_DEBUG_ENABLE_RESOLVER_DEBUGGING" yaml:"enable_resolver_debugging"`
	EnablePersistedOperationsCacheResponseHeader bool `envDefault:"false" env:"ENGINE_DEBUG_ENABLE_PERSISTED_OPERATIONS_CACHE_RESPONSE_HEADER" yaml:"enable_persisted_operations_cache_response_header"`
	EnableNormalizationCacheResponseHeader       bool `envDefault:"false" env:"ENGINE_DEBUG_ENABLE_NORMALIZATION_CACHE_RESPONSE_HEADER" yaml:"enable_normalization_cache_response_header"`
	AlwaysIncludeQueryPlan                       bool `envDefault:"false" env:"ENGINE_DEBUG_ALWAYS_INCLUDE_QUERY_PLAN" yaml:"always_include_query_plan"`
	AlwaysSkipLoader                             bool `envDefault:"false" env:"ENGINE_DEBUG_ALWAYS_SKIP_LOADER" yaml:"always_skip_loader"`
}

type EngineExecutionConfiguration struct {
	Debug                                  EngineDebugConfiguration `yaml:"debug"`
	EnableSingleFlight                     bool                     `envDefault:"true" env:"ENGINE_ENABLE_SINGLE_FLIGHT" yaml:"enable_single_flight"`
	EnableRequestTracing                   bool                     `envDefault:"true" env:"ENGINE_ENABLE_REQUEST_TRACING" yaml:"enable_request_tracing"`
	EnableExecutionPlanCacheResponseHeader bool                     `envDefault:"false" env:"ENGINE_ENABLE_EXECUTION_PLAN_CACHE_RESPONSE_HEADER" yaml:"enable_execution_plan_cache_response_header"`
	MaxConcurrentResolvers                 int                      `envDefault:"1024" env:"ENGINE_MAX_CONCURRENT_RESOLVERS" yaml:"max_concurrent_resolvers,omitempty"`
	EnableNetPoll                          bool                     `envDefault:"true" env:"ENGINE_ENABLE_NET_POLL" yaml:"enable_net_poll"`
	WebSocketClientPollTimeout             time.Duration            `envDefault:"1s" env:"ENGINE_WEBSOCKET_CLIENT_POLL_TIMEOUT" yaml:"websocket_client_poll_timeout,omitempty"`
	WebSocketClientConnBufferSize          int                      `envDefault:"128" env:"ENGINE_WEBSOCKET_CLIENT_CONN_BUFFER_SIZE" yaml:"websocket_client_conn_buffer_size,omitempty"`
	WebSocketClientReadTimeout             time.Duration            `envDefault:"5s" env:"ENGINE_WEBSOCKET_CLIENT_READ_TIMEOUT" yaml:"websocket_client_read_timeout,omitempty"`
	ExecutionPlanCacheSize                 int64                    `envDefault:"1024" env:"ENGINE_EXECUTION_PLAN_CACHE_SIZE" yaml:"execution_plan_cache_size,omitempty"`
	MinifySubgraphOperations               bool                     `envDefault:"true" env:"ENGINE_MINIFY_SUBGRAPH_OPERATIONS" yaml:"minify_subgraph_operations"`
	EnablePersistedOperationsCache         bool                     `envDefault:"true" env:"ENGINE_ENABLE_PERSISTED_OPERATIONS_CACHE" yaml:"enable_persisted_operations_cache"`
	EnableNormalizationCache               bool                     `envDefault:"true" env:"ENGINE_ENABLE_NORMALIZATION_CACHE" yaml:"enable_normalization_cache"`
	NormalizationCacheSize                 int64                    `envDefault:"1024" env:"ENGINE_NORMALIZATION_CACHE_SIZE" yaml:"normalization_cache_size,omitempty"`
	OperationHashCacheSize                 int64                    `envDefault:"2048" env:"ENGINE_OPERATION_HASH_CACHE_SIZE" yaml:"operation_hash_cache_size,omitempty"`
	ParseKitPoolSize                       int                      `envDefault:"16" env:"ENGINE_PARSEKIT_POOL_SIZE" yaml:"parsekit_pool_size,omitempty"`
	EnableValidationCache                  bool                     `envDefault:"true" env:"ENGINE_ENABLE_VALIDATION_CACHE" yaml:"enable_validation_cache"`
	ValidationCacheSize                    int64                    `envDefault:"1024" env:"ENGINE_VALIDATION_CACHE_SIZE" yaml:"validation_cache_size,omitempty"`
	ResolverMaxRecyclableParserSize        int                      `envDefault:"32768" env:"ENGINE_RESOLVER_MAX_RECYCLABLE_PARSER_SIZE" yaml:"resolver_max_recyclable_parser_size,omitempty"`
	EnableSubgraphFetchOperationName       bool                     `envDefault:"false" env:"ENGINE_ENABLE_SUBGRAPH_FETCH_OPERATION_NAME" yaml:"enable_subgraph_fetch_operation_name"`
}

type BlockOperationConfiguration struct {
	Enabled   bool   `yaml:"enabled" envDefault:"false" env:"ENABLED"`
	Condition string `yaml:"condition" env:"CONDITION"`
}

type SecurityConfiguration struct {
	BlockMutations              BlockOperationConfiguration `yaml:"block_mutations" envPrefix:"SECURITY_BLOCK_MUTATIONS_"`
	BlockSubscriptions          BlockOperationConfiguration `yaml:"block_subscriptions" envPrefix:"SECURITY_BLOCK_SUBSCRIPTIONS_"`
	BlockNonPersistedOperations BlockOperationConfiguration `yaml:"block_non_persisted_operations" envPrefix:"SECURITY_BLOCK_NON_PERSISTED_OPERATIONS_"`
	ComplexityCalculationCache  *ComplexityCalculationCache `yaml:"complexity_calculation_cache"`
	ComplexityLimits            *ComplexityLimits           `yaml:"complexity_limits"`
	DepthLimit                  *QueryDepthConfiguration    `yaml:"depth_limit"`
}

type QueryDepthConfiguration struct {
	Enabled                   bool  `yaml:"enabled" envDefault:"false" env:"SECURITY_QUERY_DEPTH_ENABLED"`
	Limit                     int   `yaml:"limit,omitempty" envDefault:"0" env:"SECURITY_QUERY_DEPTH_LIMIT"`
	CacheSize                 int64 `yaml:"cache_size,omitempty" envDefault:"1024" env:"SECURITY_QUERY_DEPTH_CACHE_SIZE"`
	IgnorePersistedOperations bool  `yaml:"ignore_persisted_operations,omitempty" envDefault:"false" env:"SECURITY_QUERY_DEPTH_IGNORE_PERSISTED_OPERATIONS"`
}

type ComplexityCalculationCache struct {
	Enabled   bool  `yaml:"enabled" envDefault:"false" env:"SECURITY_COMPLEXITY_CACHE_ENABLED"`
	CacheSize int64 `yaml:"size,omitempty" envDefault:"1024" env:"SECURITY_COMPLEXITY_CACHE_SIZE"`
}

type ComplexityLimits struct {
	Depth            *ComplexityLimit `yaml:"depth"`
	TotalFields      *ComplexityLimit `yaml:"total_fields"`
	RootFields       *ComplexityLimit `yaml:"root_fields"`
	RootFieldAliases *ComplexityLimit `yaml:"root_field_aliases"`
}

type ComplexityLimit struct {
	Enabled                   bool `yaml:"enabled" envDefault:"false"`
	Limit                     int  `yaml:"limit,omitempty" envDefault:"0"`
	IgnorePersistedOperations bool `yaml:"ignore_persisted_operations,omitempty" envDefault:"false"`
}

func (c *ComplexityLimit) ApplyLimit(isPersistent bool) bool {
	return c.Enabled && (!isPersistent || isPersistent && !c.IgnorePersistedOperations)
}

type OverrideRoutingURLConfiguration struct {
	Subgraphs map[string]string `yaml:"subgraphs"`
}

type SubgraphOverridesConfiguration struct {
	RoutingURL                       string `yaml:"routing_url"`
	SubscriptionURL                  string `yaml:"subscription_url"`
	SubscriptionProtocol             string `yaml:"subscription_protocol"`
	SubscriptionWebsocketSubprotocol string `yaml:"subscription_websocket_subprotocol"`
}

type OverridesConfiguration struct {
	Subgraphs map[string]SubgraphOverridesConfiguration `yaml:"subgraphs"`
}

type JWKSConfiguration struct {
	URL             string        `yaml:"url"`
	Algorithms      []string      `yaml:"algorithms"`
	RefreshInterval time.Duration `yaml:"refresh_interval" envDefault:"1m"`
}

type HeaderSource struct {
	Type          string   `yaml:"type"`
	Name          string   `yaml:"name"`
	ValuePrefixes []string `yaml:"value_prefixes"`
}

type JWTAuthenticationConfiguration struct {
	JWKS              []JWKSConfiguration `yaml:"jwks"`
	HeaderName        string              `yaml:"header_name" envDefault:"Authorization"`
	HeaderValuePrefix string              `yaml:"header_value_prefix" envDefault:"Bearer"`
	HeaderSources     []HeaderSource      `yaml:"header_sources"`
}

type AuthenticationConfiguration struct {
	JWT JWTAuthenticationConfiguration `yaml:"jwt"`
}

type AuthorizationConfiguration struct {
	RequireAuthentication bool `yaml:"require_authentication" envDefault:"false" env:"REQUIRE_AUTHENTICATION"`
	// RejectOperationIfUnauthorized makes the router reject the whole GraphQL Operation if one field fails to authorize
	RejectOperationIfUnauthorized bool `yaml:"reject_operation_if_unauthorized" envDefault:"false" env:"REJECT_OPERATION_IF_UNAUTHORIZED"`
}

type RateLimitConfiguration struct {
	Enabled        bool                    `yaml:"enabled" envDefault:"false" env:"RATE_LIMIT_ENABLED"`
	Strategy       string                  `yaml:"strategy" envDefault:"simple" env:"RATE_LIMIT_STRATEGY"`
	SimpleStrategy RateLimitSimpleStrategy `yaml:"simple_strategy"`
	Storage        RedisConfiguration      `yaml:"storage"`
	// Debug ensures that retryAfter and resetAfter are set to stable values for testing
	// Debug also exposes the rate limit key in the response extension for debugging purposes
	Debug               bool                        `yaml:"debug" envDefault:"false" env:"RATE_LIMIT_DEBUG"`
	KeySuffixExpression string                      `yaml:"key_suffix_expression,omitempty" env:"RATE_LIMIT_KEY_SUFFIX_EXPRESSION"`
	ErrorExtensionCode  RateLimitErrorExtensionCode `yaml:"error_extension_code"`
}

type RateLimitErrorExtensionCode struct {
	Enabled bool   `yaml:"enabled" envDefault:"true" env:"RATE_LIMIT_ERROR_EXTENSION_CODE_ENABLED"`
	Code    string `yaml:"code" envDefault:"RATE_LIMIT_EXCEEDED" env:"RATE_LIMIT_ERROR_EXTENSION_CODE"`
}

type RedisConfiguration struct {
	URLs           []string `yaml:"urls,omitempty" env:"RATE_LIMIT_REDIS_URLS"`
	ClusterEnabled bool     `yaml:"cluster_enabled,omitempty" envDefault:"false" env:"RATE_LIMIT_REDIS_CLUSTER_ENABLED"`
	KeyPrefix      string   `yaml:"key_prefix,omitempty" envDefault:"cosmo_rate_limit" env:"RATE_LIMIT_REDIS_KEY_PREFIX"`
}

type RateLimitSimpleStrategy struct {
	Rate                           int           `yaml:"rate" envDefault:"10" env:"RATE_LIMIT_SIMPLE_RATE"`
	Burst                          int           `yaml:"burst" envDefault:"10" env:"RATE_LIMIT_SIMPLE_BURST"`
	Period                         time.Duration `yaml:"period" envDefault:"1s" env:"RATE_LIMIT_SIMPLE_PERIOD"`
	RejectExceedingRequests        bool          `yaml:"reject_exceeding_requests" envDefault:"false" env:"RATE_LIMIT_SIMPLE_REJECT_EXCEEDING_REQUESTS"`
	RejectStatusCode               int           `yaml:"reject_status_code" envDefault:"200" env:"RATE_LIMIT_SIMPLE_REJECT_STATUS_CODE"`
	HideStatsFromResponseExtension bool          `yaml:"hide_stats_from_response_extension" envDefault:"false" env:"RATE_LIMIT_SIMPLE_HIDE_STATS_FROM_RESPONSE_EXTENSION"`
}

type CDNConfiguration struct {
	URL       string      `yaml:"url" env:"CDN_URL" envDefault:"https://cosmo-cdn.wundergraph.com"`
	CacheSize BytesString `yaml:"cache_size,omitempty" env:"CDN_CACHE_SIZE" envDefault:"100MB"`
}

type NatsTokenBasedAuthentication struct {
	Token *string `yaml:"token,omitempty"`
}

type NatsCredentialsAuthentication struct {
	Password *string `yaml:"password,omitempty"`
	Username *string `yaml:"username,omitempty"`
}

type NatsAuthentication struct {
	UserInfo                     NatsCredentialsAuthentication `yaml:"user_info"`
	NatsTokenBasedAuthentication `yaml:"token,inline"`
}

type NatsEventSource struct {
	ID             string              `yaml:"id,omitempty"`
	URL            string              `yaml:"url,omitempty"`
	Authentication *NatsAuthentication `yaml:"authentication,omitempty"`
}

type KafkaSASLPlainAuthentication struct {
	Password *string `yaml:"password,omitempty"`
	Username *string `yaml:"username,omitempty"`
}

type KafkaAuthentication struct {
	SASLPlain KafkaSASLPlainAuthentication `yaml:"sasl_plain,omitempty"`
}

type KafkaTLSConfiguration struct {
	Enabled bool `yaml:"enabled" envDefault:"false"`
}

type KafkaEventSource struct {
	ID             string                 `yaml:"id,omitempty"`
	Brokers        []string               `yaml:"brokers,omitempty"`
	Authentication *KafkaAuthentication   `yaml:"authentication,omitempty"`
	TLS            *KafkaTLSConfiguration `yaml:"tls,omitempty"`
}

type EventProviders struct {
	Nats  []NatsEventSource  `yaml:"nats,omitempty"`
	Kafka []KafkaEventSource `yaml:"kafka,omitempty"`
}

type EventsConfiguration struct {
	Providers EventProviders `yaml:"providers,omitempty"`
}

type Cluster struct {
	Name string `yaml:"name,omitempty" env:"CLUSTER_NAME"`
}

type AbsintheProtocolConfiguration struct {
	// Enabled true if the Router should accept Requests over WebSockets using the Absinthe Protocol (Phoenix) Handler
	Enabled bool `yaml:"enabled" envDefault:"true" env:"WEBSOCKETS_ABSINTHE_ENABLED"`
	// HandlerPath is the path where the Absinthe Protocol Handler is mounted
	// On this specific path, the Router will accept WebSocket Requests using the Absinthe Protocol
	// even if the Sub-protocol is not set to "absinthe"
	// Legacy clients might not set the Sub-protocol Header, so this is a fallback
	HandlerPath string `yaml:"handler_path" envDefault:"/absinthe/socket" env:"WEBSOCKETS_ABSINTHE_HANDLER_PATH"`
}

type ComplianceConfig struct {
	AnonymizeIP AnonymizeIpConfiguration `yaml:"anonymize_ip,omitempty"`
}

type ExportTokenConfiguration struct {
	// Enabled true if the Router should export the token to the client request header
	Enabled bool `yaml:"enabled" envDefault:"true"`
	// HeaderKey is the name of the header where the token should be exported to
	HeaderKey string `yaml:"header_key,omitempty" envDefault:"Authorization"`
}

type WebSocketAuthenticationConfiguration struct {
	// Tells if the Router should look for the JWT Token in the initial payload of the WebSocket Connection
	FromInitialPayload InitialPayloadAuthenticationConfiguration `yaml:"from_initial_payload,omitempty"`
}

type InitialPayloadAuthenticationConfiguration struct {
	// When true the Router should look for the token in the initial payload of the WebSocket Connection
	Enabled bool `yaml:"enabled,omitempty" envDefault:"false"`
	// The key in the initial payload where the token is stored
	Key string `yaml:"key,omitempty" envDefault:"Authorization"`
	// ExportToken represents the configuration for exporting the token to the client request header.
	ExportToken ExportTokenConfiguration `yaml:"export_token"`
}

type WebSocketConfiguration struct {
	// Enabled true if the Router should accept Requests over WebSockets
	Enabled bool `yaml:"enabled" envDefault:"true" env:"WEBSOCKETS_ENABLED"`
	// AbsintheProtocol configuration for the Absinthe Protocol
	AbsintheProtocol AbsintheProtocolConfiguration `yaml:"absinthe_protocol,omitempty"`
	// ForwardUpgradeHeaders true if the Router should forward Upgrade Request Headers in the Extensions payload when starting a Subscription on a Subgraph
	ForwardUpgradeHeaders ForwardUpgradeHeadersConfiguration `yaml:"forward_upgrade_headers"`
	// ForwardUpgradeQueryParamsInExtensions true if the Router should forward Upgrade Request Query Parameters in the Extensions payload when starting a Subscription on a Subgraph
	ForwardUpgradeQueryParams ForwardUpgradeQueryParamsConfiguration `yaml:"forward_upgrade_query_params"`
	// ForwardInitialPayload true if the Router should forward the initial payload of a Subscription Request to the Subgraph
	ForwardInitialPayload bool `yaml:"forward_initial_payload" envDefault:"true" env:"WEBSOCKETS_FORWARD_INITIAL_PAYLOAD"`
	// Authentication configuration for the WebSocket Connection
	Authentication WebSocketAuthenticationConfiguration `yaml:"authentication,omitempty"`
}

type ForwardUpgradeHeadersConfiguration struct {
	Enabled   bool     `yaml:"enabled" envDefault:"true" env:"FORWARD_UPGRADE_HEADERS_ENABLED"`
	AllowList []string `yaml:"allow_list" envDefault:"Authorization" env:"FORWARD_UPGRADE_HEADERS_ALLOW_LIST"`
}

type ForwardUpgradeQueryParamsConfiguration struct {
	Enabled   bool     `yaml:"enabled" envDefault:"true" env:"FORWARD_UPGRADE_QUERY_PARAMS_ENABLED"`
	AllowList []string `yaml:"allow_list" envDefault:"Authorization" env:"FORWARD_UPGRADE_QUERY_PARAMS_ALLOW_LIST"`
}

type AnonymizeIpConfiguration struct {
	Enabled bool   `yaml:"enabled" envDefault:"true" env:"SECURITY_ANONYMIZE_IP_ENABLED"`
	Method  string `yaml:"method" envDefault:"redact" env:"SECURITY_ANONYMIZE_IP_METHOD"`
}

type TLSClientAuthConfiguration struct {
	CertFile string `yaml:"cert_file,omitempty" env:"TLS_CLIENT_AUTH_CERT_FILE"`
	Required bool   `yaml:"required" envDefault:"false" env:"TLS_CLIENT_AUTH_REQUIRED"`
}

type TLSServerConfiguration struct {
	Enabled  bool   `yaml:"enabled" envDefault:"false" env:"TLS_SERVER_ENABLED"`
	CertFile string `yaml:"cert_file,omitempty" env:"TLS_SERVER_CERT_FILE"`
	KeyFile  string `yaml:"key_file,omitempty" env:"TLS_SERVER_KEY_FILE"`

	ClientAuth TLSClientAuthConfiguration `yaml:"client_auth,omitempty"`
}

type TLSConfiguration struct {
	Server TLSServerConfiguration `yaml:"server"`
}

type SubgraphErrorPropagationMode string

const (
	SubgraphErrorPropagationModeWrapped     SubgraphErrorPropagationMode = "wrapped"
	SubgraphErrorPropagationModePassthrough SubgraphErrorPropagationMode = "pass-through"
)

type SubgraphErrorPropagationConfiguration struct {
	Enabled                bool                         `yaml:"enabled" envDefault:"true" env:"SUBGRAPH_ERROR_PROPAGATION_ENABLED"`
	PropagateStatusCodes   bool                         `yaml:"propagate_status_codes" envDefault:"false" env:"SUBGRAPH_ERROR_PROPAGATION_STATUS_CODES"`
	Mode                   SubgraphErrorPropagationMode `yaml:"mode" envDefault:"wrapped" env:"SUBGRAPH_ERROR_PROPAGATION_MODE"`
	RewritePaths           bool                         `yaml:"rewrite_paths" envDefault:"true" env:"SUBGRAPH_ERROR_PROPAGATION_REWRITE_PATHS"`
	OmitLocations          bool                         `yaml:"omit_locations" envDefault:"true" env:"SUBGRAPH_ERROR_PROPAGATION_OMIT_LOCATIONS"`
	OmitExtensions         bool                         `yaml:"omit_extensions" envDefault:"false" env:"SUBGRAPH_ERROR_PROPAGATION_OMIT_EXTENSIONS"`
	AttachServiceName      bool                         `yaml:"attach_service_name" envDefault:"true" env:"SUBGRAPH_ERROR_PROPAGATION_ATTACH_SERVICE_NAME"`
	DefaultExtensionCode   string                       `yaml:"default_extension_code" envDefault:"DOWNSTREAM_SERVICE_ERROR" env:"SUBGRAPH_ERROR_PROPAGATION_DEFAULT_EXTENSION_CODE"`
	AllowedExtensionFields []string                     `yaml:"allowed_extension_fields" envDefault:"code" env:"SUBGRAPH_ERROR_PROPAGATION_ALLOWED_EXTENSION_FIELDS"`
	AllowedFields          []string                     `yaml:"allowed_fields" env:"SUBGRAPH_ERROR_PROPAGATION_ALLOWED_FIELDS"`
}

type StorageProviders struct {
	S3    []S3StorageProvider    `yaml:"s3,omitempty"`
	CDN   []BaseStorageProvider  `yaml:"cdn,omitempty"`
	Redis []RedisStorageProvider `yaml:"redis,omitempty"`
}

type PersistedOperationsStorageConfig struct {
	ProviderID   string `yaml:"provider_id,omitempty" env:"PERSISTED_OPERATIONS_STORAGE_PROVIDER_ID"`
	ObjectPrefix string `yaml:"object_prefix,omitempty" env:"PERSISTED_OPERATIONS_STORAGE_OBJECT_PREFIX"`
}

type AutomaticPersistedQueriesStorageConfig struct {
	ProviderID   string `yaml:"provider_id,omitempty" env:"APQ_STORAGE_PROVIDER_ID"`
	ObjectPrefix string `yaml:"object_prefix,omitempty" env:"APQ_STORAGE_OBJECT_PREFIX"`
}

type S3StorageProvider struct {
	ID        string `yaml:"id,omitempty"`
	Endpoint  string `yaml:"endpoint,omitempty"`
	AccessKey string `yaml:"access_key,omitempty"`
	SecretKey string `yaml:"secret_key,omitempty"`
	Bucket    string `yaml:"bucket,omitempty"`
	Region    string `yaml:"region,omitempty"`
	Secure    bool   `yaml:"secure,omitempty"`
}

type BaseStorageProvider struct {
	ID  string `yaml:"id,omitempty"`
	URL string `yaml:"url,omitempty" envDefault:"https://cosmo-cdn.wundergraph.com"`
}

type RedisStorageProvider struct {
	ID             string   `yaml:"id,omitempty" env:"STORAGE_PROVIDER_REDIS_ID"`
	URLs           []string `yaml:"urls,omitempty" env:"STORAGE_PROVIDER_REDIS_URLS"`
	ClusterEnabled bool     `yaml:"cluster_enabled,omitempty" envDefault:"false" env:"STORAGE_PROVIDER_REDIS_CLUSTER_ENABLED"`
}

type PersistedOperationsCDNProvider struct {
	URL string `yaml:"url,omitempty" envDefault:"https://cosmo-cdn.wundergraph.com"`
}

type ExecutionConfigStorage struct {
	ProviderID string `yaml:"provider_id,omitempty" env:"PROVIDER_ID"`
	ObjectPath string `yaml:"object_path,omitempty" env:"OBJECT_PATH"`
}

type FallbackExecutionConfigStorage struct {
	Enabled    bool   `yaml:"enabled" envDefault:"false" env:"ENABLED"`
	ProviderID string `yaml:"provider_id,omitempty" env:"PROVIDER_ID"`
	ObjectPath string `yaml:"object_path,omitempty" env:"OBJECT_PATH"`
}

type ExecutionConfigFile struct {
	Path  string `yaml:"path,omitempty" env:"EXECUTION_CONFIG_FILE_PATH"`
	Watch bool   `yaml:"watch,omitempty" envDefault:"false" env:"EXECUTION_CONFIG_FILE_WATCH"`
}

type ExecutionConfig struct {
	File            ExecutionConfigFile            `yaml:"file,omitempty"`
	Storage         ExecutionConfigStorage         `yaml:"storage,omitempty" envPrefix:"EXECUTION_CONFIG_STORAGE_"`
	FallbackStorage FallbackExecutionConfigStorage `yaml:"fallback_storage,omitempty" envPrefix:"EXECUTION_CONFIG_FALLBACK_STORAGE_"`
}

type PersistedOperationsCacheConfig struct {
	Size BytesString `yaml:"size,omitempty" env:"PERSISTED_OPERATIONS_CACHE_SIZE" envDefault:"100MB"`
}

type AutomaticPersistedQueriesCacheConfig struct {
	Size BytesString `yaml:"size,omitempty" env:"APQ_CACHE_SIZE" envDefault:"100MB"`
	TTL  int         `yaml:"ttl" env:"APQ_CACHE_TTL" envDefault:"-1"`
}

type PersistedOperationsConfig struct {
	Cache   PersistedOperationsCacheConfig   `yaml:"cache"`
	Storage PersistedOperationsStorageConfig `yaml:"storage"`
}

type AutomaticPersistedQueriesConfig struct {
	Enabled bool                                   `yaml:"enabled" env:"APQ_ENABLED" envDefault:"false"`
	Cache   AutomaticPersistedQueriesCacheConfig   `yaml:"cache"`
	Storage AutomaticPersistedQueriesStorageConfig `yaml:"storage"`
}

type AccessLogsConfig struct {
	Enabled   bool                      `yaml:"enabled" env:"ACCESS_LOGS_ENABLED" envDefault:"true"`
	Buffer    AccessLogsBufferConfig    `yaml:"buffer,omitempty" env:"ACCESS_LOGS_BUFFER"`
	Output    AccessLogsOutputConfig    `yaml:"output,omitempty" env:"ACCESS_LOGS_OUTPUT"`
	Router    AccessLogsRouterConfig    `yaml:"router,omitempty" env:"ACCESS_LOGS_ROUTER"`
	Subgraphs AccessLogsSubgraphsConfig `yaml:"subgraphs,omitempty" env:"ACCESS_LOGS_SUBGRAPH"`
}

type AccessLogsBufferConfig struct {
	Enabled bool `yaml:"enabled" env:"ACCESS_LOGS_BUFFER_ENABLED" envDefault:"false"`
	// Size is the maximum number of log entries to buffer before flushing
	Size BytesString `yaml:"size" envDefault:"256KB" env:"ACCESS_LOGS_BUFFER_SIZE"`
	// FlushInterval is the maximum time to wait before flushing the buffer
	FlushInterval time.Duration `yaml:"flush_interval" envDefault:"10s" env:"ACCESS_LOGS_FLUSH_INTERVAL"`
}

type AccessLogsOutputConfig struct {
	Stdout AccessLogsStdOutOutputConfig `yaml:"stdout" env:"ACCESS_LOGS_OUTPUT_STDOUT"`
	File   AccessLogsFileOutputConfig   `yaml:"file,omitempty" env:"ACCESS_LOGS_FILE_OUTPUT"`
}

type AccessLogsStdOutOutputConfig struct {
	Enabled bool `yaml:"enabled" envDefault:"true" env:"ACCESS_LOGS_OUTPUT_STDOUT_ENABLED"`
}

type AccessLogsFileOutputConfig struct {
	Enabled bool   `yaml:"enabled" env:"ACCESS_LOGS_OUTPUT_FILE_ENABLED" envDefault:"false"`
	Path    string `yaml:"path" env:"ACCESS_LOGS_FILE_OUTPUT_PATH" envDefault:"access.log"`
}

type AccessLogsRouterConfig struct {
	Fields []CustomAttribute `yaml:"fields,omitempty" env:"ACCESS_LOGS_ROUTER_FIELDS"`
}

type AccessLogsSubgraphsConfig struct {
	Enabled bool              `yaml:"enabled" env:"ACCESS_LOGS_SUBGRAPH_ENABLED" envDefault:"false"`
	Fields  []CustomAttribute `yaml:"fields,omitempty" env:"ACCESS_LOGS_SUBGRAPH_FIELDS"`
}

type ApolloCompatibilityFlags struct {
	EnableAll                     bool                                             `yaml:"enable_all" envDefault:"false" env:"APOLLO_COMPATIBILITY_ENABLE_ALL"`
	ValueCompletion               ApolloCompatibilityValueCompletion               `yaml:"value_completion"`
	TruncateFloats                ApolloCompatibilityTruncateFloats                `yaml:"truncate_floats"`
	SuppressFetchErrors           ApolloCompatibilitySuppressFetchErrors           `yaml:"suppress_fetch_errors"`
	ReplaceUndefinedOpFieldErrors ApolloCompatibilityReplaceUndefinedOpFieldErrors `yaml:"replace_undefined_op_field_errors"`
	ReplaceInvalidVarErrors       ApolloCompatibilityReplaceInvalidVarErrors       `yaml:"replace_invalid_var_errors"`
}

type ApolloCompatibilityValueCompletion struct {
	Enabled bool `yaml:"enabled" envDefault:"false" env:"APOLLO_COMPATIBILITY_VALUE_COMPLETION_ENABLED"`
}

type ClientHeader struct {
	Name    string `yaml:"name,omitempty"`
	Version string `yaml:"version,omitempty"`
}

type ApolloCompatibilityTruncateFloats struct {
	Enabled bool `yaml:"enabled" envDefault:"false" env:"APOLLO_COMPATIBILITY_TRUNCATE_FLOATS_ENABLED"`
}

type ApolloCompatibilitySuppressFetchErrors struct {
	Enabled bool `yaml:"enabled" envDefault:"false" env:"APOLLO_COMPATIBILITY_SUPPRESS_FETCH_ERRORS_ENABLED"`
}

type ApolloCompatibilityReplaceUndefinedOpFieldErrors struct {
	Enabled bool `yaml:"enabled" envDefault:"false" env:"APOLLO_COMPATIBILITY_REPLACE_UNDEFINED_OP_FIELD_ERRORS_ENABLED"`
}

type ApolloCompatibilityReplaceInvalidVarErrors struct {
	Enabled bool `yaml:"enabled" envDefault:"false" env:"APOLLO_COMPATIBILITY_REPLACE_INVALID_VAR_ERRORS_ENABLED"`
}

type CacheWarmupSource struct {
	Filesystem *CacheWarmupFileSystemSource `yaml:"filesystem,omitempty"`
}

type CacheWarmupFileSystemSource struct {
	Path string `yaml:"path" env:"CACHE_WARMUP_SOURCE_FILESYSTEM_PATH"`
}

type CacheWarmupCDNSource struct{}

type CacheWarmupConfiguration struct {
	Enabled        bool              `yaml:"enabled" envDefault:"false" env:"CACHE_WARMUP_ENABLED"`
	Source         CacheWarmupSource `yaml:"source"  env:"CACHE_WARMUP_SOURCE"`
	Workers        int               `yaml:"workers" envDefault:"8" env:"CACHE_WARMUP_WORKERS"`
	ItemsPerSecond int               `yaml:"items_per_second" envDefault:"50" env:"CACHE_WARMUP_ITEMS_PER_SECOND"`
	Timeout        time.Duration     `yaml:"timeout" envDefault:"30s" env:"CACHE_WARMUP_TIMEOUT"`
}

type Config struct {
	Version string `yaml:"version,omitempty" ignored:"true"`

	InstanceID     string             `yaml:"instance_id,omitempty" env:"INSTANCE_ID"`
	Graph          Graph              `yaml:"graph,omitempty"`
	Telemetry      Telemetry          `yaml:"telemetry,omitempty"`
	GraphqlMetrics GraphqlMetrics     `yaml:"graphql_metrics,omitempty"`
	CORS           CORS               `yaml:"cors,omitempty"`
	Cluster        Cluster            `yaml:"cluster,omitempty"`
	Compliance     ComplianceConfig   `yaml:"compliance,omitempty"`
	TLS            TLSConfiguration   `yaml:"tls,omitempty"`
	CacheControl   CacheControlPolicy `yaml:"cache_control_policy"`

	Modules        map[string]interface{} `yaml:"modules,omitempty"`
	Headers        HeaderRules            `yaml:"headers,omitempty"`
	TrafficShaping TrafficShapingRules    `yaml:"traffic_shaping,omitempty"`
	FileUpload     FileUpload             `yaml:"file_upload,omitempty"`
	AccessLogs     AccessLogsConfig       `yaml:"access_logs,omitempty"`

	ListenAddr                    string                      `yaml:"listen_addr" envDefault:"localhost:3002" env:"LISTEN_ADDR"`
	ControlplaneURL               string                      `yaml:"controlplane_url" envDefault:"https://cosmo-cp.wundergraph.com" env:"CONTROLPLANE_URL"`
	PlaygroundConfig              PlaygroundConfig            `yaml:"playground,omitempty"`
	PlaygroundEnabled             bool                        `yaml:"playground_enabled" envDefault:"true" env:"PLAYGROUND_ENABLED"`
	IntrospectionEnabled          bool                        `yaml:"introspection_enabled" envDefault:"true" env:"INTROSPECTION_ENABLED"`
	QueryPlansEnabled             bool                        `yaml:"query_plans_enabled" envDefault:"true" env:"QUERY_PLANS_ENABLED"`
	LogLevel                      string                      `yaml:"log_level" envDefault:"info" env:"LOG_LEVEL"`
	JSONLog                       bool                        `yaml:"json_log" envDefault:"true" env:"JSON_LOG"`
	ShutdownDelay                 time.Duration               `yaml:"shutdown_delay" envDefault:"60s" env:"SHUTDOWN_DELAY"`
	GracePeriod                   time.Duration               `yaml:"grace_period" envDefault:"30s" env:"GRACE_PERIOD"`
	PollInterval                  time.Duration               `yaml:"poll_interval" envDefault:"10s" env:"POLL_INTERVAL"`
	PollJitter                    time.Duration               `yaml:"poll_jitter" envDefault:"5s" env:"POLL_JITTER"`
	HealthCheckPath               string                      `yaml:"health_check_path" envDefault:"/health" env:"HEALTH_CHECK_PATH"`
	ReadinessCheckPath            string                      `yaml:"readiness_check_path" envDefault:"/health/ready" env:"READINESS_CHECK_PATH"`
	LivenessCheckPath             string                      `yaml:"liveness_check_path" envDefault:"/health/live" env:"LIVENESS_CHECK_PATH"`
	GraphQLPath                   string                      `yaml:"graphql_path" envDefault:"/graphql" env:"GRAPHQL_PATH"`
	PlaygroundPath                string                      `yaml:"playground_path" envDefault:"/" env:"PLAYGROUND_PATH"`
	Authentication                AuthenticationConfiguration `yaml:"authentication,omitempty"`
	Authorization                 AuthorizationConfiguration  `yaml:"authorization,omitempty"`
	RateLimit                     RateLimitConfiguration      `yaml:"rate_limit,omitempty"`
	LocalhostFallbackInsideDocker bool                        `yaml:"localhost_fallback_inside_docker" envDefault:"true" env:"LOCALHOST_FALLBACK_INSIDE_DOCKER"`
	CDN                           CDNConfiguration            `yaml:"cdn,omitempty"`
	DevelopmentMode               bool                        `yaml:"dev_mode" envDefault:"false" env:"DEV_MODE"`
	Events                        EventsConfiguration         `yaml:"events,omitempty"`
	CacheWarmup                   CacheWarmupConfiguration    `yaml:"cache_warmup,omitempty"`

	RouterConfigPath   string `yaml:"router_config_path,omitempty" env:"ROUTER_CONFIG_PATH"`
	RouterRegistration bool   `yaml:"router_registration" env:"ROUTER_REGISTRATION" envDefault:"true"`

	OverrideRoutingURL OverrideRoutingURLConfiguration `yaml:"override_routing_url"`

	Overrides OverridesConfiguration `yaml:"overrides"`

	SecurityConfiguration SecurityConfiguration `yaml:"security,omitempty"`

	EngineExecutionConfiguration EngineExecutionConfiguration `yaml:"engine"`

	WebSocket WebSocketConfiguration `yaml:"websocket,omitempty"`

	SubgraphErrorPropagation SubgraphErrorPropagationConfiguration `yaml:"subgraph_error_propagation"`

	StorageProviders          StorageProviders                `yaml:"storage_providers"`
	ExecutionConfig           ExecutionConfig                 `yaml:"execution_config"`
	PersistedOperationsConfig PersistedOperationsConfig       `yaml:"persisted_operations"`
	AutomaticPersistedQueries AutomaticPersistedQueriesConfig `yaml:"automatic_persisted_queries"`
	ApolloCompatibilityFlags  ApolloCompatibilityFlags        `yaml:"apollo_compatibility_flags"`
	ClientHeader              ClientHeader                    `yaml:"client_header"`
}

type PlaygroundConfig struct {
	Enabled          bool   `yaml:"enabled" envDefault:"true" env:"PLAYGROUND_ENABLED"`
	Path             string `yaml:"path" envDefault:"/" env:"PLAYGROUND_PATH"`
	ConcurrencyLimit int    `yaml:"concurrency_limit,omitempty" envDefault:"10" env:"PLAYGROUND_CONCURRENCY_LIMIT"`
}

type LoadResult struct {
	Config        Config
	DefaultLoaded bool
}

func LoadConfig(configFilePath string, envOverride string) (*LoadResult, error) {
	_ = godotenv.Load(".env.local")
	_ = godotenv.Load()

	if envOverride != "" {
		_ = godotenv.Overload(envOverride)
	}

	cfg := &LoadResult{
		Config:        Config{},
		DefaultLoaded: true,
	}

	// Try to load the environment variables into the config

	err := env.Parse(&cfg.Config)
	if err != nil {
		return nil, err
	}

	// Read the custom config file

	var configFileBytes []byte

	if configFilePath == "" {
		configFilePath = os.Getenv("CONFIG_PATH")
		if configFilePath == "" {
			configFilePath = DefaultConfigPath
		}
	}

	isDefaultConfigPath := configFilePath == DefaultConfigPath
	configFileBytes, err = os.ReadFile(configFilePath)
	if err != nil {
		if isDefaultConfigPath {
			cfg.DefaultLoaded = false
		} else {
			return nil, fmt.Errorf("could not read custom config file %s: %w", configFilePath, err)
		}
	}

	if configFileBytes != nil {
		// Expand environment variables in the config file
		// and unmarshal it into the config struct

		configYamlData := os.ExpandEnv(string(configFileBytes))
		if err := yaml.Unmarshal([]byte(configYamlData), &cfg.Config); err != nil {
			return nil, fmt.Errorf("failed to unmarshal router config: %w", err)
		}

		// Validate the config against the JSON schema

		configFileBytes = []byte(configYamlData)

		err = ValidateConfig(configFileBytes, JSONSchema)
		if err != nil {
			return nil, fmt.Errorf("router config validation error: %w", err)
		}

		// Unmarshal the final config

		if err := yaml.Unmarshal(configFileBytes, &cfg.Config); err != nil {
			return nil, err
		}
	}

	// Post-process the config

	if cfg.Config.DevelopmentMode {
		cfg.Config.JSONLog = false
		cfg.Config.SubgraphErrorPropagation.Enabled = true
		cfg.Config.SubgraphErrorPropagation.PropagateStatusCodes = true
		cfg.Config.SubgraphErrorPropagation.OmitLocations = false
		cfg.Config.SubgraphErrorPropagation.AllowedExtensionFields = unique.SliceElements(append(cfg.Config.SubgraphErrorPropagation.AllowedExtensionFields, "code", "stacktrace"))
	}

	return cfg, nil
}
