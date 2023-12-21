package config

import (
	"fmt"
	"os"
	"time"

	"github.com/go-playground/validator/v10"
	"github.com/goccy/go-yaml"
	"github.com/joho/godotenv"
	"github.com/kelseyhightower/envconfig"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/internal/logging"
	"github.com/wundergraph/cosmo/router/internal/otel/otelconfig"
)

const defaultConfigPath = "config.yaml"

type Graph struct {
	// Name is required if no router config path is provided
	Name string `yaml:"name" envconfig:"FEDERATED_GRAPH_NAME" validate:"required_without_router_config"`
	// Token is required if no router config path is provided
	Token string `yaml:"token" envconfig:"GRAPH_API_TOKEN" validate:"required_without_router_config"`
}

type TracingExporterConfig struct {
	BatchTimeout  time.Duration `yaml:"batch_timeout" default:"10s" validate:"required,min=5s,max=120s"`
	ExportTimeout time.Duration `yaml:"export_timeout" default:"30s" validate:"required,min=5s,max=120s"`
}

type TracingExporter struct {
	Disabled              bool                `yaml:"disabled"`
	Exporter              otelconfig.Exporter `yaml:"exporter" validate:"oneof=http grpc"`
	Endpoint              string              `yaml:"endpoint" validate:"http_url"`
	HTTPPath              string              `yaml:"path"`
	Headers               map[string]string   `yaml:"headers"`
	TracingExporterConfig `yaml:",inline"`
}

type Tracing struct {
	Enabled      bool              `yaml:"enabled" default:"true" envconfig:"TRACING_ENABLED"`
	SamplingRate float64           `yaml:"sampling_rate" default:"1" validate:"required,min=0,max=1" envconfig:"TRACING_SAMPLING_RATE"`
	Exporters    []TracingExporter `yaml:"exporters"`
}

type Prometheus struct {
	Enabled             bool       `yaml:"enabled" default:"true" envconfig:"PROMETHEUS_ENABLED"`
	Path                string     `yaml:"path" default:"/metrics" validate:"uri" envconfig:"PROMETHEUS_HTTP_PATH"`
	ListenAddr          string     `yaml:"listen_addr" default:"127.0.0.1:8088" validate:"hostname_port" envconfig:"PROMETHEUS_LISTEN_ADDR"`
	ExcludeMetrics      RegExArray `yaml:"exclude_metrics" envconfig:"PROMETHEUS_EXCLUDE_METRICS"`
	ExcludeMetricLabels RegExArray `yaml:"exclude_metric_labels" envconfig:"PROMETHEUS_EXCLUDE_METRIC_LABELS"`
}

type MetricsOTLPExporter struct {
	Disabled bool                `yaml:"disabled"`
	Exporter otelconfig.Exporter `yaml:"exporter" validate:"oneof=http grpc"`
	Endpoint string              `yaml:"endpoint" validate:"http_url"`
	HTTPPath string              `yaml:"path"`
	Headers  map[string]string   `yaml:"headers"`
}

type Metrics struct {
	OTLP       MetricsOTLP `yaml:"otlp"`
	Prometheus Prometheus  `yaml:"prometheus"`
}

type MetricsOTLP struct {
	Enabled   bool                  `yaml:"enabled" default:"true" envconfig:"METRICS_OTLP_ENABLED"`
	Exporters []MetricsOTLPExporter `yaml:"exporters"`
}

type Telemetry struct {
	ServiceName string  `yaml:"service_name" default:"cosmo-router" envconfig:"TELEMETRY_SERVICE_NAME" validate:"required"`
	Tracing     Tracing `yaml:"tracing"`
	Metrics     Metrics `yaml:"metrics"`
}

type CORS struct {
	AllowOrigins     []string      `yaml:"allow_origins" default:"*" envconfig:"CORS_ALLOW_ORIGINS"`
	AllowMethods     []string      `yaml:"allow_methods" default:"HEAD,GET,POST" envconfig:"CORS_ALLOW_METHODS"`
	AllowHeaders     []string      `yaml:"allow_headers" default:"Origin,Content-Length,Content-Type" envconfig:"CORS_ALLOW_HEADERS"`
	AllowCredentials bool          `yaml:"allow_credentials" default:"true" envconfig:"CORS_ALLOW_CREDENTIALS"`
	MaxAge           time.Duration `yaml:"max_age" default:"5m" validate:"required,min=5m" envconfig:"CORS_MAX_AGE"`
}

type TrafficShapingRules struct {
	// All is a set of rules that apply to all requests
	All GlobalSubgraphRequestRule `yaml:"all"`
	// Apply to requests from clients to the router
	Router RouterTrafficConfiguration `yaml:"router"`
}

type RouterTrafficConfiguration struct {
	// MaxRequestBodyBytes is the maximum size of the request body in bytes
	MaxRequestBodyBytes BytesString `yaml:"max_request_body_size" default:"5MB" validate:"min=1000000"`
}

type GlobalSubgraphRequestRule struct {
	BackoffJitterRetry BackoffJitterRetry `yaml:"retry"`
	// See https://blog.cloudflare.com/the-complete-guide-to-golang-net-http-timeouts/
	RequestTimeout         time.Duration `yaml:"request_timeout" default:"60s" validate:"required,min=1s"`
	DialTimeout            time.Duration `yaml:"dial_timeout" default:"30s"`
	ResponseHeaderTimeout  time.Duration `yaml:"response_header_timeout" default:"0s"`
	ExpectContinueTimeout  time.Duration `yaml:"expect_continue_timeout" default:"0s"`
	TLSHandshakeTimeout    time.Duration `yaml:"tls_handshake_timeout" default:"10s"`
	KeepAliveIdleTimeout   time.Duration `yaml:"keep_alive_idle_timeout" default:"0s"`
	KeepAliveProbeInterval time.Duration `yaml:"keep_alive_probe_interval" default:"30s"`
}

type GraphqlMetrics struct {
	Enabled           bool   `yaml:"enabled" default:"true" envconfig:"GRAPHQL_METRICS_ENABLED"`
	CollectorEndpoint string `yaml:"collector_endpoint" default:"https://cosmo-metrics.wundergraph.com" envconfig:"GRAPHQL_METRICS_COLLECTOR_ENDPOINT" validate:"required,uri"`
}

type BackoffJitterRetry struct {
	Enabled     bool          `yaml:"enabled" default:"true" envconfig:"RETRY_ENABLED"`
	Algorithm   string        `yaml:"algorithm" default:"backoff_jitter" validate:"oneof=backoff_jitter"`
	MaxAttempts int           `yaml:"max_attempts" default:"5" validate:"required,min=1,required_if=Algorithm backoff_jitter"`
	MaxDuration time.Duration `yaml:"max_duration" default:"10s" validate:"required,min=1s,required_if=Algorithm backoff_jitter"`
	Interval    time.Duration `yaml:"interval" default:"3s" validate:"required,min=100ms,required_if=Algorithm backoff_jitter"`
}

type HeaderRules struct {
	// All is a set of rules that apply to all requests
	All       GlobalHeaderRule            `yaml:"all"`
	Subgraphs map[string]GlobalHeaderRule `yaml:"subgraphs" validate:"dive"`
}

type GlobalHeaderRule struct {
	// Request is a set of rules that apply to requests
	Request []RequestHeaderRule `yaml:"request" validate:"dive"`
}

type HeaderRuleOperation string

const (
	HeaderRuleOperationPropagate HeaderRuleOperation = "propagate"
)

type RequestHeaderRule struct {
	// Operation describes the header operation to perform e.g. "propagate"
	Operation HeaderRuleOperation `yaml:"op" validate:"oneof=propagate"`
	// Matching is the regex to match the header name against
	Matching string `yaml:"matching" validate:"excluded_with=Named"`
	// Named is the exact header name to match
	Named string `yaml:"named" validate:"excluded_with=Matching"`
	// Default is the default value to set if the header is not present
	Default string `yaml:"default"`
}

type EngineDebugConfiguration struct {
	PrintOperationTransformations bool `envconfig:"ENGINE_DEBUG_PRINT_OPERATION_TRANSFORMATIONS"`
	PrintOperationEnableASTRefs   bool `envconfig:"ENGINE_DEBUG_PRINT_OPERATION_ENABLE_AST_REFS"`
	PrintPlanningPaths            bool `envconfig:"ENGINE_DEBUG_PRINT_PLANNING_PATHS"`
	PrintQueryPlans               bool `envconfig:"ENGINE_DEBUG_PRINT_QUERY_PLANS"`
	PrintNodeSuggestions          bool `envconfig:"ENGINE_DEBUG_PRINT_NODE_SUGGESTIONS"`
	ConfigurationVisitor          bool `envconfig:"ENGINE_DEBUG_CONFIGURATION_VISITOR"`
	PlanningVisitor               bool `envconfig:"ENGINE_DEBUG_PLANNING_VISITOR"`
	DatasourceVisitor             bool `envconfig:"ENGINE_DEBUG_DATASOURCE_VISITOR"`
}

type EngineExecutionConfiguration struct {
	Debug                                  EngineDebugConfiguration
	EnableSingleFlight                     bool `default:"true" envconfig:"ENGINE_ENABLE_SINGLE_FLIGHT"`
	EnableRequestTracing                   bool `default:"true" envconfig:"ENGINE_ENABLE_REQUEST_TRACING"`
	EnableExecutionPlanCacheResponseHeader bool `default:"false" envconfig:"ENGINE_ENABLE_EXECUTION_PLAN_CACHE_RESPONSE_HEADER"`
}

type OverrideRoutingURLConfiguration struct {
	Subgraphs map[string]string `yaml:"subgraphs" validate:"dive,required,url"`
}

type AuthenticationProviderJWKS struct {
	URL                 string        `yaml:"url" validate:"url"`
	HeaderNames         []string      `yaml:"header_names"`
	HeaderValuePrefixes []string      `yaml:"header_value_prefixes"`
	RefreshInterval     time.Duration `yaml:"refresh_interval" default:"1m" validate:"required,min=5s,max=1h"`
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
}

type CDNConfiguration struct {
	URL       string      `yaml:"url" validate:"url" envconfig:"CDN_URL" default:"https://cosmo-cdn.wundergraph.com"`
	CacheSize BytesString `yaml:"cache_size" envconfig:"CDN_CACHE_SIZE" default:"100MB"`
}

type EventSource struct {
	Provider string `yaml:"provider" validate:"oneof=NATS"`
	URL      string `yaml:"url" validate:"url"`
}

type EventsConfiguration struct {
	Sources []EventSource `yaml:"sources"`
}

type Config struct {
	Version string `yaml:"version"`

	Graph          Graph          `yaml:"graph"`
	Telemetry      Telemetry      `yaml:"telemetry"`
	GraphqlMetrics GraphqlMetrics `yaml:"graphql_metrics"`
	CORS           CORS           `yaml:"cors"`

	Modules        map[string]interface{} `yaml:"modules"`
	Headers        HeaderRules            `yaml:"headers"`
	TrafficShaping TrafficShapingRules    `yaml:"traffic_shaping"`

	ListenAddr                    string                      `yaml:"listen_addr" default:"localhost:3002" validate:"hostname_port" envconfig:"LISTEN_ADDR"`
	ControlplaneURL               string                      `yaml:"controlplane_url" default:"https://cosmo-cp.wundergraph.com" envconfig:"CONTROLPLANE_URL" validate:"required,uri"`
	PlaygroundEnabled             bool                        `yaml:"playground_enabled" default:"true" envconfig:"PLAYGROUND_ENABLED"`
	IntrospectionEnabled          bool                        `yaml:"introspection_enabled" default:"true" envconfig:"INTROSPECTION_ENABLED"`
	LogLevel                      string                      `yaml:"log_level" default:"info" envconfig:"LOG_LEVEL" validate:"oneof=debug info warning error fatal panic"`
	JSONLog                       bool                        `yaml:"json_log" default:"true" envconfig:"JSON_LOG"`
	ShutdownDelay                 time.Duration               `yaml:"shutdown_delay" default:"60s" validate:"required,min=15s" envconfig:"SHUTDOWN_DELAY"`
	GracePeriod                   time.Duration               `yaml:"grace_period" default:"20s" validate:"required" envconfig:"GRACE_PERIOD"`
	PollInterval                  time.Duration               `yaml:"poll_interval" default:"10s" validate:"required,min=5s" envconfig:"POLL_INTERVAL"`
	HealthCheckPath               string                      `yaml:"health_check_path" default:"/health" envconfig:"HEALTH_CHECK_PATH" validate:"uri"`
	ReadinessCheckPath            string                      `yaml:"readiness_check_path" default:"/health/ready" envconfig:"READINESS_CHECK_PATH" validate:"uri"`
	LivenessCheckPath             string                      `yaml:"liveness_check_path" default:"/health/live" envconfig:"LIVENESS_CHECK_PATH" validate:"uri"`
	GraphQLPath                   string                      `yaml:"graphql_path" default:"/graphql" envconfig:"GRAPHQL_PATH"`
	Authentication                AuthenticationConfiguration `yaml:"authentication"`
	Authorization                 AuthorizationConfiguration  `yaml:"authorization"`
	LocalhostFallbackInsideDocker bool                        `yaml:"localhost_fallback_inside_docker" default:"true" envconfig:"LOCALHOST_FALLBACK_INSIDE_DOCKER"`
	CDN                           CDNConfiguration            `yaml:"cdn"`
	DevelopmentMode               bool                        `yaml:"dev_mode" default:"false" envconfig:"DEV_MODE"`
	Events                        EventsConfiguration         `yaml:"events"`

	ConfigPath         string `envconfig:"CONFIG_PATH" validate:"omitempty,filepath"`
	RouterConfigPath   string `yaml:"router_config_path" envconfig:"ROUTER_CONFIG_PATH" validate:"omitempty,filepath"`
	RouterRegistration bool   `yaml:"router_registration" envconfig:"ROUTER_REGISTRATION" default:"true"`

	OverrideRoutingURL OverrideRoutingURLConfiguration `yaml:"override_routing_url"`

	EngineExecutionConfiguration EngineExecutionConfiguration
}

// ValidateRequiredWithRouterConfigPath validates that either the field or the router config path is set
func ValidateRequiredWithRouterConfigPath(fl validator.FieldLevel) bool {
	if valuer, ok := fl.Top().Interface().(Config); ok {
		if fl.Field().String() == "" && valuer.RouterConfigPath == "" {
			return false
		}
	} else {
		return false
	}
	return true
}

func LoadConfig(envOverride string) (*Config, error) {
	godotenv.Load(".env.local")
	godotenv.Load()

	if envOverride != "" {
		godotenv.Overload(envOverride)
	}

	var c Config

	err := envconfig.Process("", &c)
	if err != nil {
		return nil, err
	}

	configPathOverride := false

	if c.ConfigPath != "" {
		configPathOverride = true
	} else {
		// Ensure default
		c.ConfigPath = defaultConfigPath
	}

	if c.DevelopmentMode {
		c.JSONLog = false
	}

	// Configuration from environment variables. We don't have the config here.
	logLevel, err := logging.ZapLogLevelFromString(c.LogLevel)
	if err != nil {
		return nil, err
	}
	logger := logging.New(!c.JSONLog, c.LogLevel == "debug", logLevel).
		With(zap.String("component", "@wundergraph/router"))

	// Custom config path can only be supported through environment variable
	configBytes, err := os.ReadFile(c.ConfigPath)

	if err != nil {
		if configPathOverride {
			return nil, fmt.Errorf("could not read custom config file %s: %w", c.ConfigPath, err)
		} else {
			logger.Info("Default config file is not loaded",
				zap.String("configPath", defaultConfigPath),
				zap.Error(err),
			)
		}
	}
	expandedConfigBytes := []byte(os.ExpandEnv(string(configBytes)))

	if err == nil {
		if err := yaml.Unmarshal(expandedConfigBytes, &c); err != nil {
			return nil, fmt.Errorf("failed to unmarshal router config: %w", err)
		}
	}

	validate := validator.New()
	_ = validate.RegisterValidation("required_without_router_config", ValidateRequiredWithRouterConfigPath)
	err = validate.Struct(c)
	if err != nil {
		return nil, err
	}

	if c.DevelopmentMode {
		c.JSONLog = false
	}

	return &c, nil
}
