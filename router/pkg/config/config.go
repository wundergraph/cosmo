package config

import (
	"fmt"
	"os"
	"time"

	"github.com/goccy/go-yaml"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
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

type Tracing struct {
	Enabled            bool              `yaml:"enabled" envDefault:"true" env:"TRACING_ENABLED"`
	SamplingRate       float64           `yaml:"sampling_rate" envDefault:"1" env:"TRACING_SAMPLING_RATE"`
	ParentBasedSampler bool              `yaml:"parent_based_sampler" envDefault:"true" env:"TRACING_PARENT_BASED_SAMPLER"`
	Exporters          []TracingExporter `yaml:"exporters"`
	Propagation        PropagationConfig `yaml:"propagation"`

	TracingGlobalFeatures `yaml:",inline"`
}

type PropagationConfig struct {
	TraceContext bool `yaml:"trace_context" envDefault:"true"`
	Jaeger       bool `yaml:"jaeger"`
	B3           bool `yaml:"b3"`
	Baggage      bool `yaml:"baggage"`
}

type Prometheus struct {
	Enabled             bool       `yaml:"enabled" envDefault:"true" env:"PROMETHEUS_ENABLED"`
	Path                string     `yaml:"path" envDefault:"/metrics" env:"PROMETHEUS_HTTP_PATH"`
	ListenAddr          string     `yaml:"listen_addr" envDefault:"127.0.0.1:8088" env:"PROMETHEUS_LISTEN_ADDR"`
	ExcludeMetrics      RegExArray `yaml:"exclude_metrics,omitempty" env:"PROMETHEUS_EXCLUDE_METRICS"`
	ExcludeMetricLabels RegExArray `yaml:"exclude_metric_labels,omitempty" env:"PROMETHEUS_EXCLUDE_METRIC_LABELS"`
}

type MetricsOTLPExporter struct {
	Disabled bool                `yaml:"disabled"`
	Exporter otelconfig.Exporter `yaml:"exporter" envDefault:"http"`
	Endpoint string              `yaml:"endpoint"`
	HTTPPath string              `yaml:"path" envDefault:"/v1/metrics"`
	Headers  map[string]string   `yaml:"headers"`
}

type Metrics struct {
	OTLP       MetricsOTLP `yaml:"otlp"`
	Prometheus Prometheus  `yaml:"prometheus"`
}

type MetricsOTLP struct {
	Enabled       bool                  `yaml:"enabled" envDefault:"true" env:"METRICS_OTLP_ENABLED"`
	RouterRuntime bool                  `yaml:"router_runtime" envDefault:"true" env:"METRICS_OTLP_ROUTER_RUNTIME"`
	Exporters     []MetricsOTLPExporter `yaml:"exporters"`
}

type OtelResourceAttribute struct {
	Key   string `yaml:"key"`
	Value string `yaml:"value"`
}

type OtelAttributeFromValue struct {
	RequestHeader string `yaml:"request_header"`
}

type OtelAttribute struct {
	Key       string                  `yaml:"key"`
	Default   string                  `yaml:"default"`
	ValueFrom *OtelAttributeFromValue `yaml:"value_from,omitempty"`
}

type Telemetry struct {
	ServiceName        string                  `yaml:"service_name" envDefault:"cosmo-router" env:"TELEMETRY_SERVICE_NAME"`
	Attributes         []OtelAttribute         `yaml:"attributes"`
	ResourceAttributes []OtelResourceAttribute `yaml:"resource_attributes"`
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
}

type FileUpload struct {
	Enabled          bool        `yaml:"enabled" envDefault:"true" env:"FILE_UPLOAD_ENABLED"`
	MaxFileSizeBytes BytesString `yaml:"max_file_size" envDefault:"50MB" env:"FILE_UPLOAD_MAX_FILE_SIZE"`
	MaxFiles         int         `yaml:"max_files" envDefault:"10" env:"FILE_UPLOAD_MAX_FILES"`
}

type RouterTrafficConfiguration struct {
	// MaxRequestBodyBytes is the maximum size of the request body in bytes
	MaxRequestBodyBytes BytesString `yaml:"max_request_body_size" envDefault:"5MB"`
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

type HeaderRules struct {
	// All is a set of rules that apply to all requests
	All       GlobalHeaderRule            `yaml:"all,omitempty"`
	Subgraphs map[string]GlobalHeaderRule `yaml:"subgraphs,omitempty"`
}

type GlobalHeaderRule struct {
	// Request is a set of rules that apply to requests
	Request []RequestHeaderRule `yaml:"request,omitempty"`
}

type HeaderRuleOperation string

const (
	HeaderRuleOperationPropagate HeaderRuleOperation = "propagate"
)

type RequestHeaderRule struct {
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
}

type EngineDebugConfiguration struct {
	PrintOperationTransformations                bool `envDefault:"false" env:"ENGINE_DEBUG_PRINT_OPERATION_TRANSFORMATIONS" yaml:"print_operation_transformations"`
	PrintOperationEnableASTRefs                  bool `envDefault:"false" env:"ENGINE_DEBUG_PRINT_OPERATION_ENABLE_AST_REFS" yaml:"print_operation_enable_ast_refs"`
	PrintPlanningPaths                           bool `envDefault:"false" env:"ENGINE_DEBUG_PRINT_PLANNING_PATHS" yaml:"print_planning_paths"`
	PrintQueryPlans                              bool `envDefault:"false" env:"ENGINE_DEBUG_PRINT_QUERY_PLANS" yaml:"print_query_plans"`
	PrintNodeSuggestions                         bool `envDefault:"false" env:"ENGINE_DEBUG_PRINT_NODE_SUGGESTIONS" yaml:"print_node_suggestions"`
	ConfigurationVisitor                         bool `envDefault:"false" env:"ENGINE_DEBUG_CONFIGURATION_VISITOR" yaml:"configuration_visitor"`
	PlanningVisitor                              bool `envDefault:"false" env:"ENGINE_DEBUG_PLANNING_VISITOR" yaml:"planning_visitor"`
	DatasourceVisitor                            bool `envDefault:"false" env:"ENGINE_DEBUG_DATASOURCE_VISITOR" yaml:"datasource_visitor"`
	ReportWebSocketConnections                   bool `envDefault:"false" env:"ENGINE_DEBUG_REPORT_WEBSOCKET_CONNECTIONS" yaml:"report_websocket_connections"`
	ReportMemoryUsage                            bool `envDefault:"false" env:"ENGINE_DEBUG_REPORT_MEMORY_USAGE" yaml:"report_memory_usage"`
	EnableResolverDebugging                      bool `envDefault:"false" env:"ENGINE_DEBUG_ENABLE_RESOLVER_DEBUGGING" yaml:"enable_resolver_debugging"`
	EnablePersistedOperationsCacheResponseHeader bool `envDefault:"false" env:"ENGINE_DEBUG_ENABLE_PERSISTED_OPERATIONS_CACHE_RESPONSE_HEADER" yaml:"enable_persisted_operations_cache_response_header"`
	EnableNormalizationCacheResponseHeader       bool `envDefault:"false" env:"ENGINE_DEBUG_ENABLE_NORMALIZATION_CACHE_RESPONSE_HEADER" yaml:"enable_normalization_cache_response_header"`
}

type EngineExecutionConfiguration struct {
	Debug                                  EngineDebugConfiguration `yaml:"debug"`
	EnableSingleFlight                     bool                     `envDefault:"true" env:"ENGINE_ENABLE_SINGLE_FLIGHT" yaml:"enable_single_flight"`
	EnableRequestTracing                   bool                     `envDefault:"true" env:"ENGINE_ENABLE_REQUEST_TRACING" yaml:"enable_request_tracing"`
	EnableExecutionPlanCacheResponseHeader bool                     `envDefault:"false" env:"ENGINE_ENABLE_EXECUTION_PLAN_CACHE_RESPONSE_HEADER" yaml:"enable_execution_plan_cache_response_header"`
	MaxConcurrentResolvers                 int                      `envDefault:"256" env:"ENGINE_MAX_CONCURRENT_RESOLVERS" yaml:"max_concurrent_resolvers,omitempty"`
	EnableWebSocketEpollKqueue             bool                     `envDefault:"true" env:"ENGINE_ENABLE_WEBSOCKET_EPOLL_KQUEUE" yaml:"enable_websocket_epoll_kqueue"`
	EpollKqueuePollTimeout                 time.Duration            `envDefault:"1s" env:"ENGINE_EPOLL_KQUEUE_POLL_TIMEOUT" yaml:"epoll_kqueue_poll_timeout,omitempty"`
	EpollKqueueConnBufferSize              int                      `envDefault:"128" env:"ENGINE_EPOLL_KQUEUE_CONN_BUFFER_SIZE" yaml:"epoll_kqueue_conn_buffer_size,omitempty"`
	WebSocketReadTimeout                   time.Duration            `envDefault:"5s" env:"ENGINE_WEBSOCKET_READ_TIMEOUT" yaml:"websocket_read_timeout,omitempty"`
	ExecutionPlanCacheSize                 int64                    `envDefault:"1024" env:"ENGINE_EXECUTION_PLAN_CACHE_SIZE" yaml:"execution_plan_cache_size,omitempty"`
	MinifySubgraphOperations               bool                     `envDefault:"false" env:"ENGINE_MINIFY_SUBGRAPH_OPERATIONS" yaml:"minify_subgraph_operations"`
	EnablePersistedOperationsCache         bool                     `envDefault:"true" env:"ENGINE_ENABLE_PERSISTED_OPERATIONS_CACHE" yaml:"enable_persisted_operations_cache"`
	EnableNormalizationCache               bool                     `envDefault:"true" env:"ENGINE_ENABLE_NORMALIZATION_CACHE" yaml:"enable_normalization_cache"`
	NormalizationCacheSize                 int64                    `envDefault:"1024" env:"ENGINE_NORMALIZATION_CACHE_SIZE" yaml:"normalization_cache_size,omitempty"`
	ParseKitPoolSize                       int                      `envDefault:"16" env:"ENGINE_PARSEKIT_POOL_SIZE" yaml:"parsekit_pool_size,omitempty"`
	EnableValidationCache                  bool                     `envDefault:"true" env:"ENGINE_ENABLE_VALIDATION_CACHE" yaml:"enable_validation_cache"`
	ValidationCacheSize                    int64                    `envDefault:"1024" env:"ENGINE_VALIDATION_CACHE_SIZE" yaml:"validation_cache_size,omitempty"`
}

type SecurityConfiguration struct {
	BlockMutations              bool `yaml:"block_mutations" envDefault:"false" env:"SECURITY_BLOCK_MUTATIONS"`
	BlockSubscriptions          bool `yaml:"block_subscriptions" envDefault:"false" env:"SECURITY_BLOCK_SUBSCRIPTIONS"`
	BlockNonPersistedOperations bool `yaml:"block_non_persisted_operations" envDefault:"false" env:"SECURITY_BLOCK_NON_PERSISTED_OPERATIONS"`
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

type AuthenticationProviderJWKS struct {
	URL                 string        `yaml:"url"`
	HeaderNames         []string      `yaml:"header_names"`
	HeaderValuePrefixes []string      `yaml:"header_value_prefixes"`
	RefreshInterval     time.Duration `yaml:"refresh_interval" envDefault:"1m"`
}

type AuthenticationProvider struct {
	Name string                      `yaml:"name"`
	JWKS *AuthenticationProviderJWKS `yaml:"jwks"`
}

type AuthenticationConfiguration struct {
	Providers []AuthenticationProvider `yaml:"providers"`
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
	Debug bool `yaml:"debug" envDefault:"false" env:"RATE_LIMIT_DEBUG"`
}

type RedisConfiguration struct {
	Url       string `yaml:"url,omitempty" envDefault:"redis://localhost:6379" env:"RATE_LIMIT_REDIS_URL"`
	KeyPrefix string `yaml:"key_prefix,omitempty" envDefault:"cosmo_rate_limit" env:"RATE_LIMIT_REDIS_KEY_PREFIX"`
}

type RateLimitSimpleStrategy struct {
	Rate                    int           `yaml:"rate" envDefault:"10" env:"RATE_LIMIT_SIMPLE_RATE"`
	Burst                   int           `yaml:"burst" envDefault:"10" env:"RATE_LIMIT_SIMPLE_BURST"`
	Period                  time.Duration `yaml:"period" envDefault:"1s" env:"RATE_LIMIT_SIMPLE_PERIOD"`
	RejectExceedingRequests bool          `yaml:"reject_exceeding_requests" envDefault:"false" env:"RATE_LIMIT_SIMPLE_REJECT_EXCEEDING_REQUESTS"`
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
	Enabled              bool                         `yaml:"enabled" envDefault:"false" env:"SUBGRAPH_ERROR_PROPAGATION_ENABLED"`
	PropagateStatusCodes bool                         `yaml:"propagate_status_codes" envDefault:"false" env:"SUBGRAPH_ERROR_PROPAGATION_STATUS_CODES"`
	Mode                 SubgraphErrorPropagationMode `yaml:"mode" envDefault:"wrapped" env:"SUBGRAPH_ERROR_PROPAGATION_MODE"`
	RewritePaths         bool                         `yaml:"rewrite_paths" envDefault:"true" env:"SUBGRAPH_ERROR_PROPAGATION_REWRITE_PATHS"`
	OmitLocations        bool                         `yaml:"omit_locations" envDefault:"true" env:"SUBGRAPH_ERROR_PROPAGATION_OMIT_LOCATIONS"`
	OmitExtensions       bool                         `yaml:"omit_extensions" envDefault:"false" env:"SUBGRAPH_ERROR_PROPAGATION_OMIT_EXTENSIONS"`
}

type StorageProviders struct {
	S3  []S3StorageProvider  `yaml:"s3,omitempty"`
	CDN []CDNStorageProvider `yaml:"cdn,omitempty"`
}

type PersistedOperationsStorageConfig struct {
	ProviderID   string `yaml:"provider_id,omitempty" env:"PERSISTED_OPERATIONS_STORAGE_PROVIDER_ID"`
	ObjectPrefix string `yaml:"object_prefix,omitempty" env:"PERSISTED_OPERATIONS_STORAGE_OBJECT_PREFIX"`
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

type PersistedOperationsCDNProvider struct {
	URL string `yaml:"url,omitempty" envDefault:"https://cosmo-cdn.wundergraph.com"`
}

type ExecutionConfigStorage struct {
	ProviderID string `yaml:"provider_id,omitempty" env:"EXECUTION_CONFIG_STORAGE_PROVIDER_ID"`
	ObjectPath string `yaml:"object_path,omitempty" env:"EXECUTION_CONFIG_STORAGE_OBJECT_PATH"`
}

type ExecutionConfigFile struct {
	Path  string `yaml:"path,omitempty" env:"EXECUTION_CONFIG_FILE_PATH"`
	Watch bool   `yaml:"watch,omitempty" envDefault:"false" env:"EXECUTION_CONFIG_FILE_WATCH"`
}

type ExecutionConfig struct {
	File    ExecutionConfigFile    `yaml:"file,omitempty"`
	Storage ExecutionConfigStorage `yaml:"storage,omitempty"`
}

type PersistedOperationsCacheConfig struct {
	Size BytesString `yaml:"size,omitempty" env:"PERSISTED_OPERATIONS_CACHE_SIZE" envDefault:"100MB"`
}

type PersistedOperationsConfig struct {
	Cache   PersistedOperationsCacheConfig   `yaml:"cache"`
	Storage PersistedOperationsStorageConfig `yaml:"storage"`
}

type Config struct {
	Version string `yaml:"version,omitempty" ignored:"true"`

	InstanceID     string           `yaml:"instance_id,omitempty" env:"INSTANCE_ID"`
	Graph          Graph            `yaml:"graph,omitempty"`
	Telemetry      Telemetry        `yaml:"telemetry,omitempty"`
	GraphqlMetrics GraphqlMetrics   `yaml:"graphql_metrics,omitempty"`
	CORS           CORS             `yaml:"cors,omitempty"`
	Cluster        Cluster          `yaml:"cluster,omitempty"`
	Compliance     ComplianceConfig `yaml:"compliance,omitempty"`
	TLS            TLSConfiguration `yaml:"tls,omitempty"`

	Modules        map[string]interface{} `yaml:"modules,omitempty"`
	Headers        HeaderRules            `yaml:"headers,omitempty"`
	TrafficShaping TrafficShapingRules    `yaml:"traffic_shaping,omitempty"`
	FileUpload     FileUpload             `yaml:"file_upload,omitempty"`

	ListenAddr                    string                      `yaml:"listen_addr" envDefault:"localhost:3002" env:"LISTEN_ADDR"`
	ControlplaneURL               string                      `yaml:"controlplane_url" envDefault:"https://cosmo-cp.wundergraph.com" env:"CONTROLPLANE_URL"`
	PlaygroundEnabled             bool                        `yaml:"playground_enabled" envDefault:"true" env:"PLAYGROUND_ENABLED"`
	IntrospectionEnabled          bool                        `yaml:"introspection_enabled" envDefault:"true" env:"INTROSPECTION_ENABLED"`
	LogLevel                      string                      `yaml:"log_level" envDefault:"info" env:"LOG_LEVEL"`
	JSONLog                       bool                        `yaml:"json_log" envDefault:"true" env:"JSON_LOG"`
	ShutdownDelay                 time.Duration               `yaml:"shutdown_delay" envDefault:"60s" env:"SHUTDOWN_DELAY"`
	GracePeriod                   time.Duration               `yaml:"grace_period" envDefault:"30s" env:"GRACE_PERIOD"`
	PollInterval                  time.Duration               `yaml:"poll_interval" envDefault:"10s" env:"POLL_INTERVAL"`
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

	RouterConfigPath   string `yaml:"router_config_path,omitempty" env:"ROUTER_CONFIG_PATH"`
	RouterRegistration bool   `yaml:"router_registration" env:"ROUTER_REGISTRATION" envDefault:"true"`

	OverrideRoutingURL OverrideRoutingURLConfiguration `yaml:"override_routing_url"`

	Overrides OverridesConfiguration `yaml:"overrides"`

	SecurityConfiguration SecurityConfiguration `yaml:"security,omitempty"`

	EngineExecutionConfiguration EngineExecutionConfiguration `yaml:"engine"`

	WebSocket WebSocketConfiguration `yaml:"websocket,omitempty"`

	SubgraphErrorPropagation SubgraphErrorPropagationConfiguration `yaml:"subgraph_error_propagation"`

	StorageProviders          StorageProviders          `yaml:"storage_providers"`
	ExecutionConfig           ExecutionConfig           `yaml:"execution_config"`
	PersistedOperationsConfig PersistedOperationsConfig `yaml:"persisted_operations"`
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
	}

	return cfg, nil
}
