package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/wundergraph/cosmo/router/internal/yamlmerge"

	"github.com/caarlos0/env/v11"
	"github.com/goccy/go-yaml"
	"go.uber.org/zap/zapcore"

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
	Expression     string `yaml:"expression,omitempty"` // only implemented by CustomAttribute in Metrics and Telemetry and Router Access Logs
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
	Attributes          []CustomAttribute   `yaml:"attributes"`

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
	ConnectionStats     bool        `yaml:"connection_stats" envDefault:"false" env:"PROMETHEUS_CONNECTION_STATS"`
	Streams             bool        `yaml:"streams" envDefault:"false" env:"PROMETHEUS_STREAM"`
	EngineStats         EngineStats `yaml:"engine_stats" envPrefix:"PROMETHEUS_"`
	CircuitBreaker      bool        `yaml:"circuit_breaker" envDefault:"false" env:"PROMETHEUS_CIRCUIT_BREAKER"`
	ExcludeMetrics      RegExArray  `yaml:"exclude_metrics,omitempty" env:"PROMETHEUS_EXCLUDE_METRICS"`
	ExcludeMetricLabels RegExArray  `yaml:"exclude_metric_labels,omitempty" env:"PROMETHEUS_EXCLUDE_METRIC_LABELS"`
	ExcludeScopeInfo    bool        `yaml:"exclude_scope_info" envDefault:"false" env:"PROMETHEUS_EXCLUDE_SCOPE_INFO"`

	SchemaFieldUsage PrometheusSchemaFieldUsage `yaml:"schema_usage" envPrefix:"PROMETHEUS_SCHEMA_FIELD_USAGE_"`
}

type PrometheusSchemaFieldUsage struct {
	Enabled             bool `yaml:"enabled" envDefault:"false" env:"ENABLED"`
	IncludeOperationSha bool `yaml:"include_operation_sha" envDefault:"false" env:"INCLUDE_OPERATION_SHA"`
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
	Attributes       []CustomAttribute `yaml:"attributes"`
	OTLP             MetricsOTLP       `yaml:"otlp"`
	Prometheus       Prometheus        `yaml:"prometheus"`
	CardinalityLimit int               `yaml:"experiment_cardinality_limit" envDefault:"2000" env:"METRICS_EXPERIMENT_CARDINALITY_LIMIT"`
}

type MetricsOTLP struct {
	Enabled             bool                  `yaml:"enabled" envDefault:"true" env:"METRICS_OTLP_ENABLED"`
	RouterRuntime       bool                  `yaml:"router_runtime" envDefault:"true" env:"METRICS_OTLP_ROUTER_RUNTIME"`
	GraphqlCache        bool                  `yaml:"graphql_cache" envDefault:"false" env:"METRICS_OTLP_GRAPHQL_CACHE"`
	ConnectionStats     bool                  `yaml:"connection_stats" envDefault:"false" env:"METRICS_OTLP_CONNECTION_STATS"`
	EngineStats         EngineStats           `yaml:"engine_stats" envPrefix:"METRICS_OTLP_"`
	CircuitBreaker      bool                  `yaml:"circuit_breaker" envDefault:"false" env:"METRICS_OTLP_CIRCUIT_BREAKER"`
	Streams             bool                  `yaml:"streams" envDefault:"false" env:"METRICS_OTLP_STREAM"`
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
	Subgraphs map[string]GlobalSubgraphRequestRule `yaml:"subgraphs,omitempty"`
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
	// DecompressionEnabled is the configuration for request compression
	DecompressionEnabled bool `yaml:"decompression_enabled" envDefault:"true"`
	// ResponseCompressionMinSize is the minimum size of the response body in bytes to enable response compression
	ResponseCompressionMinSize BytesString `yaml:"response_compression_min_size" envDefault:"4KiB" env:"RESPONSE_COMPRESSION_MIN_SIZE"`
}

type GlobalSubgraphRequestRule struct {
	BackoffJitterRetry BackoffJitterRetry `yaml:"retry"`
	CircuitBreaker     CircuitBreaker     `yaml:"circuit_breaker"`
	// See https://blog.cloudflare.com/the-complete-guide-to-golang-net-http-timeouts/

	RequestTimeout         *time.Duration `yaml:"request_timeout,omitempty" envDefault:"60s"`
	DialTimeout            *time.Duration `yaml:"dial_timeout,omitempty" envDefault:"30s"`
	ResponseHeaderTimeout  *time.Duration `yaml:"response_header_timeout,omitempty" envDefault:"0s"`
	ExpectContinueTimeout  *time.Duration `yaml:"expect_continue_timeout,omitempty" envDefault:"0s"`
	TLSHandshakeTimeout    *time.Duration `yaml:"tls_handshake_timeout,omitempty" envDefault:"10s"`
	KeepAliveIdleTimeout   *time.Duration `yaml:"keep_alive_idle_timeout,omitempty" envDefault:"90s"`
	KeepAliveProbeInterval *time.Duration `yaml:"keep_alive_probe_interval,omitempty" envDefault:"30s"`

	// Connection configuration
	MaxConnsPerHost     *int `yaml:"max_conns_per_host,omitempty" envDefault:"100"`
	MaxIdleConns        *int `yaml:"max_idle_conns,omitempty" envDefault:"1024"`
	MaxIdleConnsPerHost *int `yaml:"max_idle_conns_per_host,omitempty" envDefault:"20"`
}

type SubgraphTrafficRequestRule struct {
	RequestTimeout time.Duration `yaml:"request_timeout,omitempty" envDefault:"60s"`
}

type CircuitBreaker struct {
	Enabled                    bool          `yaml:"enabled" envDefault:"false"`
	ErrorThresholdPercentage   int64         `yaml:"error_threshold_percentage" envDefault:"50"`
	RequestThreshold           int64         `yaml:"request_threshold" envDefault:"20"`
	SleepWindow                time.Duration `yaml:"sleep_window" envDefault:"5s"`
	HalfOpenAttempts           int64         `yaml:"half_open_attempts" envDefault:"1"`
	RequiredSuccessfulAttempts int64         `yaml:"required_successful" envDefault:"1"`
	RollingDuration            time.Duration `yaml:"rolling_duration" envDefault:"10s"`
	NumBuckets                 int           `yaml:"num_buckets" envDefault:"10"`
	ExecutionTimeout           time.Duration `yaml:"execution_timeout" envDefault:"60s"`
	MaxConcurrentRequests      int64         `yaml:"max_concurrent_requests" envDefault:"-1"`
}

type GraphqlMetrics struct {
	Enabled           bool   `yaml:"enabled" envDefault:"true" env:"GRAPHQL_METRICS_ENABLED"`
	CollectorEndpoint string `yaml:"collector_endpoint" envDefault:"https://cosmo-metrics.wundergraph.com" env:"GRAPHQL_METRICS_COLLECTOR_ENDPOINT"`
}

type BackoffJitterRetry struct {
	Enabled     bool          `yaml:"enabled" envDefault:"true" env:"RETRY_ENABLED"`
	Algorithm   string        `yaml:"algorithm" envDefault:"backoff_jitter" env:"RETRY_ALGORITHM"`
	MaxAttempts int           `yaml:"max_attempts" envDefault:"5" env:"RETRY_MAX_ATTEMPTS"`
	MaxDuration time.Duration `yaml:"max_duration" envDefault:"10s" env:"RETRY_MAX_DURATION"`
	Interval    time.Duration `yaml:"interval" envDefault:"3s" env:"RETRY_INTERVAL"`
	Expression  string        `yaml:"expression,omitempty" env:"RETRY_EXPRESSION" envDefault:"IsRetryableStatusCode() || IsConnectionError() || IsTimeout()"`
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
	All             *GlobalHeaderRule            `yaml:"all,omitempty"`
	Subgraphs       map[string]*GlobalHeaderRule `yaml:"subgraphs,omitempty"`
	CookieWhitelist []string                     `yaml:"cookie_whitelist,omitempty"`
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
	Matching    string `yaml:"matching"`
	NegateMatch bool   `yaml:"negate_match,omitempty"`
	// Named is the exact header name to match
	Named string `yaml:"named"`
	// Rename renames the header's key to the provided value
	Rename string `yaml:"rename,omitempty"`
	// Default is the default value to set if the header is not present
	Default string `yaml:"default"`

	// Set header options
	// Name is the name of the header to set
	Name string `yaml:"name"`
	// Value is the static value to set for the header
	Value string `yaml:"value"`
	// Expression is the Expr Lang expression to evaluate for dynamic header values
	Expression string `yaml:"expression"`
	// ValueFrom is deprecated in favor of Expression. Use Expression instead.
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
	Matching    string `yaml:"matching"`
	NegateMatch bool   `yaml:"negate_match,omitempty"`
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
	Debug                                            EngineDebugConfiguration `yaml:"debug"`
	EnableSingleFlight                               bool                     `envDefault:"true" env:"ENGINE_ENABLE_SINGLE_FLIGHT" yaml:"enable_single_flight"`
	EnableRequestTracing                             bool                     `envDefault:"true" env:"ENGINE_ENABLE_REQUEST_TRACING" yaml:"enable_request_tracing"`
	EnableExecutionPlanCacheResponseHeader           bool                     `envDefault:"false" env:"ENGINE_ENABLE_EXECUTION_PLAN_CACHE_RESPONSE_HEADER" yaml:"enable_execution_plan_cache_response_header"`
	MaxConcurrentResolvers                           int                      `envDefault:"1024" env:"ENGINE_MAX_CONCURRENT_RESOLVERS" yaml:"max_concurrent_resolvers,omitempty"`
	EnableNetPoll                                    bool                     `envDefault:"true" env:"ENGINE_ENABLE_NET_POLL" yaml:"enable_net_poll"`
	WebSocketClientPollTimeout                       time.Duration            `envDefault:"1s" env:"ENGINE_WEBSOCKET_CLIENT_POLL_TIMEOUT" yaml:"websocket_client_poll_timeout,omitempty"`
	WebSocketClientConnBufferSize                    int                      `envDefault:"128" env:"ENGINE_WEBSOCKET_CLIENT_CONN_BUFFER_SIZE" yaml:"websocket_client_conn_buffer_size,omitempty"`
	WebSocketClientReadTimeout                       time.Duration            `envDefault:"5s" env:"ENGINE_WEBSOCKET_CLIENT_READ_TIMEOUT" yaml:"websocket_client_read_timeout,omitempty"`
	WebSocketClientWriteTimeout                      time.Duration            `envDefault:"10s" env:"ENGINE_WEBSOCKET_CLIENT_WRITE_TIMEOUT" yaml:"websocket_client_write_timeout,omitempty"`
	WebSocketClientPingInterval                      time.Duration            `envDefault:"15s" env:"ENGINE_WEBSOCKET_CLIENT_PING_INTERVAL" yaml:"websocket_client_ping_interval,omitempty"`
	WebSocketClientPingTimeout                       time.Duration            `envDefault:"30s" env:"ENGINE_WEBSOCKET_CLIENT_PING_TIMEOUT" yaml:"websocket_client_ping_timeout,omitempty"`
	WebSocketClientFrameTimeout                      time.Duration            `envDefault:"100ms" env:"ENGINE_WEBSOCKET_CLIENT_FRAME_TIMEOUT" yaml:"websocket_client_frame_timeout,omitempty"`
	ExecutionPlanCacheSize                           int64                    `envDefault:"1024" env:"ENGINE_EXECUTION_PLAN_CACHE_SIZE" yaml:"execution_plan_cache_size,omitempty"`
	MinifySubgraphOperations                         bool                     `envDefault:"true" env:"ENGINE_MINIFY_SUBGRAPH_OPERATIONS" yaml:"minify_subgraph_operations"`
	EnablePersistedOperationsCache                   bool                     `envDefault:"true" env:"ENGINE_ENABLE_PERSISTED_OPERATIONS_CACHE" yaml:"enable_persisted_operations_cache"`
	EnableNormalizationCache                         bool                     `envDefault:"true" env:"ENGINE_ENABLE_NORMALIZATION_CACHE" yaml:"enable_normalization_cache"`
	NormalizationCacheSize                           int64                    `envDefault:"1024" env:"ENGINE_NORMALIZATION_CACHE_SIZE" yaml:"normalization_cache_size,omitempty"`
	OperationHashCacheSize                           int64                    `envDefault:"2048" env:"ENGINE_OPERATION_HASH_CACHE_SIZE" yaml:"operation_hash_cache_size,omitempty"`
	ParseKitPoolSize                                 int                      `envDefault:"16" env:"ENGINE_PARSEKIT_POOL_SIZE" yaml:"parsekit_pool_size,omitempty"`
	EnableValidationCache                            bool                     `envDefault:"true" env:"ENGINE_ENABLE_VALIDATION_CACHE" yaml:"enable_validation_cache"`
	ValidationCacheSize                              int64                    `envDefault:"1024" env:"ENGINE_VALIDATION_CACHE_SIZE" yaml:"validation_cache_size,omitempty"`
	DisableExposingVariablesContentOnValidationError bool                     `envDefault:"false" env:"ENGINE_DISABLE_EXPOSING_VARIABLES_CONTENT_ON_VALIDATION_ERROR" yaml:"disable_exposing_variables_content_on_validation_error"`
	ResolverMaxRecyclableParserSize                  int                      `envDefault:"32768" env:"ENGINE_RESOLVER_MAX_RECYCLABLE_PARSER_SIZE" yaml:"resolver_max_recyclable_parser_size,omitempty"`
	EnableSubgraphFetchOperationName                 bool                     `envDefault:"false" env:"ENGINE_ENABLE_SUBGRAPH_FETCH_OPERATION_NAME" yaml:"enable_subgraph_fetch_operation_name"`
	DisableVariablesRemapping                        bool                     `envDefault:"false" env:"ENGINE_DISABLE_VARIABLES_REMAPPING" yaml:"disable_variables_remapping"`
	EnableRequireFetchReasons                        bool                     `envDefault:"false" env:"ENGINE_ENABLE_REQUIRE_FETCH_REASONS" yaml:"enable_require_fetch_reasons"`
	SubscriptionFetchTimeout                         time.Duration            `envDefault:"30s" env:"ENGINE_SUBSCRIPTION_FETCH_TIMEOUT" yaml:"subscription_fetch_timeout,omitempty"`
}

type BlockOperationConfiguration struct {
	Enabled   bool   `yaml:"enabled" envDefault:"false" env:"ENABLED"`
	Condition string `yaml:"condition" env:"CONDITION"`
}

type SecurityConfiguration struct {
	BlockMutations              BlockOperationConfiguration `yaml:"block_mutations" envPrefix:"SECURITY_BLOCK_MUTATIONS_"`
	BlockSubscriptions          BlockOperationConfiguration `yaml:"block_subscriptions" envPrefix:"SECURITY_BLOCK_SUBSCRIPTIONS_"`
	BlockNonPersistedOperations BlockOperationConfiguration `yaml:"block_non_persisted_operations" envPrefix:"SECURITY_BLOCK_NON_PERSISTED_OPERATIONS_"`
	BlockPersistedOperations    BlockOperationConfiguration `yaml:"block_persisted_operations" envPrefix:"SECURITY_BLOCK_PERSISTED_OPERATIONS_"`
	ComplexityCalculationCache  *ComplexityCalculationCache `yaml:"complexity_calculation_cache"`
	ComplexityLimits            *ComplexityLimits           `yaml:"complexity_limits"`
	DepthLimit                  *QueryDepthConfiguration    `yaml:"depth_limit"`
	ParserLimits                ParserLimitsConfiguration   `yaml:"parser_limits"`
	OperationNameLengthLimit    int                         `yaml:"operation_name_length_limit" envDefault:"512" env:"SECURITY_OPERATION_NAME_LENGTH_LIMIT"` // 0 is disabled
}

type ParserLimitsConfiguration struct {
	ApproximateDepthLimit int `yaml:"approximate_depth_limit,omitempty" envDefault:"200"` // 0 means disabled
	TotalFieldsLimit      int `yaml:"total_fields_limit,omitempty" envDefault:"3500"`     // 0 means disabled
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

	// For secret based where we need to create a jwk  entry with
	// a key id and algorithm
	Secret    string `yaml:"secret"`
	Algorithm string `yaml:"symmetric_algorithm"`
	KeyId     string `yaml:"header_key_id"`

	// Common
	Audiences []string `yaml:"audiences"`
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

func (n NatsEventSource) GetID() string {
	return n.ID
}

type KafkaSASLPlainAuthentication struct {
	Password *string `yaml:"password,omitempty"`
	Username *string `yaml:"username,omitempty"`
}

func (k KafkaSASLPlainAuthentication) IsSet() bool {
	return k.Username != nil && k.Password != nil
}

type KafkaSASLSCRAMMechanism string

const (
	KafkaSASLSCRAMMechanismSCRAM256 KafkaSASLSCRAMMechanism = "SCRAM-SHA-256"
	KafkaSASLSCRAMMechanismSCRAM512 KafkaSASLSCRAMMechanism = "SCRAM-SHA-512"
)

type KafkaSASLSCRAMAuthentication struct {
	Password  *string                  `yaml:"password,omitempty"`
	Username  *string                  `yaml:"username,omitempty"`
	Mechanism *KafkaSASLSCRAMMechanism `yaml:"mechanism,omitempty"`
}

func (k KafkaSASLSCRAMAuthentication) IsSet() bool {
	return k.Username != nil && k.Password != nil && k.Mechanism != nil
}

type KafkaAuthentication struct {
	SASLPlain KafkaSASLPlainAuthentication `yaml:"sasl_plain,omitempty"`
	SASLSCRAM KafkaSASLSCRAMAuthentication `yaml:"sasl_scram,omitempty"`
}

type KafkaTLSConfiguration struct {
	Enabled bool `yaml:"enabled" envDefault:"false"`
}

type KafkaEventSource struct {
	ID             string                 `yaml:"id,omitempty"`
	Brokers        []string               `yaml:"brokers,omitempty"`
	Authentication *KafkaAuthentication   `yaml:"authentication,omitempty"`
	TLS            *KafkaTLSConfiguration `yaml:"tls,omitempty"`
	FetchMaxWait   time.Duration          `yaml:"fetch_max_wait,omitempty"`
}

func (k KafkaEventSource) GetID() string {
	return k.ID
}

type RedisEventSource struct {
	ID             string   `yaml:"id,omitempty"`
	URLs           []string `yaml:"urls,omitempty"`
	ClusterEnabled bool     `yaml:"cluster_enabled"`
}

func (r RedisEventSource) GetID() string {
	return r.ID
}

type EventProviders struct {
	Nats  []NatsEventSource  `yaml:"nats,omitempty"`
	Kafka []KafkaEventSource `yaml:"kafka,omitempty"`
	Redis []RedisEventSource `yaml:"redis,omitempty"`
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
	// SetClientInfoFromInitialPayload configuration for the WebSocket Connection
	ClientInfoFromInitialPayload WebSocketClientInfoFromInitialPayloadConfiguration `yaml:"client_info_from_initial_payload"`
}

type WebSocketClientInfoFromInitialPayloadConfiguration struct {
	// Enabled true if the Router should set the client info from the initial payload of a Subscription Request to the Subgraph
	Enabled bool `yaml:"enabled" envDefault:"true" env:"WEBSOCKETS_CLIENT_INFO_FROM_INITIAL_PAYLOAD_ENABLED"`
	// NameField is the name of the field in the initial payload that will have the client name
	NameField string `yaml:"name_field" envDefault:"graphql-client-name" env:"WEBSOCKETS_CLIENT_INFO_FROM_INITIAL_PAYLOAD_NAME_FIELD"`
	// VersionField is the name of the field in the initial payload that will have the client version
	VersionField string `yaml:"version_field" envDefault:"graphql-client-version" env:"WEBSOCKETS_CLIENT_INFO_FROM_INITIAL_PAYLOAD_VERSION_FIELD"`
	// ForwardToRequestHeaders configuration for the WebSocket Connection
	ForwardToRequestHeaders ForwardToRequestHeadersConfiguration `yaml:"forward_to_request_headers"`
}

type ForwardToRequestHeadersConfiguration struct {
	// Enabled true if the Router should forward the client info to the request headers
	Enabled bool `yaml:"enabled" envDefault:"true" env:"WEBSOCKETS_CLIENT_INFO_FROM_INITIAL_PAYLOAD_FORWARD_TO_REQUEST_HEADERS_ENABLED"`
	// NameTargetHeader is the name of the header where the client name should be forwarded to
	NameTargetHeader string `yaml:"name_target_header" envDefault:"graphql-client-name" env:"WEBSOCKETS_CLIENT_INFO_FROM_INITIAL_PAYLOAD_NAME_TARGET_HEADER"`
	// VersionTargetHeader is the name of the header where the client version should be forwarded to
	VersionTargetHeader string `yaml:"version_target_header" envDefault:"graphql-client-version" env:"WEBSOCKETS_CLIENT_INFO_FROM_INITIAL_PAYLOAD_VERSION_TARGET_HEADER"`
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
	Enabled                 bool                         `yaml:"enabled" envDefault:"true" env:"ENABLED"`
	PropagateStatusCodes    bool                         `yaml:"propagate_status_codes" envDefault:"false" env:"STATUS_CODES"`
	Mode                    SubgraphErrorPropagationMode `yaml:"mode" envDefault:"wrapped" env:"MODE"`
	RewritePaths            bool                         `yaml:"rewrite_paths" envDefault:"true" env:"REWRITE_PATHS"`
	OmitLocations           bool                         `yaml:"omit_locations" envDefault:"true" env:"OMIT_LOCATIONS"`
	OmitExtensions          bool                         `yaml:"omit_extensions" envDefault:"false" env:"OMIT_EXTENSIONS"`
	AttachServiceName       bool                         `yaml:"attach_service_name" envDefault:"true" env:"ATTACH_SERVICE_NAME"`
	DefaultExtensionCode    string                       `yaml:"default_extension_code" envDefault:"DOWNSTREAM_SERVICE_ERROR" env:"DEFAULT_EXTENSION_CODE"`
	AllowAllExtensionFields bool                         `yaml:"allow_all_extension_fields" envDefault:"false" env:"ALLOW_ALL_EXTENSION_FIELDS"`
	AllowedExtensionFields  []string                     `yaml:"allowed_extension_fields" envDefault:"code" env:"ALLOWED_EXTENSION_FIELDS"`
	AllowedFields           []string                     `yaml:"allowed_fields" env:"ALLOWED_FIELDS"`
}

type StorageProviders struct {
	S3         []S3StorageProvider         `yaml:"s3,omitempty"`
	CDN        []CDNStorageProvider        `yaml:"cdn,omitempty"`
	Redis      []RedisStorageProvider      `yaml:"redis,omitempty"`
	FileSystem []FileSystemStorageProvider `yaml:"file_system,omitempty"`
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

type CDNStorageProvider struct {
	ID  string `yaml:"id,omitempty"`
	URL string `yaml:"url,omitempty" envDefault:"https://cosmo-cdn.wundergraph.com"`
}

type FileSystemStorageProvider struct {
	ID   string `yaml:"id,omitempty" env:"STORAGE_PROVIDER_FS_ID"`
	Path string `yaml:"path,omitempty" env:"STORAGE_PROVIDER_FS_PATH"`
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
	Path          string        `yaml:"path,omitempty" env:"EXECUTION_CONFIG_FILE_PATH"`
	Watch         bool          `yaml:"watch,omitempty" envDefault:"false" env:"EXECUTION_CONFIG_FILE_WATCH"`
	WatchInterval time.Duration `yaml:"watch_interval,omitempty" envDefault:"1s" env:"EXECUTION_CONFIG_FILE_WATCH_INTERVAL"`
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
	Disabled   bool                             `yaml:"disabled" env:"DISABLED" envDefault:"false"`
	LogUnknown bool                             `yaml:"log_unknown" env:"LOG_UNKNOWN" envDefault:"false"`
	Safelist   SafelistConfiguration            `yaml:"safelist" envPrefix:"SAFELIST_"`
	Cache      PersistedOperationsCacheConfig   `yaml:"cache"`
	Storage    PersistedOperationsStorageConfig `yaml:"storage"`
}

type SafelistConfiguration struct {
	Enabled bool `yaml:"enabled" envDefault:"false" env:"ENABLED"`
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

type BatchingConfig struct {
	Enabled            bool `yaml:"enabled" env:"BATCHING_ENABLED" envDefault:"false"`
	MaxConcurrency     int  `yaml:"max_concurrency" env:"BATCHING_MAX_CONCURRENCY" envDefault:"10"`
	MaxEntriesPerBatch int  `yaml:"max_entries_per_batch" env:"BATCHING_MAX_ENTRIES" envDefault:"100"`
	OmitExtensions     bool `yaml:"omit_extensions" env:"BATCHING_OMIT_EXTENSIONS" envDefault:"false"`
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
	Enabled bool     `yaml:"enabled" env:"ACCESS_LOGS_OUTPUT_FILE_ENABLED" envDefault:"false"`
	Path    string   `yaml:"path" env:"ACCESS_LOGS_FILE_OUTPUT_PATH" envDefault:"access.log"`
	Mode    FileMode `yaml:"mode" env:"ACCESS_LOGS_FILE_OUTPUT_MODE" envDefault:"0640"`
}

type AccessLogsRouterConfig struct {
	Fields                []CustomAttribute `yaml:"fields,omitempty" env:"ACCESS_LOGS_ROUTER_FIELDS"`
	IgnoreQueryParamsList []string          `yaml:"ignore_query_params_list,omitempty" env:"ACCESS_LOGS_ROUTER_IGNORE_QUERY_PARAMS_LIST" envDefault:"variables"`
}

type AccessLogsSubgraphsConfig struct {
	Enabled bool              `yaml:"enabled" env:"ACCESS_LOGS_SUBGRAPH_ENABLED" envDefault:"false"`
	Fields  []CustomAttribute `yaml:"fields,omitempty" env:"ACCESS_LOGS_SUBGRAPH_FIELDS"`
}

type ApolloCompatibilityFlags struct {
	EnableAll                          bool                    `yaml:"enable_all" envDefault:"false" env:"APOLLO_COMPATIBILITY_ENABLE_ALL"`
	ValueCompletion                    ApolloCompatibilityFlag `yaml:"value_completion" envPrefix:"APOLLO_COMPATIBILITY_VALUE_COMPLETION_"`
	TruncateFloats                     ApolloCompatibilityFlag `yaml:"truncate_floats" envPrefix:"APOLLO_COMPATIBILITY_TRUNCATE_FLOATS_"`
	SuppressFetchErrors                ApolloCompatibilityFlag `yaml:"suppress_fetch_errors" envPrefix:"APOLLO_COMPATIBILITY_SUPPRESS_FETCH_ERRORS_"`
	ReplaceUndefinedOpFieldErrors      ApolloCompatibilityFlag `yaml:"replace_undefined_op_field_errors" envPrefix:"APOLLO_COMPATIBILITY_REPLACE_UNDEFINED_OP_FIELD_ERRORS_"`
	ReplaceInvalidVarErrors            ApolloCompatibilityFlag `yaml:"replace_invalid_var_errors" envPrefix:"APOLLO_COMPATIBILITY_REPLACE_INVALID_VAR_ERRORS_"`
	ReplaceValidationErrorStatus       ApolloCompatibilityFlag `yaml:"replace_validation_error_status" envPrefix:"APOLLO_COMPATIBILITY_REPLACE_VALIDATION_ERROR_STATUS_"`
	SubscriptionMultipartPrintBoundary ApolloCompatibilityFlag `yaml:"subscription_multipart_print_boundary" envPrefix:"APOLLO_COMPATIBILITY_SUBSCRIPTION_MULTIPART_PRINT_BOUNDARY_"`
	UseGraphQLValidationFailedStatus   ApolloCompatibilityFlag `yaml:"use_graphql_validation_failed_status" envPrefix:"APOLLO_COMPATIBILITY_USE_GRAPHQL_VALIDATION_FAILED_STATUS_"`
}

type ApolloRouterCompatibilityFlags struct {
	ReplaceInvalidVarErrors ApolloCompatibilityFlag `yaml:"replace_invalid_var_errors" envPrefix:"APOLLO_ROUTER_COMPATIBILITY_REPLACE_INVALID_VAR_ERRORS_"`
	SubrequestHTTPError     ApolloCompatibilityFlag `yaml:"subrequest_http_error" envPrefix:"APOLLO_ROUTER_COMPATIBILITY_SUBREQUEST_HTTP_ERROR_"`
}

type ApolloCompatibilityFlag struct {
	Enabled bool `yaml:"enabled" envDefault:"false" env:"ENABLED"`
}

type ClientHeader struct {
	Name    string `yaml:"name,omitempty"`
	Version string `yaml:"version,omitempty"`
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

type MCPConfiguration struct {
	Enabled                   bool             `yaml:"enabled" envDefault:"false" env:"MCP_ENABLED"`
	Server                    MCPServer        `yaml:"server,omitempty"`
	Storage                   MCPStorageConfig `yaml:"storage,omitempty"`
	Session                   MCPSessionConfig `yaml:"session,omitempty"`
	GraphName                 string           `yaml:"graph_name" envDefault:"mygraph" env:"MCP_GRAPH_NAME"`
	ExcludeMutations          bool             `yaml:"exclude_mutations" envDefault:"false" env:"MCP_EXCLUDE_MUTATIONS"`
	EnableArbitraryOperations bool             `yaml:"enable_arbitrary_operations" envDefault:"false" env:"MCP_ENABLE_ARBITRARY_OPERATIONS"`
	ExposeSchema              bool             `yaml:"expose_schema" envDefault:"false" env:"MCP_EXPOSE_SCHEMA"`
	RouterURL                 string           `yaml:"router_url,omitempty" env:"MCP_ROUTER_URL"`
}

type MCPSessionConfig struct {
	Stateless bool `yaml:"stateless" envDefault:"true" env:"MCP_SESSION_STATELESS"`
}

type MCPStorageConfig struct {
	ProviderID string `yaml:"provider_id,omitempty" env:"MCP_STORAGE_PROVIDER_ID"`
}

type MCPServer struct {
	ListenAddr string `yaml:"listen_addr" envDefault:"localhost:5025" env:"MCP_SERVER_LISTEN_ADDR"`
	BaseURL    string `yaml:"base_url,omitempty" env:"MCP_SERVER_BASE_URL"`
}

type PluginsConfiguration struct {
	Enabled  bool                        `yaml:"enabled" envDefault:"false" env:"ENABLED"`
	Path     string                      `yaml:"path" envDefault:"plugins" env:"PATH"`
	Registry PluginRegistryConfiguration `yaml:"registry" envPrefix:"REGISTRY_"`
}

type PluginRegistryConfiguration struct {
	URL string `yaml:"url" env:"URL" envDefault:"cosmo-registry.wundergraph.com"`
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
	MCP            MCPConfiguration   `yaml:"mcp,omitempty"`
	DemoMode       bool               `yaml:"demo_mode,omitempty" envDefault:"false" env:"DEMO_MODE"`

	Modules        map[string]interface{} `yaml:"modules,omitempty"`
	Headers        HeaderRules            `yaml:"headers,omitempty"`
	TrafficShaping TrafficShapingRules    `yaml:"traffic_shaping,omitempty"`
	FileUpload     FileUpload             `yaml:"file_upload,omitempty"`
	AccessLogs     AccessLogsConfig       `yaml:"access_logs,omitempty"`
	Batching       BatchingConfig         `yaml:"batching,omitempty"`

	ListenAddr                    string                      `yaml:"listen_addr" envDefault:"localhost:3002" env:"LISTEN_ADDR"`
	ControlplaneURL               string                      `yaml:"controlplane_url" envDefault:"https://cosmo-cp.wundergraph.com" env:"CONTROLPLANE_URL"`
	PlaygroundConfig              PlaygroundConfig            `yaml:"playground,omitempty"`
	PlaygroundEnabled             bool                        `yaml:"playground_enabled" envDefault:"true" env:"PLAYGROUND_ENABLED"`
	IntrospectionEnabled          bool                        `yaml:"introspection_enabled" envDefault:"true" env:"INTROSPECTION_ENABLED"`
	QueryPlansEnabled             bool                        `yaml:"query_plans_enabled" envDefault:"true" env:"QUERY_PLANS_ENABLED"`
	LogLevel                      zapcore.Level               `yaml:"log_level" envDefault:"info" env:"LOG_LEVEL"`
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

	SubgraphErrorPropagation SubgraphErrorPropagationConfiguration `yaml:"subgraph_error_propagation" envPrefix:"SUBGRAPH_ERROR_PROPAGATION_"`

	StorageProviders               StorageProviders                `yaml:"storage_providers"`
	ExecutionConfig                ExecutionConfig                 `yaml:"execution_config"`
	PersistedOperationsConfig      PersistedOperationsConfig       `yaml:"persisted_operations" envPrefix:"PERSISTED_OPERATIONS_"`
	AutomaticPersistedQueries      AutomaticPersistedQueriesConfig `yaml:"automatic_persisted_queries"`
	ApolloCompatibilityFlags       ApolloCompatibilityFlags        `yaml:"apollo_compatibility_flags"`
	ApolloRouterCompatibilityFlags ApolloRouterCompatibilityFlags  `yaml:"apollo_router_compatibility_flags"`
	ClientHeader                   ClientHeader                    `yaml:"client_header"`

	Plugins PluginsConfiguration `yaml:"plugins" envPrefix:"PLUGINS_"`

	WatchConfig WatchConfig `yaml:"watch_config" envPrefix:"WATCH_CONFIG_"`
}

type WatchConfig struct {
	Enabled      bool                    `yaml:"enabled" envDefault:"false" env:"ENABLED"`
	Interval     time.Duration           `yaml:"interval" envDefault:"10s" env:"INTERVAL"`
	StartupDelay WatchConfigStartupDelay `yaml:"startup_delay" envPrefix:"STARTUP_DELAY_"`
}

type WatchConfigStartupDelay struct {
	Enabled bool          `yaml:"enabled" envDefault:"false" env:"ENABLED"`
	Maximum time.Duration `yaml:"maximum" envDefault:"10s" env:"MAXIMUM"`
}

type PlaygroundConfig struct {
	Enabled          bool   `yaml:"enabled" envDefault:"true" env:"PLAYGROUND_ENABLED"`
	Path             string `yaml:"path" envDefault:"/" env:"PLAYGROUND_PATH"`
	ConcurrencyLimit int    `yaml:"concurrency_limit,omitempty" envDefault:"10" env:"PLAYGROUND_CONCURRENCY_LIMIT"`
}

type LoadResult struct {
	Config Config

	// DefaultLoaded is set to true when no config is found at the default path and the defaults are used.
	DefaultLoaded bool
}

// LoadConfig takes in a configFilePathString which EITHER contains the name of one single configuration file
// or a comma separated list of file names (e.g. "base.config.yaml,override.config.yaml")
// This function loads the configuration files, apply environment variables and validates them with the json schema
// In case of loading multiple configuration files, we will do the validation step for every configuration
// and additionally post merging, since validations like oneOf can be bypassed
func LoadConfig(configFilePaths []string) (*LoadResult, error) {
	cfg := &LoadResult{
		Config:        Config{},
		DefaultLoaded: false,
	}

	// Try to load the environment variables into the config
	if err := env.Parse(&cfg.Config); err != nil {
		return nil, err
	}

	// Contains the bytes of every config as bytes
	configListBytes := make([][]byte, 0, len(configFilePaths))

	usesMultipleConfigs := len(configFilePaths) > 1

	// Join all errors in all configs and don't return early
	// This is so that the user can fix all config issues in one go
	var errs error

	for _, configFilePath := range configFilePaths {
		// In case the user specified space around the comma, we trim the spaces
		configFilePath = strings.TrimSpace(configFilePath)

		// Read the custom config file
		var configFileBytes []byte
		configFileBytes, err := os.ReadFile(configFilePath)

		if err != nil {
			if configFilePath == DefaultConfigPath {
				// We want to keep this simple and not allow the default config since we don't have a yaml to merge
				// for the default config
				if usesMultipleConfigs {
					errs = errors.Join(errs, errors.New("cannot use default config with multiple configurations"))
					continue
				}
				cfg.DefaultLoaded = true
			} else {
				errs = errors.Join(errs, fmt.Errorf("could not read custom config file %s: %w", configFilePath, err))
				continue
			}
		}

		if configFileBytes != nil {
			// Expand environment variables in the config file
			// and unmarshal it into the config struct
			configYamlData := os.ExpandEnv(string(configFileBytes))

			marshalValidationConfig := Config{}
			if err = yaml.Unmarshal([]byte(configYamlData), &marshalValidationConfig); err != nil {
				errs = errors.Join(errs, fmt.Errorf("failed to unmarshal router config for %s: %w", configFilePath, err))
				continue
			}

			// Validate the config against the JSON schema
			configFileBytes = []byte(configYamlData)

			err = ValidateConfig(configFileBytes, JSONSchema)
			if err != nil {
				errs = errors.Join(errs, fmt.Errorf("router config validation error for %s: %w", configFilePath, err))
				continue
			}

			// If there is at least a single existing join error
			// we know we won't attempt to merge the yaml configuration
			if errs == nil {
				configListBytes = append(configListBytes, configFileBytes)
			}
		}
	}

	if errs != nil {
		return nil, fmt.Errorf("errors while loading config files: %w", errs)
	}

	// In case defaultLoaded is true, it means that the user did not provide a
	// config file that was loaded, thus we don't have anything to process
	if !cfg.DefaultLoaded {
		yamlFinalBytes := configListBytes[0]
		// Attempt to merge only if we have more than one file
		if usesMultipleConfigs {
			// Merge to create the final yaml config
			processedBytes, err := yamlmerge.YAMLMerge(configListBytes, true)
			if err != nil {
				return nil, err
			}
			yamlFinalBytes = processedBytes
		}

		// Files can be joined to bypass validations like oneOf
		err := ValidateConfig(yamlFinalBytes, JSONSchema)
		if err != nil {
			return nil, fmt.Errorf("router config validation error when combined : %w", err)
		}

		// Unmarshal the final config version
		err = yaml.Unmarshal(yamlFinalBytes, &cfg.Config)
		if err != nil {
			return nil, fmt.Errorf("failed to unmarshal router config: %w", err)
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
