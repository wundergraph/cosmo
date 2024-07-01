package config

import (
	"fmt"
	"os"
	"time"

	"github.com/goccy/go-yaml"

	"github.com/joho/godotenv"
	"github.com/kelseyhightower/envconfig"
	"github.com/wundergraph/cosmo/router/pkg/otel/otelconfig"
)

const (
	DefaultConfigPath = "config.yaml"
)

type Graph struct {
	// Token is required if no router config path is provided
	Token string `yaml:"token,omitempty" envconfig:"GRAPH_API_TOKEN"`
	// SignKey is used to validate the signature of the received config. The same key is used to publish the subgraph in sign mode.
	SignKey string `yaml:"sign_key,omitempty" envconfig:"GRAPH_CONFIG_SIGN_KEY"`
}

type TracingExporterConfig struct {
	BatchTimeout  time.Duration `yaml:"batch_timeout,omitempty" default:"10s"`
	ExportTimeout time.Duration `yaml:"export_timeout,omitempty" default:"30s"`
}

type TracingGlobalFeatures struct {
	ExportGraphQLVariables bool `yaml:"export_graphql_variables" default:"false" envconfig:"TRACING_EXPORT_GRAPHQL_VARIABLES"`
	WithNewRoot            bool `yaml:"with_new_root" default:"false" envconfig:"TRACING_WITH_NEW_ROOT"`
}

type TracingExporter struct {
	Disabled              bool                `yaml:"disabled"`
	Exporter              otelconfig.Exporter `yaml:"exporter,omitempty"`
	Endpoint              string              `yaml:"endpoint,omitempty"`
	HTTPPath              string              `yaml:"path,omitempty" default:"/v1/traces"`
	Headers               map[string]string   `yaml:"headers,omitempty"`
	TracingExporterConfig `yaml:",inline"`
}

type Tracing struct {
	Enabled            bool              `yaml:"enabled" default:"true" envconfig:"TRACING_ENABLED"`
	SamplingRate       float64           `yaml:"sampling_rate" default:"1" envconfig:"TRACING_SAMPLING_RATE"`
	ParentBasedSampler bool              `yaml:"parent_based_sampler" default:"true" envconfig:"TRACING_PARENT_BASED_SAMPLER"`
	Exporters          []TracingExporter `yaml:"exporters"`
	Propagation        PropagationConfig `yaml:"propagation"`

	TracingGlobalFeatures `yaml:",inline"`
}

type PropagationConfig struct {
	TraceContext bool `yaml:"trace_context" default:"true"`
	Jaeger       bool `yaml:"jaeger"`
	B3           bool `yaml:"b3"`
	Baggage      bool `yaml:"baggage"`
}

type Prometheus struct {
	Enabled             bool       `yaml:"enabled" default:"true" envconfig:"PROMETHEUS_ENABLED"`
	Path                string     `yaml:"path" default:"/metrics" envconfig:"PROMETHEUS_HTTP_PATH"`
	ListenAddr          string     `yaml:"listen_addr" default:"127.0.0.1:8088" envconfig:"PROMETHEUS_LISTEN_ADDR"`
	ExcludeMetrics      RegExArray `yaml:"exclude_metrics,omitempty" envconfig:"PROMETHEUS_EXCLUDE_METRICS"`
	ExcludeMetricLabels RegExArray `yaml:"exclude_metric_labels,omitempty" envconfig:"PROMETHEUS_EXCLUDE_METRIC_LABELS"`
}

type MetricsOTLPExporter struct {
	Disabled bool                `yaml:"disabled"`
	Exporter otelconfig.Exporter `yaml:"exporter" default:"http"`
	Endpoint string              `yaml:"endpoint"`
	HTTPPath string              `yaml:"path" default:"/v1/metrics"`
	Headers  map[string]string   `yaml:"headers"`
}

type Metrics struct {
	OTLP       MetricsOTLP `yaml:"otlp"`
	Prometheus Prometheus  `yaml:"prometheus"`
}

type MetricsOTLP struct {
	Enabled       bool                  `yaml:"enabled" default:"true" envconfig:"METRICS_OTLP_ENABLED"`
	RouterRuntime bool                  `yaml:"router_runtime" default:"true" envconfig:"METRICS_OTLP_ROUTER_RUNTIME"`
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
	ServiceName        string                  `yaml:"service_name" default:"cosmo-router" envconfig:"TELEMETRY_SERVICE_NAME"`
	Attributes         []OtelAttribute         `yaml:"attributes"`
	ResourceAttributes []OtelResourceAttribute `yaml:"resource_attributes"`
	Tracing            Tracing                 `yaml:"tracing"`
	Metrics            Metrics                 `yaml:"metrics"`
}

type CORS struct {
	AllowOrigins     []string      `yaml:"allow_origins" default:"*" envconfig:"CORS_ALLOW_ORIGINS"`
	AllowMethods     []string      `yaml:"allow_methods" default:"HEAD,GET,POST" envconfig:"CORS_ALLOW_METHODS"`
	AllowHeaders     []string      `yaml:"allow_headers" default:"Origin,Content-Length,Content-Type" envconfig:"CORS_ALLOW_HEADERS"`
	AllowCredentials bool          `yaml:"allow_credentials" default:"true" envconfig:"CORS_ALLOW_CREDENTIALS"`
	MaxAge           time.Duration `yaml:"max_age" default:"5m" envconfig:"CORS_MAX_AGE"`
}

type TrafficShapingRules struct {
	// All is a set of rules that apply to all requests
	All GlobalSubgraphRequestRule `yaml:"all"`
	// Apply to requests from clients to the router
	Router RouterTrafficConfiguration `yaml:"router"`
}

type RouterTrafficConfiguration struct {
	// MaxRequestBodyBytes is the maximum size of the request body in bytes
	MaxRequestBodyBytes BytesString `yaml:"max_request_body_size" default:"5MB"`
}

type GlobalSubgraphRequestRule struct {
	BackoffJitterRetry BackoffJitterRetry `yaml:"retry"`
	// See https://blog.cloudflare.com/the-complete-guide-to-golang-net-http-timeouts/
	RequestTimeout         time.Duration `yaml:"request_timeout,omitempty" default:"60s"`
	DialTimeout            time.Duration `yaml:"dial_timeout,omitempty" default:"30s"`
	ResponseHeaderTimeout  time.Duration `yaml:"response_header_timeout,omitempty" default:"0s"`
	ExpectContinueTimeout  time.Duration `yaml:"expect_continue_timeout,omitempty" default:"0s"`
	TLSHandshakeTimeout    time.Duration `yaml:"tls_handshake_timeout,omitempty" default:"10s"`
	KeepAliveIdleTimeout   time.Duration `yaml:"keep_alive_idle_timeout,omitempty" default:"0s"`
	KeepAliveProbeInterval time.Duration `yaml:"keep_alive_probe_interval,omitempty" default:"30s"`
}

type GraphqlMetrics struct {
	Enabled           bool   `yaml:"enabled" default:"true" envconfig:"GRAPHQL_METRICS_ENABLED"`
	CollectorEndpoint string `yaml:"collector_endpoint" default:"https://cosmo-metrics.wundergraph.com" envconfig:"GRAPHQL_METRICS_COLLECTOR_ENDPOINT"`
}

type BackoffJitterRetry struct {
	Enabled     bool          `yaml:"enabled" default:"true" envconfig:"RETRY_ENABLED"`
	Algorithm   string        `yaml:"algorithm" default:"backoff_jitter"`
	MaxAttempts int           `yaml:"max_attempts" default:"5"`
	MaxDuration time.Duration `yaml:"max_duration" default:"10s"`
	Interval    time.Duration `yaml:"interval" default:"3s"`
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
	PrintOperationTransformations bool `default:"false" envconfig:"ENGINE_DEBUG_PRINT_OPERATION_TRANSFORMATIONS" yaml:"print_operation_transformations"`
	PrintOperationEnableASTRefs   bool `default:"false" envconfig:"ENGINE_DEBUG_PRINT_OPERATION_ENABLE_AST_REFS" yaml:"print_operation_enable_ast_refs"`
	PrintPlanningPaths            bool `default:"false" envconfig:"ENGINE_DEBUG_PRINT_PLANNING_PATHS" yaml:"print_planning_paths"`
	PrintQueryPlans               bool `default:"false" envconfig:"ENGINE_DEBUG_PRINT_QUERY_PLANS" yaml:"print_query_plans"`
	PrintNodeSuggestions          bool `default:"false" envconfig:"ENGINE_DEBUG_PRINT_NODE_SUGGESTIONS" yaml:"print_node_suggestions"`
	ConfigurationVisitor          bool `default:"false" envconfig:"ENGINE_DEBUG_CONFIGURATION_VISITOR" yaml:"configuration_visitor"`
	PlanningVisitor               bool `default:"false" envconfig:"ENGINE_DEBUG_PLANNING_VISITOR" yaml:"planning_visitor"`
	DatasourceVisitor             bool `default:"false" envconfig:"ENGINE_DEBUG_DATASOURCE_VISITOR" yaml:"datasource_visitor"`
	ReportWebSocketConnections    bool `default:"false" envconfig:"ENGINE_DEBUG_REPORT_WEBSOCKET_CONNECTIONS" yaml:"report_websocket_connections"`
	ReportMemoryUsage             bool `default:"false" envconfig:"ENGINE_DEBUG_REPORT_MEMORY_USAGE" yaml:"report_memory_usage"`
	EnableResolverDebugging       bool `default:"false" envconfig:"ENGINE_DEBUG_ENABLE_RESOLVER_DEBUGGING" yaml:"enable_resolver_debugging"`
}

type EngineExecutionConfiguration struct {
	Debug                                  EngineDebugConfiguration `yaml:"debug"`
	EnableSingleFlight                     bool                     `default:"true" envconfig:"ENGINE_ENABLE_SINGLE_FLIGHT" yaml:"enable_single_flight"`
	EnableRequestTracing                   bool                     `default:"true" envconfig:"ENGINE_ENABLE_REQUEST_TRACING" yaml:"enable_request_tracing"`
	EnableExecutionPlanCacheResponseHeader bool                     `default:"false" envconfig:"ENGINE_ENABLE_EXECUTION_PLAN_CACHE_RESPONSE_HEADER" yaml:"enable_execution_plan_cache_response_header"`
	MaxConcurrentResolvers                 int                      `default:"1024" envconfig:"ENGINE_MAX_CONCURRENT_RESOLVERS" yaml:"max_concurrent_resolvers,omitempty"`
	EnableWebSocketEpollKqueue             bool                     `default:"true" envconfig:"ENGINE_ENABLE_WEBSOCKET_EPOLL_KQUEUE" yaml:"enable_websocket_epoll_kqueue"`
	EpollKqueuePollTimeout                 time.Duration            `default:"1s" envconfig:"ENGINE_EPOLL_KQUEUE_POLL_TIMEOUT" yaml:"epoll_kqueue_poll_timeout,omitempty"`
	EpollKqueueConnBufferSize              int                      `default:"128" envconfig:"ENGINE_EPOLL_KQUEUE_CONN_BUFFER_SIZE" yaml:"epoll_kqueue_conn_buffer_size,omitempty"`
	WebSocketReadTimeout                   time.Duration            `default:"5s" envconfig:"ENGINE_WEBSOCKET_READ_TIMEOUT" yaml:"websocket_read_timeout,omitempty"`
	ExecutionPlanCacheSize                 int64                    `default:"10000" envconfig:"ENGINE_EXECUTION_PLAN_CACHE_SIZE" yaml:"execution_plan_cache_size,omitempty"`
}

type SecurityConfiguration struct {
	BlockMutations              bool `yaml:"block_mutations" default:"false" envconfig:"SECURITY_BLOCK_MUTATIONS"`
	BlockSubscriptions          bool `yaml:"block_subscriptions" default:"false" envconfig:"SECURITY_BLOCK_SUBSCRIPTIONS"`
	BlockNonPersistedOperations bool `yaml:"block_non_persisted_operations" default:"false" envconfig:"SECURITY_BLOCK_NON_PERSISTED_OPERATIONS"`
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
	RefreshInterval     time.Duration `yaml:"refresh_interval" default:"1m"`
}

type AuthenticationProvider struct {
	Name string                      `yaml:"name"`
	JWKS *AuthenticationProviderJWKS `yaml:"jwks"`
}

type AuthenticationConfiguration struct {
	Providers []AuthenticationProvider `yaml:"providers"`
}

type AuthorizationConfiguration struct {
	RequireAuthentication bool `yaml:"require_authentication" default:"false" envconfig:"REQUIRE_AUTHENTICATION"`
	// RejectOperationIfUnauthorized makes the router reject the whole GraphQL Operation if one field fails to authorize
	RejectOperationIfUnauthorized bool `yaml:"reject_operation_if_unauthorized" default:"false" envconfig:"REJECT_OPERATION_IF_UNAUTHORIZED"`
}

type RateLimitConfiguration struct {
	Enabled        bool                    `yaml:"enabled" default:"false" envconfig:"RATE_LIMIT_ENABLED"`
	Strategy       string                  `yaml:"strategy" default:"simple" envconfig:"RATE_LIMIT_STRATEGY"`
	SimpleStrategy RateLimitSimpleStrategy `yaml:"simple_strategy"`
	Storage        RedisConfiguration      `yaml:"storage"`
	// Debug ensures that retryAfter and resetAfter are set to stable values for testing
	Debug bool `yaml:"debug" default:"false" envconfig:"RATE_LIMIT_DEBUG"`
}

type RedisConfiguration struct {
	Url       string `yaml:"url,omitempty" default:"redis://localhost:6379" envconfig:"RATE_LIMIT_REDIS_URL"`
	KeyPrefix string `yaml:"key_prefix,omitempty" default:"cosmo_rate_limit" envconfig:"RATE_LIMIT_REDIS_KEY_PREFIX"`
}

type RateLimitSimpleStrategy struct {
	Rate                    int           `yaml:"rate" default:"10" envconfig:"RATE_LIMIT_SIMPLE_RATE"`
	Burst                   int           `yaml:"burst" default:"10" envconfig:"RATE_LIMIT_SIMPLE_BURST"`
	Period                  time.Duration `yaml:"period" default:"1s" envconfig:"RATE_LIMIT_SIMPLE_PERIOD"`
	RejectExceedingRequests bool          `yaml:"reject_exceeding_requests" default:"false" envconfig:"RATE_LIMIT_SIMPLE_REJECT_EXCEEDING_REQUESTS"`
}

type CDNConfiguration struct {
	URL       string      `yaml:"url" envconfig:"CDN_URL" default:"https://cosmo-cdn.wundergraph.com"`
	CacheSize BytesString `yaml:"cache_size,omitempty" envconfig:"CDN_CACHE_SIZE" default:"100MB"`
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
	Enabled bool `yaml:"enabled" default:"false"`
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
	Name string `yaml:"name,omitempty" envconfig:"CLUSTER_NAME"`
}

type AbsintheProtocolConfiguration struct {
	// Enabled true if the Router should accept Requests over WebSockets using the Absinthe Protocol (Phoenix) Handler
	Enabled bool `yaml:"enabled" default:"true" envconfig:"WEBSOCKETS_ABSINTHE_ENABLED"`
	// HandlerPath is the path where the Absinthe Protocol Handler is mounted
	// On this specific path, the Router will accept WebSocket Requests using the Absinthe Protocol
	// even if the Sub-protocol is not set to "absinthe"
	// Legacy clients might not set the Sub-protocol Header, so this is a fallback
	HandlerPath string `yaml:"handler_path" default:"/absinthe/socket" envconfig:"WEBSOCKETS_ABSINTHE_HANDLER_PATH"`
}

type ComplianceConfig struct {
	AnonymizeIP AnonymizeIpConfiguration `yaml:"anonymize_ip,omitempty"`
}

type WebSocketConfiguration struct {
	// Enabled true if the Router should accept Requests over WebSockets
	Enabled bool `yaml:"enabled" default:"true" envconfig:"WEBSOCKETS_ENABLED"`
	// AbsintheProtocol configuration for the Absinthe Protocol
	AbsintheProtocol AbsintheProtocolConfiguration `yaml:"absinthe_protocol,omitempty"`
	// ForwardUpgradeHeaders true if the Router should forward Upgrade Request Headers in the Extensions payload when starting a Subscription on a Subgraph
	ForwardUpgradeHeaders ForwardUpgradeHeadersConfiguration `yaml:"forward_upgrade_headers"`
	// ForwardUpgradeQueryParamsInExtensions true if the Router should forward Upgrade Request Query Parameters in the Extensions payload when starting a Subscription on a Subgraph
	ForwardUpgradeQueryParams ForwardUpgradeQueryParamsConfiguration `yaml:"forward_upgrade_query_params"`
	// ForwardInitialPayload true if the Router should forward the initial payload of a Subscription Request to the Subgraph
	ForwardInitialPayload bool `yaml:"forward_initial_payload" default:"true" envconfig:"WEBSOCKETS_FORWARD_INITIAL_PAYLOAD"`
}

type ForwardUpgradeHeadersConfiguration struct {
	Enabled   bool     `yaml:"enabled" default:"true" envconfig:"FORWARD_UPGRADE_HEADERS_ENABLED"`
	AllowList []string `yaml:"allow_list" default:"Authorization" envconfig:"FORWARD_UPGRADE_HEADERS_ALLOW_LIST"`
}

type ForwardUpgradeQueryParamsConfiguration struct {
	Enabled   bool     `yaml:"enabled" default:"true" envconfig:"FORWARD_UPGRADE_QUERY_PARAMS_ENABLED"`
	AllowList []string `yaml:"allow_list" default:"Authorization" envconfig:"FORWARD_UPGRADE_QUERY_PARAMS_ALLOW_LIST"`
}

type AnonymizeIpConfiguration struct {
	Enabled bool   `yaml:"enabled" default:"true" envconfig:"SECURITY_ANONYMIZE_IP_ENABLED"`
	Method  string `yaml:"method" default:"redact" envconfig:"SECURITY_ANONYMIZE_IP_METHOD"`
}

type TLSClientAuthConfiguration struct {
	CertFile string `yaml:"cert_file,omitempty" envconfig:"TLS_CLIENT_AUTH_CERT_FILE"`
	Required bool   `yaml:"required" default:"false" envconfig:"TLS_CLIENT_AUTH_REQUIRED"`
}

type TLSServerConfiguration struct {
	Enabled  bool   `yaml:"enabled" default:"false" envconfig:"TLS_SERVER_ENABLED"`
	CertFile string `yaml:"cert_file,omitempty" envconfig:"TLS_SERVER_CERT_FILE"`
	KeyFile  string `yaml:"key_file,omitempty" envconfig:"TLS_SERVER_KEY_FILE"`

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
	Enabled              bool                         `yaml:"enabled" default:"false" envconfig:"SUBGRAPH_ERROR_PROPAGATION_ENABLED"`
	PropagateStatusCodes bool                         `yaml:"propagate_status_codes" default:"false" envconfig:"SUBGRAPH_ERROR_PROPAGATION_STATUS_CODES"`
	Mode                 SubgraphErrorPropagationMode `yaml:"mode" default:"wrapped" envconfig:"SUBGRAPH_ERROR_PROPAGATION_MODE"`
	RewritePaths         bool                         `yaml:"rewrite_paths" default:"true" envconfig:"SUBGRAPH_ERROR_PROPAGATION_REWRITE_PATHS"`
	OmitLocations        bool                         `yaml:"omit_locations" default:"true" envconfig:"SUBGRAPH_ERROR_PROPAGATION_OMIT_LOCATIONS"`
	OmitExtensions       bool                         `yaml:"omit_extensions" default:"false" envconfig:"SUBGRAPH_ERROR_PROPAGATION_OMIT_EXTENSIONS"`
}

type Config struct {
	Version string `yaml:"version,omitempty" ignored:"true"`

	InstanceID     string           `yaml:"instance_id,omitempty" envconfig:"INSTANCE_ID"`
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

	ListenAddr                    string                      `yaml:"listen_addr" default:"localhost:3002" envconfig:"LISTEN_ADDR"`
	ControlplaneURL               string                      `yaml:"controlplane_url" default:"https://cosmo-cp.wundergraph.com" envconfig:"CONTROLPLANE_URL"`
	PlaygroundEnabled             bool                        `yaml:"playground_enabled" default:"true" envconfig:"PLAYGROUND_ENABLED"`
	IntrospectionEnabled          bool                        `yaml:"introspection_enabled" default:"true" envconfig:"INTROSPECTION_ENABLED"`
	CompressionEnabled            bool                        `yaml:"compression_enabled" default:"true" envconfig:"COMPRESSION_ENABLED"`
	LogLevel                      string                      `yaml:"log_level" default:"info" envconfig:"LOG_LEVEL"`
	JSONLog                       bool                        `yaml:"json_log" default:"true" envconfig:"JSON_LOG"`
	ShutdownDelay                 time.Duration               `yaml:"shutdown_delay" default:"60s" envconfig:"SHUTDOWN_DELAY"`
	GracePeriod                   time.Duration               `yaml:"grace_period" default:"30s" envconfig:"GRACE_PERIOD"`
	PollInterval                  time.Duration               `yaml:"poll_interval" default:"10s" envconfig:"POLL_INTERVAL"`
	HealthCheckPath               string                      `yaml:"health_check_path" default:"/health" envconfig:"HEALTH_CHECK_PATH"`
	ReadinessCheckPath            string                      `yaml:"readiness_check_path" default:"/health/ready" envconfig:"READINESS_CHECK_PATH"`
	LivenessCheckPath             string                      `yaml:"liveness_check_path" default:"/health/live" envconfig:"LIVENESS_CHECK_PATH"`
	GraphQLPath                   string                      `yaml:"graphql_path" default:"/graphql" envconfig:"GRAPHQL_PATH"`
	PlaygroundPath                string                      `yaml:"playground_path" default:"/" envconfig:"PLAYGROUND_PATH"`
	Authentication                AuthenticationConfiguration `yaml:"authentication,omitempty"`
	Authorization                 AuthorizationConfiguration  `yaml:"authorization,omitempty"`
	RateLimit                     RateLimitConfiguration      `yaml:"rate_limit,omitempty"`
	LocalhostFallbackInsideDocker bool                        `yaml:"localhost_fallback_inside_docker" default:"true" envconfig:"LOCALHOST_FALLBACK_INSIDE_DOCKER"`
	CDN                           CDNConfiguration            `yaml:"cdn,omitempty"`
	DevelopmentMode               bool                        `yaml:"dev_mode" default:"false" envconfig:"DEV_MODE"`
	Events                        EventsConfiguration         `yaml:"events,omitempty"`

	RouterConfigPath   string `yaml:"router_config_path,omitempty" envconfig:"ROUTER_CONFIG_PATH"`
	RouterRegistration bool   `yaml:"router_registration" envconfig:"ROUTER_REGISTRATION" default:"true"`

	OverrideRoutingURL OverrideRoutingURLConfiguration `yaml:"override_routing_url"`

	Overrides OverridesConfiguration `yaml:"overrides"`

	SecurityConfiguration SecurityConfiguration `yaml:"security,omitempty"`

	EngineExecutionConfiguration EngineExecutionConfiguration `yaml:"engine"`

	WebSocket WebSocketConfiguration `yaml:"websocket,omitempty"`

	SubgraphErrorPropagation SubgraphErrorPropagationConfiguration `yaml:"subgraph_error_propagation"`
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

	err := envconfig.Process("", &cfg.Config)
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

	// Expand environment variables in the config file
	// and unmarshal it into the config struct

	configYamlData := os.ExpandEnv(string(configFileBytes))
	if err := yaml.Unmarshal([]byte(configYamlData), &cfg.Config); err != nil {
		return nil, fmt.Errorf("failed to unmarshal router config: %w", err)
	}

	// Marshal the config back to yaml to respect default values, expansion and
	// to create a YAML representing only the values that are actually set

	configFileBytes, err = yaml.Marshal(cfg.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal router config: %w", err)
	}

	// Validate the config against the JSON schema

	err = ValidateConfig(configFileBytes, JSONSchema)
	if err != nil {
		return nil, fmt.Errorf("failed to validate router config: %w", err)
	}

	// Unmarshal the final config

	if err := yaml.Unmarshal(configFileBytes, &cfg.Config); err != nil {
		return nil, err
	}

	// Custom validation for the config

	if cfg.Config.RouterConfigPath == "" && cfg.Config.Graph.Token == "" {
		return nil, fmt.Errorf("either router config path or graph token must be provided")
	}

	// Post-process the config

	if cfg.Config.DevelopmentMode {
		cfg.Config.JSONLog = false
		cfg.Config.SubgraphErrorPropagation.Enabled = true
		cfg.Config.SubgraphErrorPropagation.PropagateStatusCodes = true
	}

	return cfg, nil
}
