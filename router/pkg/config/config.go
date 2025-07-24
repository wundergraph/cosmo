package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"go.uber.org/zap/zapcore"

	"github.com/caarlos0/env/v11"
	"github.com/goccy/go-yaml"

	"github.com/wundergraph/cosmo/router/internal/unique"
	"github.com/wundergraph/cosmo/router/internal/yamlmerge"
	"github.com/wundergraph/cosmo/router/pkg/otel/otelconfig"
)

const (
	DefaultConfigPath = "config.yaml"
)

type (
	UrlString          string // validator format "http-url
	HttpUrlString      string // validator format "http-url"
	FilePathString     string // validator format "file-path"
	XUriString         string // validator format "x-uri"
	HostNamePortString string // validator format "hostname-port"
)

type Graph struct {
	Token   string `yaml:"token,omitempty" env:"GRAPH_API_TOKEN"`                                                 // The token used to authenticate with other component from Cosmo. Can be ommitted if the router is started with a static execution config.
	SignKey string `yaml:"sign_key,omitempty" env:"GRAPH_CONFIG_SIGN_KEY" jsonschema:"minLength=32,maxLength=32"` // The key used to verify the graph config signature when downloading from the CDN. The same key was used to create the signature in the admission webhook '/validate-config'. If the key is not set, the router will not verify the graph configuration. The key must be a 32 byte long string.
}

type CustomStaticAttribute struct {
	Key   string `yaml:"key"`   // The key of the attribute.
	Value string `yaml:"value"` // The value of the attribute.
}

type CustomDynamicAttribute struct {
	RequestHeader  string `yaml:"request_header,omitempty"`  // The name of the request header from which to extract the value. The value is only extracted when a request context is available otherwise the default value is used.
	ContextField   string `yaml:"context_field,omitempty"`   // The field name of the context from which to extract the value. The value is only extracted when a context is available otherwise the default value is used.
	ResponseHeader string `yaml:"response_header,omitempty"` // The name of the response header from which to extract the value. The value is only extracted for subgraph access logs.
	Expression     string `yaml:"expression,omitempty"`      // The expression used to evaluate to extract a value for logging. The expression is specified as a string. Please see https://expr-lang.org/ for more information on constructing expressions.
}

type CustomAttribute struct {
	Key       string                  `yaml:"key"`                  // The key of the field.
	Default   string                  `yaml:"default"`              // The default value of the field. If the value is not set, value_from is used. If both value and value_from are set, value_from has precedence and in case of a missing value_from, the default value is used.
	ValueFrom *CustomDynamicAttribute `yaml:"value_from,omitempty"` // Defines a source for the field value e.g. from a request header or request context. If both default and value_from are set, value_from has precedence.
}

type TracingExporterConfig struct {
	BatchTimeout  time.Duration `yaml:"batch_timeout,omitempty" envDefault:"10s" jsonschema:"default=10s" jsonschema_extras:"duration_minimum=5s,duration_maximum=2m"`  // The maximum time to wait before exporting the traces. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	ExportTimeout time.Duration `yaml:"export_timeout,omitempty" envDefault:"30s" jsonschema:"default=30s" jsonschema_extras:"duration_minimum=5s,duration_maximum=2m"` // The maximum time to wait for the export to complete. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
}

type TracingGlobalFeatures struct {
	ExportGraphQLVariables bool `yaml:"export_graphql_variables" envDefault:"false" env:"TRACING_EXPORT_GRAPHQL_VARIABLES"` // Enable the export of the GraphQL variables. The GraphQL variables are exported with the traces. The default value is false to avoid leaking sensitive information.
	WithNewRoot            bool `yaml:"with_new_root" envDefault:"false" env:"TRACING_WITH_NEW_ROOT"`                       // Specifies that the router span should be treated as a root Span. Any existing parent span context will be ignored when defining the Span's trace identifiers. This is useful when the router must be the entry point of the trace.
}

type TracingExporter struct {
	Disabled              bool                `yaml:"disabled"`
	Exporter              otelconfig.Exporter `yaml:"exporter,omitempty"` // The exporter to use for the traces. The supported exporters are 'http' and 'grpc'.
	Endpoint              string              `yaml:"endpoint,omitempty"`
	HTTPPath              XUriString          `yaml:"path,omitempty" envDefault:"/v1/traces" jsonschema:"default=/v1/traces"` // The path to which the traces are exported.
	Headers               map[string]string   `yaml:"headers,omitempty"`
	TracingExporterConfig `yaml:",inline"`
}

type ResponseTraceHeader struct {
	Enabled    bool   `yaml:"enabled"`                                // Enables the addition of trace_id to the response header.
	HeaderName string `yaml:"header_name" envDefault:"x-wg-trace-id"` // The name of the header which the holds the trace_id. The default value is x-wg-trace-id.
}

type Tracing struct {
	Enabled             bool                `yaml:"enabled" envDefault:"true" env:"TRACING_ENABLED"`
	SamplingRate        float64             `yaml:"sampling_rate" envDefault:"1" env:"TRACING_SAMPLING_RATE"`                                            // The sampling rate for the traces. The value must be between 0 and 1. If the value is 0, no traces will be sampled. If the value is 1, all traces will be sampled. The default value is 1.
	ParentBasedSampler  bool                `yaml:"parent_based_sampler" envDefault:"true" env:"TRACING_PARENT_BASED_SAMPLER" jsonschema:"default=true"` // Enable the parent-based sampler. The parent-based sampler is used to sample the traces based on the parent trace. The default value is true.
	Exporters           []TracingExporter   `yaml:"exporters"`                                                                                           // The exporters to use to export the traces. If no exporters are specified, the default Cosmo Cloud exporter is used. If you override, please make sure to include the default exporter.
	Propagation         PropagationConfig   `yaml:"propagation"`
	ResponseTraceHeader ResponseTraceHeader `yaml:"response_trace_id"` // The configuration to expose the trace_id through a response header.
	Attributes          []CustomAttribute   `yaml:"attributes"`        // The configuration for custom span attributes for subgraph tracing.

	TracingGlobalFeatures `yaml:",inline"`
}

type PropagationConfig struct {
	TraceContext bool `yaml:"trace_context" envDefault:"true"` // Enable the trace context propagation. See https://www.w3.org/TR/trace-context/ for more information.
	Jaeger       bool `yaml:"jaeger"`                          // Enable the Jaeger propagation. See https://www.jaegertracing.io/ (compliant with opentracing) for more information.
	B3           bool `yaml:"b3"`                              // Enable the B3 propagation. See https://github.com/openzipkin/b3-propagation (zipkin) for more information.
	Baggage      bool `yaml:"baggage"`                         // Enable the baggage propagation. See https://www.w3.org/TR/baggage/ for more information.
	Datadog      bool `yaml:"datadog"`                         // Enable the Datadog propagation.
}

type EngineStats struct {
	Subscriptions bool `yaml:"subscriptions" envDefault:"false" env:"ENGINE_STATS_SUBSCRIPTIONS"` // Enabling this will report additional engine metrics for WebSockets and SSE such as connections, subscriptions and triggers. The default value is false
}

type Prometheus struct {
	Enabled             bool               `yaml:"enabled" envDefault:"true" env:"PROMETHEUS_ENABLED"`
	Path                XUriString         `yaml:"path" envDefault:"/metrics" env:"PROMETHEUS_HTTP_PATH"`                 // The path to which the metrics are served.
	ListenAddr          HostNamePortString `yaml:"listen_addr" envDefault:"127.0.0.1:8088" env:"PROMETHEUS_LISTEN_ADDR"`  // The address on which the metrics are served.
	GraphqlCache        bool               `yaml:"graphql_cache" envDefault:"false" env:"PROMETHEUS_GRAPHQL_CACHE"`       // Enable the collection of metrics for the GraphQL operation router caches. The default value is false.
	ConnectionStats     bool               `yaml:"connection_stats" envDefault:"false" env:"PROMETHEUS_CONNECTION_STATS"` // Enable the collection of connection stats. The default value is false.
	EngineStats         EngineStats        `yaml:"engine_stats" envPrefix:"PROMETHEUS_"`
	CircuitBreaker      bool               `yaml:"circuit_breaker" envDefault:"false" env:"PROMETHEUS_CIRCUIT_BREAKER"`       // Enable the collection of circuit breaker stats. The default value is false.
	ExcludeMetrics      RegExArray         `yaml:"exclude_metrics,omitempty" env:"PROMETHEUS_EXCLUDE_METRICS"`                // The metrics to exclude from the Prometheus metrics. Accepts a list of Go regular expressions. Use https://regex101.com/ to test your regular expressions.
	ExcludeMetricLabels RegExArray         `yaml:"exclude_metric_labels,omitempty" env:"PROMETHEUS_EXCLUDE_METRIC_LABELS"`    // The metric labels to exclude from the Prometheus metrics. Accepts a list of Go regular expressions. Use https://regex101.com/ to test your regular expressions.
	ExcludeScopeInfo    bool               `yaml:"exclude_scope_info" envDefault:"false" env:"PROMETHEUS_EXCLUDE_SCOPE_INFO"` // Exclude scope info from Prometheus metrics. The default value is false.

	SchemaFieldUsage PrometheusSchemaFieldUsage `yaml:"schema_usage" envPrefix:"PROMETHEUS_SCHEMA_FIELD_USAGE_"` // Configure schema field usage metrics for Prometheus
}

type PrometheusSchemaFieldUsage struct {
	Enabled             bool `yaml:"enabled" envDefault:"false" env:"ENABLED"`                             // Enable the collection and export of GraphQL schema metrics to Prometheus. The default value is false.
	IncludeOperationSha bool `yaml:"include_operation_sha" envDefault:"false" env:"INCLUDE_OPERATION_SHA"` // Include the operation SHA256 in the metric labels, this can be an expensive operation. The default value is false.
}

type MetricsOTLPExporter struct {
	Disabled    bool                           `yaml:"disabled"`
	Exporter    otelconfig.Exporter            `yaml:"exporter" envDefault:"http"`    // The exporter protocol to use to export metrics. The supported exporters are 'http' and 'grpc'.
	Endpoint    string                         `yaml:"endpoint"`                      // The endpoint to which the metrics are exported.
	HTTPPath    XUriString                     `yaml:"path" envDefault:"/v1/metrics"` // The path to which the metrics are exported. This is ignored when using 'grpc' as exporter and can be omitted.
	Headers     map[string]string              `yaml:"headers"`                       // The headers to send with the request. Use this to set the authentication headers.
	Temporality otelconfig.ExporterTemporality `yaml:"temporality"`                   // Temporality defines the window that an aggregation is calculated over.
}

type Metrics struct {
	Attributes       []CustomAttribute `yaml:"attributes"`                                                                                // The configuration for custom attributes. Custom attributes can be created from request headers, static values or context fields. Not every context fields are available at all request life-cycle stages. If a value is a list, the value is JSON encoded for OTLP. For Prometheus, the values are exploded into multiple metrics with unique labels. Keep in mind, that every new custom attribute increases the cardinality.
	OTLP             MetricsOTLP       `yaml:"otlp"`                                                                                      // The configuration for the OpenTelemetry protocol (OTLP). The OTLP is used to collect and export the metrics.
	Prometheus       Prometheus        `yaml:"prometheus"`                                                                                // The configuration for the Prometheus metrics. The Prometheus metrics are used to collect and export the metrics.
	CardinalityLimit int               `yaml:"experiment_cardinality_limit" envDefault:"2000" env:"METRICS_EXPERIMENT_CARDINALITY_LIMIT"` // Sets a hard limit on the number of Metric Points that can be collected during a collection cycle. NOTE: This option is experimental and may change in future versions.
}

type MetricsOTLP struct {
	Enabled             bool                  `yaml:"enabled" envDefault:"true" env:"METRICS_OTLP_ENABLED"`                    // Enable the collection of metrics.
	RouterRuntime       bool                  `yaml:"router_runtime" envDefault:"true" env:"METRICS_OTLP_ROUTER_RUNTIME"`      // Enable the collection of metrics for the router runtime.
	GraphqlCache        bool                  `yaml:"graphql_cache" envDefault:"false" env:"METRICS_OTLP_GRAPHQL_CACHE"`       // Enable the collection of metrics for the GraphQL operation router caches. The default value is false.
	ConnectionStats     bool                  `yaml:"connection_stats" envDefault:"false" env:"METRICS_OTLP_CONNECTION_STATS"` // Enable the collection of connection stats. The default value is false.
	EngineStats         EngineStats           `yaml:"engine_stats" envPrefix:"METRICS_OTLP_"`
	CircuitBreaker      bool                  `yaml:"circuit_breaker" envDefault:"false" env:"METRICS_OTLP_CIRCUIT_BREAKER"`    // Enable the collection of circuit breaker stats. The default value is false.
	ExcludeMetrics      RegExArray            `yaml:"exclude_metrics,omitempty" env:"METRICS_OTLP_EXCLUDE_METRICS"`             // The metrics to exclude from the OTEL metrics. Accepts a list of Go regular expressions. Use https://regex101.com/ to test your regular expressions.
	ExcludeMetricLabels RegExArray            `yaml:"exclude_metric_labels,omitempty" env:"METRICS_OTLP_EXCLUDE_METRIC_LABELS"` // The metric labels to exclude from the OTEL metrics. Accepts a list of Go regular expressions. Use https://regex101.com/ to test your regular expressions.
	Exporters           []MetricsOTLPExporter `yaml:"exporters"`                                                                // The exporters to use to export the metrics. If no exporters are specified, the default Cosmo Cloud exporter is used. If you override, please make sure to include the default exporter.
}

type Telemetry struct {
	ServiceName        string                  `yaml:"service_name" envDefault:"cosmo-router" env:"TELEMETRY_SERVICE_NAME"` // The name of the service. The name is used to identify the service in the traces and metrics. The default value is 'cosmo-router'.
	Attributes         []CustomAttribute       `yaml:"attributes"`                                                          // The default attributes to add to OTEL and Prometheus metrics. Because Prometheus metrics rely on the OpenTelemetry metrics, the attributes are also added to the Prometheus metrics.
	ResourceAttributes []CustomStaticAttribute `yaml:"resource_attributes"`                                                 // The resource attributes to add to OTEL metrics and traces. The resource attributes identify the entity producing the traces and metrics. Because Prometheus metrics rely on the OpenTelemetry metrics, the resource attributes are also added to the Prometheus target_info metric.
	Tracing            Tracing                 `yaml:"tracing"`                                                             // The configuration for the collection and export of traces.
	Metrics            Metrics                 `yaml:"metrics"`                                                             // The configuration for the collection and export of metrics. The metrics are collected and exported using the OpenTelemetry protocol (OTLP) and Prometheus.
}

type CORS struct {
	Enabled          bool          `yaml:"enabled" envDefault:"true" env:"CORS_ENABLED"`                                                               // Set this to enable/disable the CORS middleware. It is enabled by default. When disabled, the rest of the properties for CORS have no effect.
	AllowOrigins     []string      `yaml:"allow_origins" envDefault:"*" env:"CORS_ALLOW_ORIGINS"`                                                      // The allowed origins. The default value is to allow all origins. The value can be a list of origins or the wildcard '*'.
	AllowMethods     []string      `yaml:"allow_methods" envDefault:"HEAD,GET,POST" env:"CORS_ALLOW_METHODS"`                                          // The allowed HTTP methods. The default value is to allow the methods 'GET', 'POST', and 'HEAD'.
	AllowHeaders     []string      `yaml:"allow_headers" envDefault:"Origin,Content-Length,Content-Type" env:"CORS_ALLOW_HEADERS"`                     // The allowed HTTP headers. The default value is to allow all headers. Default headers are always appended to the list of allowed headers.
	AllowCredentials bool          `yaml:"allow_credentials" envDefault:"true" env:"CORS_ALLOW_CREDENTIALS"`                                           // The allowed credentials. The default value is to allow credentials. This allows the browser to send cookies and authentication headers.
	MaxAge           time.Duration `yaml:"max_age" envDefault:"5m" env:"CORS_MAX_AGE" jsonschema:"default=5m" jsonschema_extras:"duration_minimum=5m"` // The maximum age of the preflight request. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
}

type TrafficShapingRules struct {
	All       GlobalSubgraphRequestRule             `yaml:"all"`                 // The configuration for all subgraphs. The configuration is used to configure the traffic shaping for all subgraphs.
	Router    RouterTrafficConfiguration            `yaml:"router"`              // The configuration for requests from clients to the router.
	Subgraphs map[string]*GlobalSubgraphRequestRule `yaml:"subgraphs,omitempty"` // The configuration to control traffic shaping for specific subgraphs. These rules are applied to requests from the router to subgraphs. The key is the subgraph name.
}

type FileUpload struct {
	Enabled          bool        `yaml:"enabled" envDefault:"true" env:"FILE_UPLOAD_ENABLED"`
	MaxFileSizeBytes BytesString `yaml:"max_file_size" envDefault:"50MB" env:"FILE_UPLOAD_MAX_FILE_SIZE"` // The maximum size of a file that can be uploaded. The size is specified as a string with a number and a unit, e.g. 10KB, 1MB, 1GB. The supported units are 'KB', 'MB', 'GB'.
	MaxFiles         int         `yaml:"max_files" envDefault:"10" env:"FILE_UPLOAD_MAX_FILES"`           // The maximum number of files that can be uploaded.
}

type RouterTrafficConfiguration struct {
	MaxRequestBodyBytes  BytesString `yaml:"max_request_body_size" envDefault:"5MB"`                    // The maximum request body size. The size is specified as a string with a number and a unit, e.g. 10KB, 1MB, 1GB. The supported units are 'KB', 'MB', 'GB'.
	MaxHeaderBytes       BytesString `yaml:"max_header_bytes" envDefault:"0MiB" env:"MAX_HEADER_BYTES"` // The maximum size of the request headers. Setting this to 0 uses the default value from the http standard lib, which is 1MiB.
	DecompressionEnabled bool        `yaml:"decompression_enabled" envDefault:"true"`                   // When enabled, the router will check incoming requests for a 'Content-Encoding' header and decompress the body accordingly. Currently only gzip is supported
}

type GlobalSubgraphRequestRule struct {
	BackoffJitterRetry BackoffJitterRetry `yaml:"retry"`           // The retry configuration. The retry configuration is used to configure the retry behavior for the subgraphs requests. See https://cosmo-docs.wundergraph.com/router/traffic-shaping#automatic-retry for more information.
	CircuitBreaker     CircuitBreaker     `yaml:"circuit_breaker"` // The Circuit Breaker configuration, it allows you to enable and configure circuit breakers for subgraphs.

	// See https://blog.cloudflare.com/the-complete-guide-to-golang-net-http-timeouts/

	RequestTimeout         *time.Duration `yaml:"request_timeout,omitempty" envDefault:"60s" jsonschema_extras:"duration_minimum=1s"`           // The request timeout. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	DialTimeout            *time.Duration `yaml:"dial_timeout,omitempty" envDefault:"30s"`                                                      // The dial timeout. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	ResponseHeaderTimeout  *time.Duration `yaml:"response_header_timeout,omitempty" envDefault:"0s"`                                            // The response header timeout. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	ExpectContinueTimeout  *time.Duration `yaml:"expect_continue_timeout,omitempty" envDefault:"0s"`                                            // The expect continue timeout. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	TLSHandshakeTimeout    *time.Duration `yaml:"tls_handshake_timeout,omitempty" envDefault:"10s"`                                             // The TLS handshake timeout. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	KeepAliveIdleTimeout   *time.Duration `yaml:"keep_alive_idle_timeout,omitempty" envDefault:"90s"`                                           // The keep alive idle timeout. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	KeepAliveProbeInterval *time.Duration `yaml:"keep_alive_probe_interval,omitempty" envDefault:"30s" jsonschema_extras:"duration_minimum=5s"` // The keep alive probe interval. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.

	// Connection configuration

	MaxConnsPerHost     *int `yaml:"max_conns_per_host,omitempty" envDefault:"100"`     // MaxConnsPerHost limits the total number of connections per host, including connections in the dialing, active, and idle states. Zero means no limit.
	MaxIdleConns        *int `yaml:"max_idle_conns,omitempty" envDefault:"1024"`        // MaxIdleConns controls the maximum number of idle (keep-alive) connections across all hosts. Zero means no limit
	MaxIdleConnsPerHost *int `yaml:"max_idle_conns_per_host,omitempty" envDefault:"20"` // MaxIdleConnsPerHost, if non-zero, controls the maximum idle (keep-alive) connections to keep per-host. Zero will default to 2
}

type SubgraphTrafficRequestRule struct {
	RequestTimeout time.Duration `yaml:"request_timeout,omitempty" envDefault:"60s"` // The request timeout. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
}

type CircuitBreaker struct {
	Enabled                    bool          `yaml:"enabled" envDefault:"false"`                                                                                                 // Enable the circuit breaker
	ErrorThresholdPercentage   int64         `yaml:"error_threshold_percentage" envDefault:"50"`                                                                                 // The error threshold percentage that needs to be met in the rolling window to trigger the circuit to an open state
	RequestThreshold           int64         `yaml:"request_threshold" envDefault:"20"`                                                                                          // The min number of pre-requisite requests required to start checking if the circuit breaker's status should be changed
	SleepWindow                time.Duration `yaml:"sleep_window" envDefault:"5s" jsonschema:"default=5s" jsonschema_extras:"duration_minimum=250ms,duration_maximum=2m"`        // After the circuit breaker is open, how long the circuit breaker will reject requests before allowing to send a half open request
	HalfOpenAttempts           int64         `yaml:"half_open_attempts" envDefault:"1"`                                                                                          // How many failed attempts are allowed to check if an open circuit can now make successful requests
	RequiredSuccessfulAttempts int64         `yaml:"required_successful" envDefault:"1"`                                                                                         // How many successful requests are required for a half open circuit breaker to close it
	RollingDuration            time.Duration `yaml:"rolling_duration" envDefault:"10s" jsonschema:"default=10s" jsonschema_extras:"duration_minimum=5s,duration_maximum=120s"`   // The duration of which information on failed and successful requests are stored
	NumBuckets                 int           `yaml:"num_buckets" envDefault:"10"`                                                                                                // The number of buckets which store circuit requests information within a given rolling duration
	ExecutionTimeout           time.Duration `yaml:"execution_timeout" envDefault:"60s" jsonschema:"default=60s" jsonschema_extras:"duration_minimum=1ms,duration_maximum=300s"` // The maximum time to wait for a circuit execution to complete before timing out
	MaxConcurrentRequests      int64         `yaml:"max_concurrent_requests" envDefault:"-1"`                                                                                    // The maximum number of concurrent requests allowed through the circuit breaker
}

type GraphqlMetrics struct {
	Enabled           bool          `yaml:"enabled" envDefault:"true" env:"GRAPHQL_METRICS_ENABLED"`                                                        // Enable the collection of the GraphQL metrics. The default value is true.
	CollectorEndpoint HttpUrlString `yaml:"collector_endpoint" envDefault:"https://cosmo-metrics.wundergraph.com" env:"GRAPHQL_METRICS_COLLECTOR_ENDPOINT"` // The endpoint to which the GraphQL metrics are collected. The endpoint is specified as a string with the format 'scheme://host:port'.
}

type BackoffJitterRetry struct {
	Enabled     bool          `yaml:"enabled" envDefault:"true" env:"RETRY_ENABLED"`
	Algorithm   string        `yaml:"algorithm" envDefault:"backoff_jitter"` // The algorithm used to calculate the retry interval. The supported algorithms are 'backoff_jitter'.
	MaxAttempts int           `yaml:"max_attempts" envDefault:"5"`           // The maximum number of attempts. The default value is 5.
	MaxDuration time.Duration `yaml:"max_duration" envDefault:"10s"`         // The maximum allowable duration between retries (random). The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	Interval    time.Duration `yaml:"interval" envDefault:"3s"`              // The time duration between each retry attempt. Increase with every retry. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
}

type SubgraphCacheControlRule struct {
	Name  string `yaml:"name"`  // Name of the subgraph.
	Value string `yaml:"value"` // Cache control value for the subgraph.
}

type CacheControlPolicy struct {
	Enabled   bool                       `yaml:"enabled" envDefault:"false" env:"CACHE_CONTROL_POLICY_ENABLED"` // Determines whether cache control policy is enabled.
	Value     string                     `yaml:"value" env:"CACHE_CONTROL_POLICY_VALUE"`                        // Global cache control value.
	Subgraphs []SubgraphCacheControlRule `yaml:"subgraphs,omitempty"`                                           // Subgraph-specific cache control settings.
}

type HeaderRules struct {
	All             *GlobalHeaderRule            `yaml:"all,omitempty"` // All is a set of rules that apply to all requests
	Subgraphs       map[string]*GlobalHeaderRule `yaml:"subgraphs,omitempty"`
	CookieWhitelist []string                     `yaml:"cookie_whitelist,omitempty"` // A list of Cookie keys allowed to be forwarded to the subgraph.
}

type GlobalHeaderRule struct {
	Request  []*RequestHeaderRule  `yaml:"request,omitempty"`  // set of rules that apply to requests
	Response []*ResponseHeaderRule `yaml:"response,omitempty"` // set of rules that apply to responses
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
	Operation HeaderRuleOperation `yaml:"op"` // The operation to perform on the header.

	// Propagate options

	Matching    string `yaml:"matching"`               // The matching rule for the header.
	NegateMatch bool   `yaml:"negate_match,omitempty"` // If set to true, the result of the 'matching' regex will be inverted.
	Named       string `yaml:"named"`                  // The name of the header to match.
	Rename      string `yaml:"rename,omitempty"`       // Rename is used to rename the named or the matching headers.
	Default     string `yaml:"default"`                // The default value of the header in case it is not present in the request.

	// Set header options

	Name       string                  `yaml:"name"`                 // The name of the header to set.
	Value      string                  `yaml:"value"`                // The value to set for the header.
	Expression string                  `yaml:"expression"`           // The Expr Lang template expression to evaluate.
	ValueFrom  *CustomDynamicAttribute `yaml:"value_from,omitempty"` // DEPRECATED: Use expression instead.
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
	Operation HeaderRuleOperation `yaml:"op"` // The operation to perform on the header.
	// Matching is the regex to match the header name against
	Matching    string `yaml:"matching"`               // The matching rule for the header.
	NegateMatch bool   `yaml:"negate_match,omitempty"` // If set to true, the result of the 'matching' regex will be inverted.
	// Named is the exact header name to match
	Named string `yaml:"named"` // The name of the header to match.
	// Rename renames the header's key to the provided value
	Rename string `yaml:"rename,omitempty"` // Rename is used to rename the named or the matching headers.
	// Default is the default value to set if the header is not present
	Default string `yaml:"default"` // The default value of the header in case it is not present in the request.
	// Algorithm is the algorithm to use when multiple headers are present
	Algorithm ResponseHeaderRuleAlgorithm `yaml:"algorithm,omitempty"` // The algorithm to use when multiple headers are present.

	// Set header options
	// Name is the name of the header to set
	Name string `yaml:"name"` // The name of the header to set.
	// Value is the value of the header to set
	Value string `yaml:"value"` // The value to set for the header.
}

func (r *ResponseHeaderRule) GetOperation() HeaderRuleOperation {
	return r.Operation
}

func (r *ResponseHeaderRule) GetMatching() string {
	return r.Matching
}

type EngineDebugConfiguration struct {
	PrintOperationTransformations                bool `envDefault:"false" env:"ENGINE_DEBUG_PRINT_OPERATION_TRANSFORMATIONS" yaml:"print_operation_transformations"`                                     // Print the operation transformations.
	PrintOperationEnableASTRefs                  bool `envDefault:"false" env:"ENGINE_DEBUG_PRINT_OPERATION_ENABLE_AST_REFS" yaml:"print_operation_enable_ast_refs"`                                     // Print the operation enable AST refs.
	PrintPlanningPaths                           bool `envDefault:"false" env:"ENGINE_DEBUG_PRINT_PLANNING_PATHS" yaml:"print_planning_paths"`                                                           // Print the planning paths.
	PrintQueryPlans                              bool `envDefault:"false" env:"ENGINE_DEBUG_PRINT_QUERY_PLANS" yaml:"print_query_plans"`                                                                 // Print the query plans.
	PrintIntermediateQueryPlans                  bool `envDefault:"false" env:"ENGINE_DEBUG_PRINT_INTERMEDIATE_QUERY_PLANS" yaml:"print_intermediate_query_plans"`                                       // Print intermediate query plans.
	PrintNodeSuggestions                         bool `envDefault:"false" env:"ENGINE_DEBUG_PRINT_NODE_SUGGESTIONS" yaml:"print_node_suggestions"`                                                       // Print the node suggestions.
	ConfigurationVisitor                         bool `envDefault:"false" env:"ENGINE_DEBUG_CONFIGURATION_VISITOR" yaml:"configuration_visitor"`                                                         // Print the configuration visitor.
	PlanningVisitor                              bool `envDefault:"false" env:"ENGINE_DEBUG_PLANNING_VISITOR" yaml:"planning_visitor"`                                                                   // Print the planning visitor.
	DatasourceVisitor                            bool `envDefault:"false" env:"ENGINE_DEBUG_DATASOURCE_VISITOR" yaml:"datasource_visitor"`                                                               // Print the datasource visitor.
	ReportWebSocketConnections                   bool `envDefault:"false" env:"ENGINE_DEBUG_REPORT_WEBSOCKET_CONNECTIONS" yaml:"report_websocket_connections"`                                           // Print the websocket connections.
	ReportMemoryUsage                            bool `envDefault:"false" env:"ENGINE_DEBUG_REPORT_MEMORY_USAGE" yaml:"report_memory_usage"`                                                             // Print the memory usage.
	EnableResolverDebugging                      bool `envDefault:"false" env:"ENGINE_DEBUG_ENABLE_RESOLVER_DEBUGGING" yaml:"enable_resolver_debugging"`                                                 // Enable verbose debug logging for the Resolver.
	EnablePersistedOperationsCacheResponseHeader bool `envDefault:"false" env:"ENGINE_DEBUG_ENABLE_PERSISTED_OPERATIONS_CACHE_RESPONSE_HEADER" yaml:"enable_persisted_operations_cache_response_header"` // Enable the persisted operations cache response header.
	EnableNormalizationCacheResponseHeader       bool `envDefault:"false" env:"ENGINE_DEBUG_ENABLE_NORMALIZATION_CACHE_RESPONSE_HEADER" yaml:"enable_normalization_cache_response_header"`               // Enable the normalization cache response header.
	AlwaysIncludeQueryPlan                       bool `envDefault:"false" env:"ENGINE_DEBUG_ALWAYS_INCLUDE_QUERY_PLAN" yaml:"always_include_query_plan" jsonschema:"default=false"`                      // Always include the query plan in the response.
	AlwaysSkipLoader                             bool `envDefault:"false" env:"ENGINE_DEBUG_ALWAYS_SKIP_LOADER" yaml:"always_skip_loader" jsonschema:"default=false"`                                    // Always skip the loader.
}

type EngineExecutionConfiguration struct {
	Debug                                            EngineDebugConfiguration `yaml:"debug"`                                                                                                                                                                        // The debug configuration. The debug configuration is used to enable the debug mode for the engine.
	EnableSingleFlight                               bool                     `envDefault:"true" env:"ENGINE_ENABLE_SINGLE_FLIGHT" yaml:"enable_single_flight" jsonschema:"default=true"`                                                                           // Enable the single flight. The single flight is used to deduplicate the requests to the same subgraphs.
	EnableRequestTracing                             bool                     `envDefault:"true" env:"ENGINE_ENABLE_REQUEST_TRACING" yaml:"enable_request_tracing" jsonschema:"default=true"`                                                                       // Enable the advanced request tracing. See https://cosmo-docs.wundergraph.com/router/advanced-request-tracing-art for more information.
	EnableExecutionPlanCacheResponseHeader           bool                     `envDefault:"false" env:"ENGINE_ENABLE_EXECUTION_PLAN_CACHE_RESPONSE_HEADER" yaml:"enable_execution_plan_cache_response_header"`                                                      // Enable the execution plan cache response header. The execution plan cache response header is used to cache the execution plan in the client.
	MaxConcurrentResolvers                           int                      `envDefault:"1024" env:"ENGINE_MAX_CONCURRENT_RESOLVERS" yaml:"max_concurrent_resolvers,omitempty" jsonschema:"default=1024"`                                                         // The maximum number of concurrent resolvers. The higher the number, the more requests can be processed in parallel but at the cost of more memory usage.
	EnableNetPoll                                    bool                     `envDefault:"true" env:"ENGINE_ENABLE_NET_POLL" yaml:"enable_net_poll" jsonschema:"default=true"`                                                                                     // Enables the more efficient poll implementation for all WebSocket implementations (client, server) of the router. This is only available on Linux and MacOS. On Windows or when the host system is limited, the default synchronous implementation is used.
	WebSocketClientPollTimeout                       time.Duration            `envDefault:"1s" env:"ENGINE_WEBSOCKET_CLIENT_POLL_TIMEOUT" yaml:"websocket_client_poll_timeout,omitempty" jsonschema:"default=1s"`                                                   // The timeout for the poll loop of the WebSocket client implementation. The timeout is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	WebSocketClientConnBufferSize                    int                      `envDefault:"128" env:"ENGINE_WEBSOCKET_CLIENT_CONN_BUFFER_SIZE" yaml:"websocket_client_conn_buffer_size,omitempty" jsonschema:"default=128"`                                         // The buffer size for the poll buffer of the WebSocket client implementation. The buffer size determines how many connections can be handled in one loop.
	WebSocketClientReadTimeout                       time.Duration            `envDefault:"5s" env:"ENGINE_WEBSOCKET_CLIENT_READ_TIMEOUT" yaml:"websocket_client_read_timeout,omitempty" jsonschema:"default=5s"`                                                   // Defines the timeout for the websocket read of the WebSocket client implementation. This is used to set the read deadline for the connection. The timeout is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	WebSocketClientWriteTimeout                      time.Duration            `envDefault:"10s" env:"ENGINE_WEBSOCKET_CLIENT_WRITE_TIMEOUT" yaml:"websocket_client_write_timeout,omitempty" jsonschema:"default=10s"`                                               // Defines the timeout for the websocket write of the WebSocket client implementation. This is used to set the write deadline for the connection. The timeout is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	WebSocketClientPingInterval                      time.Duration            `envDefault:"15s" env:"ENGINE_WEBSOCKET_CLIENT_PING_INTERVAL" yaml:"websocket_client_ping_interval,omitempty" jsonschema:"default=15s" jsonschema_extras:"duration_minimum=5s"`       // The Websocket client ping interval to the subgraph. Defines how often the router will ping the subgraph to signal that the connection is still alive. Timeout needs to be coordinated with the subgraph. The timeout is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	WebSocketClientPingTimeout                       time.Duration            `envDefault:"30s" env:"ENGINE_WEBSOCKET_CLIENT_PING_TIMEOUT" yaml:"websocket_client_ping_timeout,omitempty" jsonschema:"default=30s" jsonschema_extras:"duration_minimum=5s"`         // The Websocket client ping timeout to the subgraph. Defines how long the router will wait for a ping response from the subgraph. The timeout is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	WebSocketClientFrameTimeout                      time.Duration            `envDefault:"100ms" env:"ENGINE_WEBSOCKET_CLIENT_FRAME_TIMEOUT" yaml:"websocket_client_frame_timeout,omitempty" jsonschema:"default=100ms" jsonschema_extras:"duration_minimum=10ms"` // The Websocket client frame timeout to the subgraph. Defines how long the router will wait for a frame response from the subgraph. The timeout is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	ExecutionPlanCacheSize                           int64                    `envDefault:"1024" env:"ENGINE_EXECUTION_PLAN_CACHE_SIZE" yaml:"execution_plan_cache_size,omitempty" jsonschema:"default=1024"`                                                       // The size of the execution plan cache.
	MinifySubgraphOperations                         bool                     `envDefault:"true" env:"ENGINE_MINIFY_SUBGRAPH_OPERATIONS" yaml:"minify_subgraph_operations" jsonschema:"default=true"`                                                               // Minify the subgraph operations. If the value is true, GraphQL Operations get minified after planning. This reduces the amount of GraphQL AST nodes the Subgraph has to parse, which ultimately saves CPU time and memory, resulting in faster response times.
	EnablePersistedOperationsCache                   bool                     `envDefault:"true" env:"ENGINE_ENABLE_PERSISTED_OPERATIONS_CACHE" yaml:"enable_persisted_operations_cache" jsonschema:"default=true"`                                                 // Enable the persisted operations cache. The persisted operations cache is used to cache normalized persisted operations to improve performance.
	EnableNormalizationCache                         bool                     `envDefault:"true" env:"ENGINE_ENABLE_NORMALIZATION_CACHE" yaml:"enable_normalization_cache" jsonschema:"default=true"`                                                               // Enable the normalization cache. The normalization cache is used to cache normalized operations to improve performance.
	NormalizationCacheSize                           int64                    `envDefault:"1024" env:"ENGINE_NORMALIZATION_CACHE_SIZE" yaml:"normalization_cache_size,omitempty" jsonschema:"default=1024"`                                                         // The size of the normalization cache.
	OperationHashCacheSize                           int64                    `envDefault:"2048" env:"ENGINE_OPERATION_HASH_CACHE_SIZE" yaml:"operation_hash_cache_size,omitempty" jsonschema:"default=2048"`                                                       // The size of the Operation Hash Cache. This should be larger than the plan cache because the hash is computed on the original query.
	ParseKitPoolSize                                 int                      `envDefault:"16" env:"ENGINE_PARSEKIT_POOL_SIZE" yaml:"parsekit_pool_size,omitempty" jsonschema:"default=8"`                                                                          // The size of the ParseKit pool. The ParseKit pool provides re-usable Resources for parsing, normalizing, validating and planning GraphQL Operations. Setting the pool size to a value much higher than the number of CPU Threads available will not improve performance, but only increase memory usage.
	EnableValidationCache                            bool                     `envDefault:"true" env:"ENGINE_ENABLE_VALIDATION_CACHE" yaml:"enable_validation_cache" jsonschema:"default=true"`                                                                     // Enable the validation cache. The validation cache is used to cache results of validating GraphQL Operations.
	ValidationCacheSize                              int64                    `envDefault:"1024" env:"ENGINE_VALIDATION_CACHE_SIZE" yaml:"validation_cache_size,omitempty" jsonschema:"default=1024"`                                                               // The size of the validation cache.
	DisableExposingVariablesContentOnValidationError bool                     `envDefault:"false" env:"ENGINE_DISABLE_EXPOSING_VARIABLES_CONTENT_ON_VALIDATION_ERROR" yaml:"disable_exposing_variables_content_on_validation_error" jsonschema:"default=false"`     // Disables exposing the variables content in the error response. This is useful to avoid leaking sensitive information in the error response.
	ResolverMaxRecyclableParserSize                  int                      `envDefault:"32768" env:"ENGINE_RESOLVER_MAX_RECYCLABLE_PARSER_SIZE" yaml:"resolver_max_recyclable_parser_size,omitempty" jsonschema:"default=32768"`                                 // Limits the size of the Parser that can be recycled back into the Pool. If set to 0, no limit is applied. This helps keep the Heap size more maintainable if you regularly perform large queries.
	EnableSubgraphFetchOperationName                 bool                     `envDefault:"false" env:"ENGINE_ENABLE_SUBGRAPH_FETCH_OPERATION_NAME" yaml:"enable_subgraph_fetch_operation_name" jsonschema:"default=false"`                                         // Enable appending the operation name to subgraph fetches. This will ensure that the operation name will be included in the corresponding subgraph requests using the following format: $operationName__$subgraphName__$sequenceID.
	DisableVariablesRemapping                        bool                     `envDefault:"false" env:"ENGINE_DISABLE_VARIABLES_REMAPPING" yaml:"disable_variables_remapping" jsonschema:"default=false"`                                                           // Disables variables renaming during normalization. This option could have a negative impact on planner cache hits.
	SubscriptionFetchTimeout                         time.Duration            `envDefault:"30s" env:"ENGINE_SUBSCRIPTION_FETCH_TIMEOUT" yaml:"subscription_fetch_timeout,omitempty" jsonschema:"default=30s"`                                                       // The maximum time a subscription fetch can take before it is considered timed out. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
}

type BlockOperationConfiguration struct {
	Enabled   bool   `yaml:"enabled" envDefault:"false" env:"ENABLED"` // Block mutation/subscription/non-persisted Operations. If the value is true, all operations are blocked. You can also specify a condition that is evaluated to determine if the operation should be blocked.
	Condition string `yaml:"condition" env:"CONDITION"`                // The expression to evaluate if the operation should be blocked. The expression is specified as a string and needs to evaluate to a boolean. Please see https://expr-lang.org/ for more information.
}

type SecurityConfiguration struct {
	BlockMutations              BlockOperationConfiguration `yaml:"block_mutations" envPrefix:"SECURITY_BLOCK_MUTATIONS_"`                               // The configuration for blocking mutations.
	BlockSubscriptions          BlockOperationConfiguration `yaml:"block_subscriptions" envPrefix:"SECURITY_BLOCK_SUBSCRIPTIONS_"`                       // The configuration for blocking subscriptions.
	BlockNonPersistedOperations BlockOperationConfiguration `yaml:"block_non_persisted_operations" envPrefix:"SECURITY_BLOCK_NON_PERSISTED_OPERATIONS_"` // The configuration for blocking non-persisted operations.
	ComplexityCalculationCache  *ComplexityCalculationCache `yaml:"complexity_calculation_cache"`                                                        // The configuration for the complexity calculation cache.
	ComplexityLimits            *ComplexityLimits           `yaml:"complexity_limits"`                                                                   // The configuration for complexity limits for queries
	DepthLimit                  *QueryDepthConfiguration    `yaml:"depth_limit"`                                                                         // DEPRECATED: The configuration for adding a max depth limit for query.
	ParserLimits                ParserLimitsConfiguration   `yaml:"parser_limits"`                                                                       // The configuration to enforce parser limits for the query depth and fields count.
}

type ParserLimitsConfiguration struct {
	ApproximateDepthLimit int `yaml:"approximate_depth_limit,omitempty" envDefault:"100" jsonschema:"default=100"` // The approximate cumulative depth limit of a query, including fragments. Set to 0 to disable.
	TotalFieldsLimit      int `yaml:"total_fields_limit,omitempty" envDefault:"500" jsonschema:"default=500"`      // The total number of fields the parser will allow. Set to 0 to disable.
}

type QueryDepthConfiguration struct {
	Enabled                   bool  `yaml:"enabled" envDefault:"false" env:"SECURITY_QUERY_DEPTH_ENABLED" jsonschema:"default=false"`                                                   // Enable query depth limits. If the value is true (default: false), and a valid limit value is set, a query depth will be calculated for your requests, and a limit applied to the queries.
	Limit                     int   `yaml:"limit,omitempty" envDefault:"0" env:"SECURITY_QUERY_DEPTH_LIMIT" jsonschema:"default=0"`                                                     // The depth limit for query. If the limit is 0, this limit isn't applied.
	CacheSize                 int64 `yaml:"cache_size,omitempty" envDefault:"1024" env:"SECURITY_QUERY_DEPTH_CACHE_SIZE" jsonschema:"default=1024"`                                     // The size of the cache for query depth. If users set a max_query_depth, we cache the decision per query.
	IgnorePersistedOperations bool  `yaml:"ignore_persisted_operations,omitempty" envDefault:"false" env:"SECURITY_QUERY_DEPTH_IGNORE_PERSISTED_OPERATIONS" jsonschema:"default=false"` // Disable the max query depth limit for persisted operations. Since persisted operations are stored intentionally, users may want to disable the limit to consciously allow nested persisted operations.
}

type ComplexityCalculationCache struct {
	Enabled   bool  `yaml:"enabled" envDefault:"false" env:"SECURITY_COMPLEXITY_CACHE_ENABLED" jsonschema:"default=true"`    // Enable the complexity calculation cache. If the value is true, the complexity calculation cache is enabled.
	CacheSize int64 `yaml:"size,omitempty" envDefault:"1024" env:"SECURITY_COMPLEXITY_CACHE_SIZE" jsonschema:"default=1024"` // The size of the cache for the complexity calculation.
}

type ComplexityLimits struct {
	Depth            *ComplexityLimit `yaml:"depth"`              // The configuration for adding a max depth limit for query (how many nested levels you can have in a query). This limit prevents infinite querying, and also limits the size of the data returned. If the limit is 0, this limit isn't applied.
	TotalFields      *ComplexityLimit `yaml:"total_fields"`       // How many total fields are allowed to be in a particular query. This limit prevents queries from becoming too large.
	RootFields       *ComplexityLimit `yaml:"root_fields"`        // How many root fields are allowed in a query.
	RootFieldAliases *ComplexityLimit `yaml:"root_field_aliases"` // How many root field aliases are allowed in a query.
}

type ComplexityLimit struct {
	Enabled                   bool `yaml:"enabled" envDefault:"false" jsonschema:"default=false"`                               // Enable the limit (depth/total fields/root fields/root field aliases). If the value is true (default: false), and a valid limit value is set, a limit will be applied to the queries.
	Limit                     int  `yaml:"limit,omitempty" envDefault:"0" jsonschema:"default=0"`                               // The limit value (depth/total fields/root fields/root field aliases). If the limit is 0, this limit isn't applied.
	IgnorePersistedOperations bool `yaml:"ignore_persisted_operations,omitempty" envDefault:"false" jsonschema:"default=false"` // Disable the limit for persisted operations. Since persisted operations are stored intentionally, users may want to disable the limit to consciously allow nested persisted operations.
}

func (c *ComplexityLimit) ApplyLimit(isPersistent bool) bool {
	return c.Enabled && (!isPersistent || isPersistent && !c.IgnorePersistedOperations)
}

type OverrideRoutingURLConfiguration struct {
	Subgraphs map[string]HttpUrlString `yaml:"subgraphs"` // The configuration for the subgraphs.
}

type SubgraphOverridesConfiguration struct {
	RoutingURL                       HttpUrlString `yaml:"routing_url"`                        // The URL of the subgraph.
	SubscriptionURL                  HttpUrlString `yaml:"subscription_url"`                   // The Subscription URL of the subgraph.
	SubscriptionProtocol             string        `yaml:"subscription_protocol"`              // The Subscription protocol of the subgraph.
	SubscriptionWebsocketSubprotocol string        `yaml:"subscription_websocket_subprotocol"` // The Websocket subprotocol of the subgraph.
}

type OverridesConfiguration struct {
	Subgraphs map[string]SubgraphOverridesConfiguration `yaml:"subgraphs"` // The configuration for the subgraphs.
}

type JWKSConfiguration struct {
	URL             HttpUrlString `yaml:"url"`                                                                                              // The URL of the JWKs.
	Algorithms      []string      `yaml:"algorithms"`                                                                                       // The allowed algorithms for the keys that are retrieved from the JWKs.
	RefreshInterval time.Duration `yaml:"refresh_interval" envDefault:"1m" jsonschema:"default=1m" jsonschema_extras:"duration_minimum=5s"` // The interval at which the JWKs are refreshed.

	// For secret based where we need to create a jwk  entry with
	// a key id and algorithm

	Secret    string `yaml:"secret"`    // The secret of the JWKs
	Algorithm string `yaml:"algorithm"` // The algorithm used
	KeyId     string `yaml:"key_id"`    // The secret of the JWKs
}

type HeaderSource struct {
	Type          string   `yaml:"type"`           // The type of the source.
	Name          string   `yaml:"name"`           // The name of the header.
	ValuePrefixes []string `yaml:"value_prefixes"` // The prefixes of the header value.
}

type JWTAuthenticationConfiguration struct {
	JWKS              []JWKSConfiguration `yaml:"jwks"`
	HeaderName        string              `yaml:"header_name" envDefault:"Authorization" jsonschema:"default=Authorization"` // The name of the header. The header is used to extract the token from the request. The default value is 'Authorization'.
	HeaderValuePrefix string              `yaml:"header_value_prefix" envDefault:"Bearer" jsonschema:"default=Bearer"`       // The prefix of the header value. The prefix is used to extract the token from the header value. The default value is 'Bearer'.
	HeaderSources     []HeaderSource      `yaml:"header_sources"`                                                            // Additional sources for the token. The sources are used to extract the token from the request.
}

type AuthenticationConfiguration struct {
	JWT JWTAuthenticationConfiguration `yaml:"jwt"` // The configuration for JWT authentication.
}

type AuthorizationConfiguration struct {
	RequireAuthentication         bool `yaml:"require_authentication" envDefault:"false" env:"REQUIRE_AUTHENTICATION" jsonschema:"default=false"`                     // Ensure that the request is authenticated.
	RejectOperationIfUnauthorized bool `yaml:"reject_operation_if_unauthorized" envDefault:"false" env:"REJECT_OPERATION_IF_UNAUTHORIZED" jsonschema:"default=false"` // Reject the operation if the request is not authorized. Makes the router reject the whole GraphQL Operation if one field fails to authorize
}

type RateLimitConfiguration struct {
	Enabled        bool                    `yaml:"enabled" envDefault:"false" env:"RATE_LIMIT_ENABLED" jsonschema:"default=false"`
	Strategy       string                  `yaml:"strategy" envDefault:"simple" env:"RATE_LIMIT_STRATEGY" jsonschema:"default=simple"` // The strategy used to enforce the rate limit.
	SimpleStrategy RateLimitSimpleStrategy `yaml:"simple_strategy"`
	Storage        RedisConfiguration      `yaml:"storage"`

	// Debug ensures that retryAfter and resetAfter are set to stable values for testing
	// Debug also exposes the rate limit key in the response extension for debugging purposes

	Debug               bool                        `yaml:"debug" envDefault:"false" env:"RATE_LIMIT_DEBUG" jsonschema:"default=false"` // Enable the debug mode for the rate limit.
	KeySuffixExpression string                      `yaml:"key_suffix_expression,omitempty" env:"RATE_LIMIT_KEY_SUFFIX_EXPRESSION"`     // The expression to define a key suffix for the rate limit.
	ErrorExtensionCode  RateLimitErrorExtensionCode `yaml:"error_extension_code"`                                                       // If enabled, a code will be added to the extensions.code field of error objects related to rate limiting.
}

type RateLimitErrorExtensionCode struct {
	Enabled bool   `yaml:"enabled" envDefault:"true" env:"RATE_LIMIT_ERROR_EXTENSION_CODE_ENABLED" jsonschema:"default=true"`                    // Enable the error extension code for rate limiting.
	Code    string `yaml:"code" envDefault:"RATE_LIMIT_EXCEEDED" env:"RATE_LIMIT_ERROR_EXTENSION_CODE" jsonschema:"default=RATE_LIMIT_EXCEEDED"` // The error extension code for the rate limit.
}

type RedisConfiguration struct {
	URLs           []string `yaml:"urls,omitempty" env:"RATE_LIMIT_REDIS_URLS"`                                                                                 // The Redis connection URLs.
	ClusterEnabled bool     `yaml:"cluster_enabled,omitempty" envDefault:"false" env:"RATE_LIMIT_REDIS_CLUSTER_ENABLED" jsonschema:"default=false"`             // Enable Redis Cluster connection.
	KeyPrefix      string   `yaml:"key_prefix,omitempty" envDefault:"cosmo_rate_limit" env:"RATE_LIMIT_REDIS_KEY_PREFIX" jsonschema:"default=cosmo_rate_limit"` // The prefix of the keys used to store the rate limit data.
}

type RateLimitSimpleStrategy struct {
	Rate                           int           `yaml:"rate" envDefault:"10" env:"RATE_LIMIT_SIMPLE_RATE" jsonschema:"default=10"`                                                                   // The rate at which the requests are allowed. The rate is specified as a number of requests per second.
	Burst                          int           `yaml:"burst" envDefault:"10" env:"RATE_LIMIT_SIMPLE_BURST" jsonschema:"default=10"`                                                                 // The maximum number of requests that are allowed to exceed the rate. The burst is specified as a number of requests.
	Period                         time.Duration `yaml:"period" envDefault:"1s" env:"RATE_LIMIT_SIMPLE_PERIOD" jsonschema:"default=1s" jsonschema_extras:"duration_minimum=1s"`                       // The period of time over which the rate limit is enforced. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	RejectExceedingRequests        bool          `yaml:"reject_exceeding_requests" envDefault:"false" env:"RATE_LIMIT_SIMPLE_REJECT_EXCEEDING_REQUESTS" jsonschema:"default=false"`                   // Reject the requests that exceed the rate limit. If the value is true, the requests that exceed the rate limit are rejected.
	RejectStatusCode               int           `yaml:"reject_status_code" envDefault:"200" env:"RATE_LIMIT_SIMPLE_REJECT_STATUS_CODE" jsonschema:"default=200"`                                     // The status code to return when the request is rejected. The default value is 200 (OK) as we're returning a well formed GraphQL response.
	HideStatsFromResponseExtension bool          `yaml:"hide_stats_from_response_extension" envDefault:"false" env:"RATE_LIMIT_SIMPLE_HIDE_STATS_FROM_RESPONSE_EXTENSION" jsonschema:"default=false"` // Hide the rate limit stats from the response extension. If the value is true, the rate limit stats are not included in the response extension.
}

type CDNConfiguration struct {
	URL       HttpUrlString `yaml:"url" env:"CDN_URL" envDefault:"https://cosmo-cdn.wundergraph.com" jsonschema:"default=https://cosmo-cdn.wundergraph.com"` // The URL of the CDN.
	CacheSize BytesString   `yaml:"cache_size,omitempty" env:"CDN_CACHE_SIZE" envDefault:"100MB" jsonschema:"default=100MB"`                                 // The size of the cache used.
}

type NatsTokenBasedAuthentication struct {
	Token *string `yaml:"token,omitempty"` // The token for token-based authentication.
}

type NatsCredentialsAuthentication struct {
	Password *string `yaml:"password,omitempty"` // The password for username/password-based authentication.
	Username *string `yaml:"username,omitempty"` // The username for username/password-based authentication.
}

type NatsAuthentication struct {
	UserInfo                     NatsCredentialsAuthentication `yaml:"user_info"` // Userinfo configuration for the NATS provider.
	NatsTokenBasedAuthentication `yaml:"token,inline"`
}

type NatsEventSource struct {
	ID             string              `yaml:"id,omitempty"`             // The provider ID.
	URL            UrlString           `yaml:"url,omitempty"`            // The provider URL.
	Authentication *NatsAuthentication `yaml:"authentication,omitempty"` // Authentication configuration for the NATS provider.
}

func (n NatsEventSource) GetID() string {
	return n.ID
}

type KafkaSASLPlainAuthentication struct {
	Password *string `yaml:"password,omitempty"` // The password for plain SASL authentication.
	Username *string `yaml:"username,omitempty"` // The username for plain SASL authentication.
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
	Password  *string                  `yaml:"password,omitempty"`  // The password for SCRAM SASL authentication.
	Username  *string                  `yaml:"username,omitempty"`  // The username for SCRAM SASL authentication.
	Mechanism *KafkaSASLSCRAMMechanism `yaml:"mechanism,omitempty"` // The mechanism for SCRAM SASL authentication.
}

func (k KafkaSASLSCRAMAuthentication) IsSet() bool {
	return k.Username != nil && k.Password != nil && k.Mechanism != nil
}

type KafkaAuthentication struct {
	SASLPlain KafkaSASLPlainAuthentication `yaml:"sasl_plain,omitempty"` // Plain SASL Authentication configuration for the Kafka provider.
	SASLSCRAM KafkaSASLSCRAMAuthentication `yaml:"sasl_scram,omitempty"` // SCRAM SASL Authentication configuration for the Kafka provider.
}

type KafkaTLSConfiguration struct {
	Enabled bool `yaml:"enabled" envDefault:"false" jsonschema:"default=false"` // Enables the TLS.
}

type KafkaEventSource struct {
	ID             string                 `yaml:"id,omitempty"`             // The provider ID.
	Brokers        []HostNamePortString   `yaml:"brokers,omitempty"`        // The list of Kafka brokers.
	Authentication *KafkaAuthentication   `yaml:"authentication,omitempty"` // SASL Authentication configuration for the Kafka provider.
	TLS            *KafkaTLSConfiguration `yaml:"tls,omitempty"`            // TLS configuration for the Kafka provider.
	FetchMaxWait   time.Duration          `yaml:"fetch_max_wait,omitempty"` // The maximum wait time for fetching messages from the Kafka broker.
}

func (k KafkaEventSource) GetID() string {
	return k.ID
}

type RedisEventSource struct {
	ID             string   `yaml:"id,omitempty"`                               // The provider ID.
	URLs           []string `yaml:"urls,omitempty"`                             // The list of Redis URLs.
	ClusterEnabled bool     `yaml:"cluster_enabled" jsonschema:"default=false"` // If enabled, the Redis cluster client is used to connect to the server.
}

func (r RedisEventSource) GetID() string {
	return r.ID
}

type EventProviders struct {
	Nats  []NatsEventSource  `yaml:"nats,omitempty"`  // Configuration used by the EDFS provider to connect to the NATS server.
	Kafka []KafkaEventSource `yaml:"kafka,omitempty"` // Configuration used by the EDFS provider to connect to the Kafka server.
	Redis []RedisEventSource `yaml:"redis,omitempty"` // Configuration used by the EDFS provider to connect to the Redis server.
}

type EventsConfiguration struct {
	Providers EventProviders `yaml:"providers,omitempty"` // The provider configuration.
}

type Cluster struct {
	Name string `yaml:"name,omitempty" env:"CLUSTER_NAME"` // The name of the cluster.
}

type AbsintheProtocolConfiguration struct {
	Enabled bool `yaml:"enabled" envDefault:"true" env:"WEBSOCKETS_ABSINTHE_ENABLED" jsonschema:"default=true"` // Enable Absinthe protocol.

	// HandlerPath is the path where the Absinthe Protocol Handler is mounted
	// On this specific path, the Router will accept WebSocket Requests using the Absinthe Protocol
	// even if the Sub-protocol is not set to "absinthe"
	// Legacy clients might not set the Sub-protocol Header, so this is a fallback

	HandlerPath string `yaml:"handler_path" envDefault:"/absinthe/socket" env:"WEBSOCKETS_ABSINTHE_HANDLER_PATH" jsonschema:"default=/absinthe/socket"` // The path to mount the Absinthe Protocol Handler on.
}

type ComplianceConfig struct {
	AnonymizeIP AnonymizeIpConfiguration `yaml:"anonymize_ip,omitempty"` // The configuration for the anonymization of the IP addresses.
}

type ExportTokenConfiguration struct {
	Enabled   bool   `yaml:"enabled" envDefault:"true" jsonschema:"default=true"`                                // This configuration indicates if the Router will export the JWT to the client request header.
	HeaderKey string `yaml:"header_key,omitempty" envDefault:"Authorization" jsonschema:"default=Authorization"` // The name of the header property that will have the JWT value.
}

type WebSocketAuthenticationConfiguration struct {
	FromInitialPayload InitialPayloadAuthenticationConfiguration `yaml:"from_initial_payload,omitempty"` // The configuration used to tell the Router to look for the JWT in the initial payload of the WebSocket Connection.
}

type InitialPayloadAuthenticationConfiguration struct {
	Enabled     bool                     `yaml:"enabled,omitempty" envDefault:"false" jsonschema:"default=false"`             // This configuration indicates if the Router should look for the JWT in the initial payload of the WebSocket Connection.
	Key         string                   `yaml:"key,omitempty" envDefault:"Authorization" jsonschema:"default=Authorization"` // The name of the property holding the JWT value.
	ExportToken ExportTokenConfiguration `yaml:"export_token"`                                                                // The configuration responsible for exporting the JWT to the client's request header.
}

type WebSocketConfiguration struct {
	Enabled                      bool                                               `yaml:"enabled" envDefault:"true" env:"WEBSOCKETS_ENABLED" jsonschema:"default=true"`                                 // Enable WebSocket transport.
	AbsintheProtocol             AbsintheProtocolConfiguration                      `yaml:"absinthe_protocol,omitempty"`                                                                                  // AbsintheProtocol configuration for the Absinthe Protocol
	ForwardUpgradeHeaders        ForwardUpgradeHeadersConfiguration                 `yaml:"forward_upgrade_headers"`                                                                                      // Forward Upgrade Request Headers in the Extensions payload when starting a Subscription on a Subgraph
	ForwardUpgradeQueryParams    ForwardUpgradeQueryParamsConfiguration             `yaml:"forward_upgrade_query_params"`                                                                                 // forward Upgrade Request Query Parameters in the Extensions payload when starting a Subscription on a Subgraph
	ForwardInitialPayload        bool                                               `yaml:"forward_initial_payload" envDefault:"true" env:"WEBSOCKETS_FORWARD_INITIAL_PAYLOAD" jsonschema:"default=true"` // Forward the initial payload in the extensions payload when starting a subscription on a Subgraph.
	Authentication               WebSocketAuthenticationConfiguration               `yaml:"authentication,omitempty"`                                                                                     // The configuration used to authenticate the WebSocket connections.
	ClientInfoFromInitialPayload WebSocketClientInfoFromInitialPayloadConfiguration `yaml:"client_info_from_initial_payload"`
}

type WebSocketClientInfoFromInitialPayloadConfiguration struct {
	Enabled                 bool                                 `yaml:"enabled" envDefault:"true" env:"WEBSOCKETS_CLIENT_INFO_FROM_INITIAL_PAYLOAD_ENABLED" jsonschema:"default=true"`                                                 // This configuration indicates if the Router should set the client info from the initial payload of the WebSocket Connection.
	NameField               string                               `yaml:"name_field" envDefault:"graphql-client-name" env:"WEBSOCKETS_CLIENT_INFO_FROM_INITIAL_PAYLOAD_NAME_FIELD" jsonschema:"default=graphql-client-name"`             // The name of the field in the initial payload that will have the client name.
	VersionField            string                               `yaml:"version_field" envDefault:"graphql-client-version" env:"WEBSOCKETS_CLIENT_INFO_FROM_INITIAL_PAYLOAD_VERSION_FIELD" jsonschema:"default=graphql-client-version"` // The name of the field in the initial payload that will have the client version.
	ForwardToRequestHeaders ForwardToRequestHeadersConfiguration `yaml:"forward_to_request_headers"`
}

type ForwardToRequestHeadersConfiguration struct {
	Enabled             bool   `yaml:"enabled" envDefault:"true" env:"WEBSOCKETS_CLIENT_INFO_FROM_INITIAL_PAYLOAD_FORWARD_TO_REQUEST_HEADERS_ENABLED" jsonschema:"default=true"`                                      // This configuration indicates if the Router should forward the client info to the request headers.
	NameTargetHeader    string `yaml:"name_target_header" envDefault:"graphql-client-name" env:"WEBSOCKETS_CLIENT_INFO_FROM_INITIAL_PAYLOAD_NAME_TARGET_HEADER" jsonschema:"default=graphql-client-name"`             // The name of the header property that will have the client name.
	VersionTargetHeader string `yaml:"version_target_header" envDefault:"graphql-client-version" env:"WEBSOCKETS_CLIENT_INFO_FROM_INITIAL_PAYLOAD_VERSION_TARGET_HEADER" jsonschema:"default=graphql-client-version"` // The name of the header property that will have the client version.
}

type ForwardUpgradeHeadersConfiguration struct {
	Enabled   bool     `yaml:"enabled" envDefault:"true" env:"FORWARD_UPGRADE_HEADERS_ENABLED" jsonschema:"default=true"`                         // Forward upgrade request headers in the extensions payload when starting a subscription on a Subgraph.
	AllowList []string `yaml:"allow_list" envDefault:"Authorization" env:"FORWARD_UPGRADE_HEADERS_ALLOW_LIST" jsonschema:"default=Authorization"` // The names of the headers to forward.
}

type ForwardUpgradeQueryParamsConfiguration struct {
	Enabled   bool     `yaml:"enabled" envDefault:"true" env:"FORWARD_UPGRADE_QUERY_PARAMS_ENABLED" jsonschema:"default=false"`                        // Forward upgrade request query parameters in the extensions payload when starting a subscription on a Subgraph.
	AllowList []string `yaml:"allow_list" envDefault:"Authorization" env:"FORWARD_UPGRADE_QUERY_PARAMS_ALLOW_LIST" jsonschema:"default=Authorization"` // The names of the query parameters to forward.
}

type AnonymizeIpConfiguration struct {
	Enabled bool   `yaml:"enabled" envDefault:"true" env:"SECURITY_ANONYMIZE_IP_ENABLED" jsonschema:"default=true"`   // Enable the anonymization of the IP addresses.
	Method  string `yaml:"method" envDefault:"redact" env:"SECURITY_ANONYMIZE_IP_METHOD" jsonschema:"default=redact"` // The method used to anonymize the IP addresses.
}

type TLSClientAuthConfiguration struct {
	CertFile FilePathString `yaml:"cert_file,omitempty" env:"TLS_CLIENT_AUTH_CERT_FILE"`                                   // The path to the certificate file.
	Required bool           `yaml:"required" envDefault:"false" env:"TLS_CLIENT_AUTH_REQUIRED" jsonschema:"default=false"` // Require clients to present a valid certificate that is verified.
}

type TLSServerConfiguration struct {
	Enabled  bool           `yaml:"enabled" envDefault:"false" env:"TLS_SERVER_ENABLED" jsonschema:"default=false"` // Enable the TLS.
	CertFile FilePathString `yaml:"cert_file,omitempty" env:"TLS_SERVER_CERT_FILE"`                                 // The path to the certificate file.
	KeyFile  FilePathString `yaml:"key_file,omitempty" env:"TLS_SERVER_KEY_FILE"`                                   // The path to the key file.

	ClientAuth TLSClientAuthConfiguration `yaml:"client_auth,omitempty"` // The configuration for the client authentication.
}

type TLSConfiguration struct {
	Server TLSServerConfiguration `yaml:"server"` // The configuration for the server TLS.
}

type SubgraphErrorPropagationMode string

const (
	SubgraphErrorPropagationModeWrapped     SubgraphErrorPropagationMode = "wrapped"
	SubgraphErrorPropagationModePassThrough SubgraphErrorPropagationMode = "pass-through"
)

type SubgraphErrorPropagationConfiguration struct {
	Enabled                 bool                         `yaml:"enabled" envDefault:"true" env:"ENABLED" jsonschema:"default=true"`                                                                       // Enable error propagation.
	PropagateStatusCodes    bool                         `yaml:"propagate_status_codes" envDefault:"false" env:"STATUS_CODES" jsonschema:"default=false"`                                                 // Propagate Subgraph HTTP status codes.
	Mode                    SubgraphErrorPropagationMode `yaml:"mode" envDefault:"wrapped" env:"MODE" jsonschema:"default=wrapped"`                                                                       // The mode of error propagation.
	RewritePaths            bool                         `yaml:"rewrite_paths" envDefault:"true" env:"REWRITE_PATHS" jsonschema:"default=true"`                                                           // Rewrite the paths of the Subgraph errors.
	OmitLocations           bool                         `yaml:"omit_locations" envDefault:"true" env:"OMIT_LOCATIONS" jsonschema:"default=true"`                                                         // Omit the location field of Subgraph errors.
	OmitExtensions          bool                         `yaml:"omit_extensions" envDefault:"false" env:"OMIT_EXTENSIONS" jsonschema:"default=false"`                                                     // Omit the extensions field of Subgraph errors.
	AttachServiceName       bool                         `yaml:"attach_service_name" envDefault:"true" env:"ATTACH_SERVICE_NAME" jsonschema:"default=true"`                                               // Attach the service name to each Subgraph error.
	DefaultExtensionCode    string                       `yaml:"default_extension_code" envDefault:"DOWNSTREAM_SERVICE_ERROR" env:"DEFAULT_EXTENSION_CODE" jsonschema:"default=DOWNSTREAM_SERVICE_ERROR"` // The default extension code.
	AllowAllExtensionFields bool                         `yaml:"allow_all_extension_fields" envDefault:"false" env:"ALLOW_ALL_EXTENSION_FIELDS" jsonschema:"default=false"`                               // Allow all extension fields from Subgraph errors to be propagated to the client.
	AllowedExtensionFields  []string                     `yaml:"allowed_extension_fields" envDefault:"code" env:"ALLOWED_EXTENSION_FIELDS" jsonschema:"default=code"`                                     // The allowed extension fields.
	AllowedFields           []string                     `yaml:"allowed_fields" env:"ALLOWED_FIELDS"`                                                                                                     // The allowed fields in passthrough mode.
}

type StorageProviders struct {
	S3         []S3StorageProvider         `yaml:"s3,omitempty"` // The configuration for the S3 storage provider. If no access key and secret key are provided, the provider will attempt to retrieve IAM credentials from the EC2 service.
	CDN        []CDNStorageProvider        `yaml:"cdn,omitempty"`
	Redis      []RedisStorageProvider      `yaml:"redis,omitempty"`
	FileSystem []FileSystemStorageProvider `yaml:"file_system,omitempty"`
}

type PersistedOperationsStorageConfig struct {
	ProviderID   string `yaml:"provider_id,omitempty" env:"PERSISTED_OPERATIONS_STORAGE_PROVIDER_ID"`     // The ID of the storage provider.
	ObjectPrefix string `yaml:"object_prefix,omitempty" env:"PERSISTED_OPERATIONS_STORAGE_OBJECT_PREFIX"` // The prefix of the object in the storage provider location.
}

type AutomaticPersistedQueriesStorageConfig struct {
	ProviderID   string `yaml:"provider_id,omitempty" env:"APQ_STORAGE_PROVIDER_ID"`     // The ID of the storage provider.
	ObjectPrefix string `yaml:"object_prefix,omitempty" env:"APQ_STORAGE_OBJECT_PREFIX"` // The prefix of the object in the storage provider location.
}

type S3StorageProvider struct {
	ID        string `yaml:"id,omitempty"`         // The ID of the storage provider. The ID is used to identify the storage provider in the configuration.
	Endpoint  string `yaml:"endpoint,omitempty"`   // The S3 endpoint to connect to. The endpoint is used to connect to the S3 provider. If not set, the default S3 endpoint is used.
	AccessKey string `yaml:"access_key,omitempty"` // The access key of the S3 bucket. The access key ID is used to authenticate with the S3 bucket.
	SecretKey string `yaml:"secret_key,omitempty"` // The secret key of the S3 bucket.
	Bucket    string `yaml:"bucket,omitempty"`     // The name of the S3 bucket.
	Region    string `yaml:"region,omitempty"`     // The region of the S3 bucket.
	Secure    bool   `yaml:"secure,omitempty"`     // Enable the secure connection.
}

type CDNStorageProvider struct {
	ID  string `yaml:"id,omitempty"`                                                                                                        // The provider ID. The provider ID is used to identify the provider in the configuration.
	URL string `yaml:"url,omitempty" envDefault:"https://cosmo-cdn.wundergraph.com" jsonschema:"default=https://cosmo-cdn.wundergraph.com"` // The provider URL. The URL is used to connect to the provider.
}

type FileSystemStorageProvider struct {
	ID   string `yaml:"id,omitempty" env:"STORAGE_PROVIDER_FS_ID"`     // The provider ID. The provider ID is used to identify the provider in the configuration.
	Path string `yaml:"path,omitempty" env:"STORAGE_PROVIDER_FS_PATH"` // The file system path where data is stored and retrieved.
}

type RedisStorageProvider struct {
	ID             string   `yaml:"id,omitempty" env:"STORAGE_PROVIDER_REDIS_ID"`                                                                         // The provider ID. The provider ID is used to identify the provider in the configuration.
	URLs           []string `yaml:"urls,omitempty" env:"STORAGE_PROVIDER_REDIS_URLS"`                                                                     // List of Redis URLs to connect to. If cluster_enabled is true, these are the seeds to discover the cluster.
	ClusterEnabled bool     `yaml:"cluster_enabled,omitempty" envDefault:"false" env:"STORAGE_PROVIDER_REDIS_CLUSTER_ENABLED" jsonschema:"default=false"` // Whether to use the Redis Cluster client.
}

type PersistedOperationsCDNProvider struct {
	URL string `yaml:"url,omitempty" envDefault:"https://cosmo-cdn.wundergraph.com" jsonschema:"default=https://cosmo-cdn.wundergraph.com"` // The provider URL. The URL is used to connect to the provider.
}

type ExecutionConfigStorage struct {
	ProviderID string `yaml:"provider_id,omitempty" env:"PROVIDER_ID"` // The ID of the storage provider.
	ObjectPath string `yaml:"object_path,omitempty" env:"OBJECT_PATH"` // The path to the execution config in the storage provider.
}

type FallbackExecutionConfigStorage struct {
	Enabled    bool   `yaml:"enabled" envDefault:"false" env:"ENABLED" jsonschema:"default=false"` // Enable fallback storage provider.
	ProviderID string `yaml:"provider_id,omitempty" env:"PROVIDER_ID"`                             // The ID of the storage provider.
	ObjectPath string `yaml:"object_path,omitempty" env:"OBJECT_PATH"`                             // The path to the execution config in the storage provider.
}

type ExecutionConfigFile struct {
	Path          FilePathString `yaml:"path,omitempty" env:"EXECUTION_CONFIG_FILE_PATH"`                                                                                                        // The path to the execution config file.
	Watch         bool           `yaml:"watch,omitempty" envDefault:"false" env:"EXECUTION_CONFIG_FILE_WATCH" jsonschema:"default=false"`                                                        // Enable the watch mode.
	WatchInterval time.Duration  `yaml:"watch_interval,omitempty" envDefault:"1s" env:"EXECUTION_CONFIG_FILE_WATCH_INTERVAL" jsonschema:"default=1s" jsonschema_extras:"duration_minimum=100ms"` // The interval at which the file is checked for changes.
}

type ExecutionConfig struct {
	File            ExecutionConfigFile            `yaml:"file,omitempty"`                                                            // The configuration for the execution config file.
	Storage         ExecutionConfigStorage         `yaml:"storage,omitempty" envPrefix:"EXECUTION_CONFIG_STORAGE_"`                   // The storage provider for the execution config.
	FallbackStorage FallbackExecutionConfigStorage `yaml:"fallback_storage,omitempty" envPrefix:"EXECUTION_CONFIG_FALLBACK_STORAGE_"` // The fallback storage provider for the execution config in case the primary one fails.
}

type PersistedOperationsCacheConfig struct {
	Size BytesString `yaml:"size,omitempty" env:"PERSISTED_OPERATIONS_CACHE_SIZE" envDefault:"100MB" jsonschema:"default=100MB"` // The size of the cache used.
}

type AutomaticPersistedQueriesCacheConfig struct {
	Size BytesString `yaml:"size,omitempty" env:"APQ_CACHE_SIZE" envDefault:"100MB" jsonschema:"default=100MB"` // The size of the in-place cache used.
	TTL  int         `yaml:"ttl" env:"APQ_CACHE_TTL" envDefault:"-1" jsonschema:"default=0"`                    // The ttl of the cache (in seconds).
}

type PersistedOperationsConfig struct {
	Disabled   bool                             `yaml:"disabled" env:"DISABLED" envDefault:"false" jsonschema:"default=false"`       // Disables persisted operations.
	LogUnknown bool                             `yaml:"log_unknown" env:"LOG_UNKNOWN" envDefault:"false" jsonschema:"default=false"` // Log operations which haven't yet been persisted.
	Safelist   SafelistConfiguration            `yaml:"safelist" envPrefix:"SAFELIST_"`                                              // The configuration for safelisting persisted operations.
	Cache      PersistedOperationsCacheConfig   `yaml:"cache"`
	Storage    PersistedOperationsStorageConfig `yaml:"storage"` // The storage provider for persisted operation.
}

type SafelistConfiguration struct {
	Enabled bool `yaml:"enabled" envDefault:"false" env:"ENABLED" jsonschema:"default=false"` // Only allows persisted operations.
}

type AutomaticPersistedQueriesConfig struct {
	Enabled bool                                   `yaml:"enabled" env:"APQ_ENABLED" envDefault:"false" jsonschema:"default=false"` // Enable automatic persisted queries.
	Cache   AutomaticPersistedQueriesCacheConfig   `yaml:"cache"`
	Storage AutomaticPersistedQueriesStorageConfig `yaml:"storage"` // The storage provider for automatic persisted operation.
}

type AccessLogsConfig struct {
	Enabled   bool                      `yaml:"enabled" env:"ACCESS_LOGS_ENABLED" envDefault:"true" jsonschema:"default=true"` // Enable the access logs.
	Buffer    AccessLogsBufferConfig    `yaml:"buffer,omitempty" env:"ACCESS_LOGS_BUFFER"`
	Output    AccessLogsOutputConfig    `yaml:"output,omitempty" env:"ACCESS_LOGS_OUTPUT"`      // The log destination.
	Router    AccessLogsRouterConfig    `yaml:"router,omitempty" env:"ACCESS_LOGS_ROUTER"`      // The configuration for the router access logs
	Subgraphs AccessLogsSubgraphsConfig `yaml:"subgraphs,omitempty" env:"ACCESS_LOGS_SUBGRAPH"` // The configuration for the subgraph access logs
}

type BatchingConfig struct {
	Enabled            bool `yaml:"enabled" env:"BATCHING_ENABLED" envDefault:"false" jsonschema:"default=false"`                 // Enable the batching.
	MaxConcurrency     int  `yaml:"max_concurrency" env:"BATCHING_MAX_CONCURRENCY" envDefault:"10" jsonschema:"default=10"`       // The maximum number of batches that can be processed concurrently
	MaxEntriesPerBatch int  `yaml:"max_entries_per_batch" env:"BATCHING_MAX_ENTRIES" envDefault:"100" jsonschema:"default=100"`   // The maximum number of entries allowed in a batch
	OmitExtensions     bool `yaml:"omit_extensions" env:"BATCHING_OMIT_EXTENSIONS" envDefault:"false" jsonschema:"default=false"` // omit extensions on any batch processing errors
}

type AccessLogsBufferConfig struct {
	Enabled       bool          `yaml:"enabled" env:"ACCESS_LOGS_BUFFER_ENABLED" envDefault:"false" jsonschema:"default=false"`                                                                   // Enable the buffer. The buffer is used to buffer the logs before writing them to the output.
	Size          BytesString   `yaml:"size" envDefault:"256KB" env:"ACCESS_LOGS_BUFFER_SIZE" jsonschema:"default=256KB"`                                                                         // The size of the buffer.
	FlushInterval time.Duration `yaml:"flush_interval" envDefault:"10s" env:"ACCESS_LOGS_FLUSH_INTERVAL" jsonschema:"default=10s" jsonschema_extras:"duration_minimum=100ms,duration_maximum=1m"` // The interval at which the buffer is flushed. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
}

type AccessLogsOutputConfig struct {
	Stdout AccessLogsStdOutOutputConfig `yaml:"stdout" env:"ACCESS_LOGS_OUTPUT_STDOUT"`
	File   AccessLogsFileOutputConfig   `yaml:"file,omitempty" env:"ACCESS_LOGS_FILE_OUTPUT"`
}

type AccessLogsStdOutOutputConfig struct {
	Enabled bool `yaml:"enabled" envDefault:"true" env:"ACCESS_LOGS_OUTPUT_STDOUT_ENABLED" jsonschema:"default=true"`
}

type AccessLogsFileOutputConfig struct {
	Enabled bool   `yaml:"enabled" env:"ACCESS_LOGS_OUTPUT_FILE_ENABLED" envDefault:"false" jsonschema:"default=false"`
	Path    string `yaml:"path" env:"ACCESS_LOGS_FILE_OUTPUT_PATH" envDefault:"access.log" jsonschema:"default=access.log"` // The path to the log file.
}

type AccessLogsRouterConfig struct {
	Fields []CustomAttribute `yaml:"fields,omitempty" env:"ACCESS_LOGS_ROUTER_FIELDS"` // The fields to add to the logs. The fields are added to the logs as key-value pairs.
}

type AccessLogsSubgraphsConfig struct {
	Enabled bool              `yaml:"enabled" env:"ACCESS_LOGS_SUBGRAPH_ENABLED" envDefault:"false" jsonschema:"default=false"` // Enable the subgraph access logs.
	Fields  []CustomAttribute `yaml:"fields,omitempty" env:"ACCESS_LOGS_SUBGRAPH_FIELDS"`                                       // The configuration for custom fields. Custom attributes can be created from request headers or context fields. Not every context fields are available at all request life-cycle stages. If a value is a list, the value is JSON encoded for OTLP. For Prometheus, the values are exploded into multiple metrics with unique labels. Keep in mind, that every new custom attribute increases the cardinality.
}

type ApolloCompatibilityFlags struct {
	EnableAll                          bool                    `yaml:"enable_all" envDefault:"false" env:"APOLLO_COMPATIBILITY_ENABLE_ALL" jsonschema:"default=false"`                // Enable all Apollo compatibility flags.
	ValueCompletion                    ApolloCompatibilityFlag `yaml:"value_completion" envPrefix:"APOLLO_COMPATIBILITY_VALUE_COMPLETION_"`                                           // Invalid __typename values will be returned in extensions.valueCompletion instead of errors.
	TruncateFloats                     ApolloCompatibilityFlag `yaml:"truncate_floats" envPrefix:"APOLLO_COMPATIBILITY_TRUNCATE_FLOATS_"`                                             // Truncate floats like 1.0 to 1, 2.0 to 2, etc.
	SuppressFetchErrors                ApolloCompatibilityFlag `yaml:"suppress_fetch_errors" envPrefix:"APOLLO_COMPATIBILITY_SUPPRESS_FETCH_ERRORS_"`                                 // Suppresses fetch errors.
	ReplaceUndefinedOpFieldErrors      ApolloCompatibilityFlag `yaml:"replace_undefined_op_field_errors" envPrefix:"APOLLO_COMPATIBILITY_REPLACE_UNDEFINED_OP_FIELD_ERRORS_"`         // Produces the same error as Apollo when an invalid operation field is included in an operation selection set.
	ReplaceInvalidVarErrors            ApolloCompatibilityFlag `yaml:"replace_invalid_var_errors" envPrefix:"APOLLO_COMPATIBILITY_REPLACE_INVALID_VAR_ERRORS_"`                       // Produces the same error as Apollo when an invalid variable is supplied.
	ReplaceValidationErrorStatus       ApolloCompatibilityFlag `yaml:"replace_validation_error_status" envPrefix:"APOLLO_COMPATIBILITY_REPLACE_VALIDATION_ERROR_STATUS_"`             // Produces the same error status code (400) as Apollo when validation fails.
	SubscriptionMultipartPrintBoundary ApolloCompatibilityFlag `yaml:"subscription_multipart_print_boundary" envPrefix:"APOLLO_COMPATIBILITY_SUBSCRIPTION_MULTIPART_PRINT_BOUNDARY_"` // Prints the multipart boundary right after the message in multipart subscriptions.
	UseGraphQLValidationFailedStatus   ApolloCompatibilityFlag `yaml:"use_graphql_validation_failed_status" envPrefix:"APOLLO_COMPATIBILITY_USE_GRAPHQL_VALIDATION_FAILED_STATUS_"`   // Uses Apollo compliant validation errors, including 400 status and GRAPHQL_VALIDATION_FAILED extension.
}

type ApolloRouterCompatibilityFlags struct {
	ReplaceInvalidVarErrors ApolloCompatibilityFlag `yaml:"replace_invalid_var_errors" envPrefix:"APOLLO_ROUTER_COMPATIBILITY_REPLACE_INVALID_VAR_ERRORS_"` // Produces the same error as Apollo Router when an invalid variable is supplied.
	SubrequestHTTPError     ApolloCompatibilityFlag `yaml:"subrequest_http_error" envPrefix:"APOLLO_ROUTER_COMPATIBILITY_SUBREQUEST_HTTP_ERROR_"`           // Prepends an additional error when subgraph HTTP response code is non-2XX, similar to Apollo Router.
}

type ApolloCompatibilityFlag struct {
	Enabled bool `yaml:"enabled" envDefault:"false" env:"ENABLED" jsonschema:"default=false"`
}

type ClientHeader struct {
	Name    string `yaml:"name,omitempty"`    // The custom client name header.
	Version string `yaml:"version,omitempty"` // The custom client version header.
}

type CacheWarmupSource struct {
	Filesystem *CacheWarmupFileSystemSource `yaml:"filesystem,omitempty"` // The filesystem source of the cache warmup items.
}

type CacheWarmupFileSystemSource struct {
	Path FilePathString `yaml:"path" env:"CACHE_WARMUP_SOURCE_FILESYSTEM_PATH"` // The path to the directory containing the cache warmup items.
}

type CacheWarmupCDNSource struct{}

type CacheWarmupConfiguration struct {
	Enabled        bool              `yaml:"enabled" envDefault:"false" env:"CACHE_WARMUP_ENABLED" jsonschema:"default=false"`                                     // Enable the cache warmup.
	Source         CacheWarmupSource `yaml:"source"  env:"CACHE_WARMUP_SOURCE"`                                                                                    // The source of the cache warmup items.
	Workers        int               `yaml:"workers" envDefault:"8" env:"CACHE_WARMUP_WORKERS" jsonschema:"default=8"`                                             // The number of workers for the cache warmup to run in parallel.
	ItemsPerSecond int               `yaml:"items_per_second" envDefault:"50" env:"CACHE_WARMUP_ITEMS_PER_SECOND" jsonschema:"default=50"`                         // The number of cache warmup items to process per second.
	Timeout        time.Duration     `yaml:"timeout" envDefault:"30s" env:"CACHE_WARMUP_TIMEOUT" jsonschema:"default=30s" jsonschema_extras:"duration_minimum=1s"` // The timeout for warming up the cache.
}

type MCPConfiguration struct {
	Enabled                   bool             `yaml:"enabled" envDefault:"false" env:"MCP_ENABLED" jsonschema:"default=false"`                                         // Enable the MCP server.
	Server                    MCPServer        `yaml:"server,omitempty"`                                                                                                // Server configuration for the MCP server.
	Storage                   MCPStorageConfig `yaml:"storage,omitempty"`                                                                                               // Storage provider configuration for the MCP server.
	GraphName                 string           `yaml:"graph_name" envDefault:"mygraph" env:"MCP_GRAPH_NAME" jsonschema:"default=wundergraph-cosmo-mygraph"`             // The name of the graph to be used as suffix for the MCP server name.
	ExcludeMutations          bool             `yaml:"exclude_mutations" envDefault:"false" env:"MCP_EXCLUDE_MUTATIONS" jsonschema:"default=false"`                     // Exclude mutation operations from being exposed via MCP.
	EnableArbitraryOperations bool             `yaml:"enable_arbitrary_operations" envDefault:"false" env:"MCP_ENABLE_ARBITRARY_OPERATIONS" jsonschema:"default=false"` // Enable arbitrary GraphQL operation execution through MCP.
	ExposeSchema              bool             `yaml:"expose_schema" envDefault:"false" env:"MCP_EXPOSE_SCHEMA" jsonschema:"default=false"`                             // Expose the full GraphQL schema through MCP.
	RouterURL                 UrlString        `yaml:"router_url,omitempty" env:"MCP_ROUTER_URL"`                                                                       // Custom URL to use for the router GraphQL endpoint in MCP.
}

type MCPStorageConfig struct {
	ProviderID string `yaml:"provider_id,omitempty" env:"MCP_STORAGE_PROVIDER_ID"` // The ID of the storage provider to use for loading GraphQL operations.
}

type MCPServer struct {
	ListenAddr HostNamePortString `yaml:"listen_addr" envDefault:"localhost:5025" env:"MCP_SERVER_LISTEN_ADDR" jsonschema:"default=localhost:5025"` // The address on which the MCP server listens for incoming requests.
	BaseURL    HttpUrlString      `yaml:"base_url,omitempty" env:"MCP_SERVER_BASE_URL"`                                                             // The base URL of the MCP server.
}

type PluginsConfiguration struct {
	Enabled bool   `yaml:"enabled" envDefault:"false" env:"ENABLED" jsonschema:"default=false"` // Enable the router gRPC plugins.
	Path    string `yaml:"path" envDefault:"plugins" env:"PATH" jsonschema:"default=plugins"`   // The path to the plugins directory.
}

type Config struct {
	Version string `yaml:"version,omitempty" ignored:"true" jsonschema:"enum=1"` // The version of the configuration file. This is used to ensure that the configuration file is compatible.

	InstanceID     string             `yaml:"instance_id,omitempty" env:"INSTANCE_ID"` // The unique identifier of the instance. This is used to identify the instance in the control plane and in the metrics.
	Graph          Graph              `yaml:"graph,omitempty"`
	Telemetry      Telemetry          `yaml:"telemetry,omitempty"` // The configuration for the telemetry. The telemetry is used to collect and export the traces and metrics.
	GraphqlMetrics GraphqlMetrics     `yaml:"graphql_metrics,omitempty"`
	CORS           CORS               `yaml:"cors,omitempty"`
	Cluster        Cluster            `yaml:"cluster,omitempty"`
	Compliance     ComplianceConfig   `yaml:"compliance,omitempty"` // The configuration for the compliance. Includes for example the configuration for the anonymization of the IP addresses.
	TLS            TLSConfiguration   `yaml:"tls,omitempty"`        // The configuration for the TLS. The TLS is used to enable the TLS for the router.
	CacheControl   CacheControlPolicy `yaml:"cache_control_policy"`
	MCP            MCPConfiguration   `yaml:"mcp,omitempty"`                                                                     // The configuration for the Model Context Protocol (MCP) server. MCP allows AI models to interact with your GraphQL APIs. By exposing individual GraphQL operations to the model, you can open your graph to empower AI agents working with your data. See https://cosmo-docs.wundergraph.com/router/mcp for more information.
	DemoMode       bool               `yaml:"demo_mode,omitempty" envDefault:"false" env:"DEMO_MODE" jsonschema:"default=false"` // Launch the router in demo mode. If no execution config is found, the router will start with a demo execution config and deploy a demo federated graph that can be used for testing purposes.

	Modules        map[string]interface{} `yaml:"modules,omitempty"`         // The configuration for the modules. The modules are used to extend the functionality of the router. The modules are specified as a map of module names to module configurations. It needs to match with the name of the module and the configuration of the module. See https://cosmo-docs.wundergraph.com/router/custom-modules for more information.
	Headers        HeaderRules            `yaml:"headers,omitempty"`         // The configuration for the headers. The headers rules are used to modify the headers of the incoming requests and how they are propagated to your subgraphs. See https://cosmo-docs.wundergraph.com/router/proxy-capabilities#forward-http-headers-to-subgraphs for more information.
	TrafficShaping TrafficShapingRules    `yaml:"traffic_shaping,omitempty"` // The configuration for the traffic shaping. Configure rules for traffic shaping like maximum request body size, timeouts, retry behavior, etc. See https://cosmo-docs.wundergraph.com/router/traffic-shaping for more information.
	FileUpload     FileUpload             `yaml:"file_upload,omitempty"`     // The configuration for file upload. Configure whether it should be enabled along with file size and number of files.
	AccessLogs     AccessLogsConfig       `yaml:"access_logs,omitempty"`
	Batching       BatchingConfig         `yaml:"batching,omitempty"`

	ListenAddr                    HostNamePortString          `yaml:"listen_addr" envDefault:"localhost:3002" env:"LISTEN_ADDR" jsonschema:"default=localhost:3002"`                                               // The address on which the router listens for incoming requests. The address is specified as a string with the format 'host:port'.
	ControlplaneURL               HttpUrlString               `yaml:"controlplane_url" envDefault:"https://cosmo-cp.wundergraph.com" env:"CONTROLPLANE_URL" jsonschema:"default=https://cosmo-cp.wundergraph.com"` // The URL of the control plane. The URL is used to register the router on the control-plane. The URL is specified as a string with the format 'scheme://host:port'.
	PlaygroundConfig              PlaygroundConfig            `yaml:"playground,omitempty"`                                                                                                                        // The configuration for the playground. The playground is a web-based GraphQL IDE that allows you to interact with the GraphQL API.
	PlaygroundEnabled             bool                        `yaml:"playground_enabled" envDefault:"true" env:"PLAYGROUND_ENABLED" jsonschema:"default=true"`                                                     // Enable the GraphQL Playground. The GraphQL Playground is a web-based GraphQL IDE that allows you to interact with the GraphQL API. The default value is true. If the value is false, the GraphQL Playground is disabled.
	IntrospectionEnabled          bool                        `yaml:"introspection_enabled" envDefault:"true" env:"INTROSPECTION_ENABLED" jsonschema:"default=true"`                                               // Enable the GraphQL introspection. The GraphQL introspection allows you to query the schema of the GraphQL API. The default value is true. If the value is false, the GraphQL introspection is disabled. In production, it is recommended to disable the introspection.
	QueryPlansEnabled             bool                        `yaml:"query_plans_enabled" envDefault:"true" env:"QUERY_PLANS_ENABLED" jsonschema:"default=true"`                                                   // Query plans can be very useful for debugging and understand the query execution. By default, query plans are enabled, but they are still only accessible if a request is signed (from Cosmo Studio) or in dev mode, which is relatively secure. If you want to disable query plans completely, set this to false.
	LogLevel                      zapcore.Level               `yaml:"log_level" envDefault:"info" env:"LOG_LEVEL" jsonschema:"default=info"`                                                                       // The log level. The log level is used to control the verbosity of the logs. The default value is 'info'.
	JSONLog                       bool                        `yaml:"json_log" envDefault:"true" env:"JSON_LOG" jsonschema:"default=true"`                                                                         // Enable the JSON log format. The JSON log format is used to log the logs in JSON format. The default value is true. If the value is false, the logs are logged a human friendly text format.
	ShutdownDelay                 time.Duration               `yaml:"shutdown_delay" envDefault:"60s" env:"SHUTDOWN_DELAY" jsonschema:"default=60s" jsonschema_extras:"duration_minimum=15s"`                      // The delay before the router shuts down. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	GracePeriod                   time.Duration               `yaml:"grace_period" envDefault:"30s" env:"GRACE_PERIOD" jsonschema:"default=20s"`                                                                   // The grace period before the router shuts down. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	PollInterval                  time.Duration               `yaml:"poll_interval" envDefault:"10s" env:"POLL_INTERVAL" jsonschema:"default=10s" jsonschema_extras:"duration_minimum=5s"`                         // The interval at which the router polls the CDN for updates. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	PollJitter                    time.Duration               `yaml:"poll_jitter" envDefault:"5s" env:"POLL_JITTER" jsonschema:"default=5s"`                                                                       // A duration maximum for jitter added to the polling interval. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	HealthCheckPath               XUriString                  `yaml:"health_check_path" envDefault:"/health" env:"HEALTH_CHECK_PATH" jsonschema:"default=/health"`                                                 // The path of the health check endpoint. The health check endpoint is used to check the health of the router. The default value is '/health'.
	ReadinessCheckPath            XUriString                  `yaml:"readiness_check_path" envDefault:"/health/ready" env:"READINESS_CHECK_PATH" jsonschema:"default=/health/ready"`                               // The path of the readiness check endpoint. The readiness check endpoint is used to check the readiness of the router. The default value is '/health/ready'.
	LivenessCheckPath             XUriString                  `yaml:"liveness_check_path" envDefault:"/health/live" env:"LIVENESS_CHECK_PATH" jsonschema:"default=/health/live"`                                   // The path of the liveness check endpoint. The liveness check endpoint is used to check the liveness of the router. The default value is '/health/live'.
	GraphQLPath                   XUriString                  `yaml:"graphql_path" envDefault:"/graphql" env:"GRAPHQL_PATH" jsonschema:"default=/graphql"`                                                         // The path of the GraphQL endpoint. The GraphQL endpoint is used to send the GraphQL queries, subscriptions and mutations. The default value is '/graphql'.
	PlaygroundPath                XUriString                  `yaml:"playground_path" envDefault:"/" env:"PLAYGROUND_PATH" jsonschema:"default=/"`                                                                 // The path of the GraphQL Playground. The GraphQL Playground is a web-based GraphQL IDE that allows you to interact with the GraphQL API. The default value is '/'.
	Authentication                AuthenticationConfiguration `yaml:"authentication,omitempty"`                                                                                                                    // The configuration for the authentication. The authentication is used to authenticate the incoming requests. We currently support JWK (JSON Web Key) authentication.
	Authorization                 AuthorizationConfiguration  `yaml:"authorization,omitempty"`
	RateLimit                     RateLimitConfiguration      `yaml:"rate_limit,omitempty"`                                                                                                // The configuration for the rate limit. The rate limit is used to limit the number of requests that can be made to the router.
	LocalhostFallbackInsideDocker bool                        `yaml:"localhost_fallback_inside_docker" envDefault:"true" env:"LOCALHOST_FALLBACK_INSIDE_DOCKER" jsonschema:"default=true"` // Enable the localhost fallback inside Docker. The localhost fallback is used to resolve the localhost address when running the router inside a Docker container. This should be only enabled for development and testing.
	CDN                           CDNConfiguration            `yaml:"cdn,omitempty"`                                                                                                       // The configuration for the CDN. The CDN is used to fetch the schema and configurations from the CDN.
	DevelopmentMode               bool                        `yaml:"dev_mode" envDefault:"false" env:"DEV_MODE" jsonschema:"default=false"`                                               // Enable the development mode. The development mode is used to enable the development features like ART (Advanced Request Tracing) and pretty logs.
	Events                        EventsConfiguration         `yaml:"events,omitempty"`                                                                                                    // The configuration for EDFS. See https://cosmo-docs.wundergraph.com/router/event-driven-federated-subscriptions-edfs for more information.
	CacheWarmup                   CacheWarmupConfiguration    `yaml:"cache_warmup,omitempty"`                                                                                              // Cache Warmup pre-warms all caches (e.g. normalization, validation, planning) before accepting traffic.

	RouterConfigPath   FilePathString `yaml:"router_config_path,omitempty" env:"ROUTER_CONFIG_PATH"`                                     // The path of the router execution config file. This file contains the information how your graph is resolved and configured. The path is specified as a string with the format 'path/to/file'.
	RouterRegistration bool           `yaml:"router_registration" env:"ROUTER_REGISTRATION" envDefault:"true" jsonschema:"default=true"` // Enable the router registration. The router registration is used to register the router on the control-plane. The default value is true. This should not be modified unless you know what you are doing.

	OverrideRoutingURL OverrideRoutingURLConfiguration `yaml:"override_routing_url"` // The configuration for the override routing URL. The override routing URL is used to override the routing URL for subgraphs.

	Overrides OverridesConfiguration `yaml:"overrides"` // The configuration to override subgraph config. The config is used to override the config for subgraphs.

	SecurityConfiguration SecurityConfiguration `yaml:"security,omitempty"` // The configuration for the security. The security is used to configure the security settings for the router.

	EngineExecutionConfiguration EngineExecutionConfiguration `yaml:"engine"` // The configuration for the engine. The engine is used to execute the GraphQL queries, mutations and subscriptions. Only modify this if you know what you are doing.

	WebSocket WebSocketConfiguration `yaml:"websocket,omitempty"` // The configuration for the WebSocket transport. The WebSocket transport is used to enable the WebSocket transport for the GraphQL subscriptions.

	SubgraphErrorPropagation SubgraphErrorPropagationConfiguration `yaml:"subgraph_error_propagation" envPrefix:"SUBGRAPH_ERROR_PROPAGATION_"` // The configuration for the subgraph error propagation. The subgraph error propagation is used to propagate the errors from the subgraphs to the client.

	StorageProviders               StorageProviders                `yaml:"storage_providers"`                                      // The configuration for the storage providers. Storage providers can be used to provide access to persisted operations, router execution config and MCP operations.
	ExecutionConfig                ExecutionConfig                 `yaml:"execution_config"`                                       // The configuration for the execution config. You can load the execution config from the local file system or from a storage provider.
	PersistedOperationsConfig      PersistedOperationsConfig       `yaml:"persisted_operations" envPrefix:"PERSISTED_OPERATIONS_"` // The configuration for the persisted operations.
	AutomaticPersistedQueries      AutomaticPersistedQueriesConfig `yaml:"automatic_persisted_queries"`                            // The configuration for the automatic persisted queries (APQ).
	ApolloCompatibilityFlags       ApolloCompatibilityFlags        `yaml:"apollo_compatibility_flags"`                             // To enable full compatibility with Apollo Federation, Apollo Gateway and Apollo Router, you can enable certain compatibility flags, allowing you to use Cosmo Router as a drop-in replacement for Apollo.
	ApolloRouterCompatibilityFlags ApolloRouterCompatibilityFlags  `yaml:"apollo_router_compatibility_flags"`                      // To enable full compatibility with Apollo Router you can enable certain compatibility flags, allowing you to use Cosmo Router as a drop-in replacement for Apollo Router
	ClientHeader                   ClientHeader                    `yaml:"client_header"`                                          // The configuration to set custom client name and version header.

	Plugins PluginsConfiguration `yaml:"plugins" envPrefix:"PLUGINS_"` // The configuration for the router gRPC plugins.

	WatchConfig WatchConfig `yaml:"watch_config" envPrefix:"WATCH_CONFIG_"` // Configuration for watching changes to the router configuration.
}

type PlaygroundConfig struct {
	Enabled          bool       `yaml:"enabled" envDefault:"true" env:"PLAYGROUND_ENABLED" jsonschema:"default=true"`                           // Enable the GraphQL Playground. The GraphQL Playground is a web-based GraphQL IDE that allows you to interact with the GraphQL API. The default value is true. If the value is false, the GraphQL Playground is disabled.
	Path             XUriString `yaml:"path" envDefault:"/" env:"PLAYGROUND_PATH" jsonschema:"default=/"`                                       // The path of the GraphQL Playground. The GraphQL Playground is a web-based GraphQL IDE that allows you to interact with the GraphQL API. The default value is '/'.
	ConcurrencyLimit int        `yaml:"concurrency_limit,omitempty" envDefault:"10" env:"PLAYGROUND_CONCURRENCY_LIMIT" jsonschema:"default=10"` // The concurrency limit for loading the playground. This shouldn't impact normal usage.
}

type WatchConfig struct {
	Enabled      bool                    `yaml:"enabled" envDefault:"false" env:"ENABLED" jsonschema:"default=false"`                                       // Enable watching for configuration changes. This is useful for development and testing.
	Interval     time.Duration           `yaml:"interval" envDefault:"10s" env:"INTERVAL" jsonschema:"default=10s" jsonschema_extras:"duration_minimum=5s"` // The interval at which the config file is checked for changes. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
	StartupDelay WatchConfigStartupDelay `yaml:"startup_delay" envPrefix:"STARTUP_DELAY_"`                                                                  // Configuration for delaying the initial file watcher start.
}

type WatchConfigStartupDelay struct {
	Enabled bool          `yaml:"enabled" envDefault:"false" env:"ENABLED" jsonschema:"default=false"`                                     // Enable startup delay for the configuration watcher. This is useful for preventing race conditions during startup.
	Maximum time.Duration `yaml:"maximum" envDefault:"10s" env:"MAXIMUM" jsonschema:"default=10s" jsonschema_extras:"duration_minimum=5s"` // The maximum time to wait before starting the config file watcher. The period is specified as a string with a number and a unit, e.g. 10ms, 1s, 1m, 1h. The supported units are 'ms', 's', 'm', 'h'.
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
