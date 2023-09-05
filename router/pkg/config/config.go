package config

import (
	b64 "encoding/base64"
	"fmt"
	"github.com/go-playground/validator/v10"
	"github.com/goccy/go-yaml"
	"github.com/joho/godotenv"
	"github.com/kelseyhightower/envconfig"
	"os"
)

type Base64Decoder []byte

func (ipd *Base64Decoder) Decode(value string) error {
	decoded, err := b64.StdEncoding.DecodeString(value)
	if err != nil {
		return fmt.Errorf("could not decode base64 string: %w", err)
	}

	*ipd = decoded

	return nil
}

type Config struct {
	Version string `yaml:"version"`

	FederatedGraphName      string            `yaml:"federatedGraphName" envconfig:"FEDERATED_GRAPH_NAME" validate:"required"`
	ControlplaneURL         string            `yaml:"controlplaneURL" validate:"required" default:"https://cosmo-cp.wundergraph.com" envconfig:"CONTROLPLANE_URL" validate:"uri"`
	ListenAddr              string            `yaml:"listenAddr" default:"localhost:3002" envconfig:"LISTEN_ADDR"`
	OTELTracingEnabled      bool              `yaml:"otelTracingEnabled" default:"true" envconfig:"OTEL_TRACING_ENABLED"`
	OTELCollectorEndpoint   string            `yaml:"otelCollectorEndpoint" validate:"required" default:"https://cosmo-otel.wundergraph.com" envconfig:"OTEL_COLLECTOR_ENDPOINT" validate:"uri"`
	OTELCollectorHeaders    map[string]string `yaml:"otelCollectorHeaders" default:"" envconfig:"OTEL_COLLECTOR_HEADERS"`
	OTELSampler             float64           `yaml:"otelSampler" default:"1" envconfig:"OTEL_SAMPLER"`
	OTELBatchTimeoutSeconds int               `yaml:"otelBatchTimeoutSeconds" default:"10" envconfig:"OTEL_BATCH_TIMEOUT_SECONDS"`
	OTELServiceName         string            `yaml:"otelServiceName" default:"cosmo-router" envconfig:"OTEL_SERVICE_NAME"`
	OTELMetricsEnabled      bool              `yaml:"otelMetricsEnabled" default:"true" envconfig:"OTEL_METRICS_ENABLED"`
	PrometheusEnabled       bool              `yaml:"prometheusEnabled" default:"true" envconfig:"PROMETHEUS_ENABLED"`
	PrometheusHttpPath      string            `yaml:"prometheusHttpPath" default:"/metrics" envconfig:"PROMETHEUS_HTTP_PATH"`
	PrometheusHttpAddr      string            `yaml:"prometheusHttpAddr" default:"127.0.0.1:8088" envconfig:"PROMETHEUS_HTTP_ADDR"`
	CORSAllowedOrigins      []string          `yaml:"corsAllowedOrigins" default:"*" envconfig:"CORS_ALLOWED_ORIGINS"`
	CORSAllowedMethods      []string          `yaml:"corsAllowedMethods" default:"HEAD,GET,POST" envconfig:"CORS_ALLOWED_METHODS"`
	CORSAllowCredentials    bool              `yaml:"corsAllowCredentials" default:"true" envconfig:"CORS_ALLOW_CREDENTIALS"`
	CORSAllowedHeaders      []string          `yaml:"corsAllowedHeaders" default:"Origin,Content-Length,Content-Type" envconfig:"CORS_ALLOWED_HEADERS"`
	CORSMaxAgeMinutes       int               `yaml:"corsMaxAgeMinutes" default:"5" envconfig:"CORS_MAX_AGE_MINUTES"`
	PlaygroundEnabled       bool              `yaml:"playgroundEnabled" default:"true" envconfig:"PLAYGROUND_ENABLED"`
	IntrospectionEnabled    bool              `yaml:"introspectionEnabled" default:"true" envconfig:"INTROSPECTION_ENABLED"`
	LogLevel                string            `yaml:"logLevel" default:"info" envconfig:"LOG_LEVEL" validate:"oneof=debug info warning error fatal panic"`
	JSONLog                 bool              `yaml:"jsonLog" default:"true" envconfig:"JSON_LOG"`
	ShutdownDelaySeconds    int               `yaml:"shutdownDelaySeconds" default:"15" envconfig:"SHUTDOWN_DELAY_SECONDS"`
	GracePeriodSeconds      int               `yaml:"gracePeriodSeconds" default:"0" envconfig:"GRACE_PERIOD_SECONDS"`
	PollIntervalSeconds     int               `yaml:"pollIntervalSeconds" default:"10" envconfig:"POLL_INTERVAL_SECONDS"`
	GraphApiToken           string            `yaml:"graphApiToken" envconfig:"GRAPH_API_TOKEN" validate:"required"`
	ConfigFilePath          string            `yaml:"configFilePath" default:"" envconfig:"CONFIG_FILE_PATH" validate:"omitempty,filepath"`

	Modules map[string]interface{} `yaml:"modules"`
}

func LoadConfig() (*Config, error) {
	godotenv.Load(".env.local")
	godotenv.Load()

	var c Config

	configBytes, err := os.ReadFile("config.yaml")

	if err == nil {
		if err := yaml.Unmarshal(configBytes, &c); err != nil {
			return nil, fmt.Errorf("failed to unmarshal router config: %w", err)
		}
	}

	err = envconfig.Process("", &c)
	if err != nil {
		return nil, err
	}

	err = validator.New().Struct(c)
	if err != nil {
		return nil, err
	}

	return &c, nil
}
