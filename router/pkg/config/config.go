package config

import (
	b64 "encoding/base64"
	"fmt"

	"github.com/go-playground/validator/v10"
	"github.com/joho/godotenv"
	"github.com/kelseyhightower/envconfig"
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
	FederatedGraphName      string            `envconfig:"FEDERATED_GRAPH_NAME" validate:"required"`
	ControlplaneURL         string            `validate:"required" default:"https://cosmo-cp.wundergraph.com" envconfig:"CONTROLPLANE_URL" validate:"uri"`
	ListenAddr              string            `default:"localhost:3002" envconfig:"LISTEN_ADDR"`
	OTELTracingEnabled      bool              `default:"true" envconfig:"OTEL_TRACING_ENABLED"`
	OTELCollectorEndpoint   string            `validate:"required" default:"https://cosmo-otel.wundergraph.com" envconfig:"OTEL_COLLECTOR_ENDPOINT" validate:"uri"`
	OTELCollectorHeaders    map[string]string `default:"" envconfig:"OTEL_COLLECTOR_HEADERS"`
	OTELSampler             float64           `default:"1" envconfig:"OTEL_SAMPLER"`
	OTELBatchTimeoutSeconds int               `default:"10" envconfig:"OTEL_BATCH_TIMEOUT_SECONDS"`
	OTELServiceName         string            `default:"cosmo-router" envconfig:"OTEL_SERVICE_NAME"`
	OTELMetricsEnabled      bool              `default:"true" envconfig:"OTEL_METRICS_ENABLED"`
	PrometheusEnabled       bool              `default:"true" envconfig:"PROMETHEUS_ENABLED"`
	PrometheusHttpPath      string            `default:"/metrics" envconfig:"PROMETHEUS_HTTP_PATH"`
	PrometheusHttpAddr      string            `default:"127.0.0.1:8088" envconfig:"PROMETHEUS_HTTP_ADDR"`
	CORSAllowedOrigins      []string          `default:"*" envconfig:"CORS_ALLOWED_ORIGINS"`
	CORSAllowedMethods      []string          `default:"HEAD,GET,POST" envconfig:"CORS_ALLOWED_METHODS"`
	CORSAllowCredentials    bool              `default:"true" envconfig:"CORS_ALLOW_CREDENTIALS"`
	CORSAllowedHeaders      []string          `default:"Origin,Content-Length,Content-Type" envconfig:"CORS_ALLOWED_HEADERS"`
	CORSMaxAgeMinutes       int               `default:"5" envconfig:"CORS_MAX_AGE_MINUTES"`
	PlaygroundEnabled       bool              `default:"true" envconfig:"PLAYGROUND_ENABLED"`
	IntrospectionEnabled    bool              `default:"true" envconfig:"INTROSPECTION_ENABLED"`
	LogLevel                string            `default:"info" envconfig:"LOG_LEVEL" validate:"oneof=debug info warning error fatal panic"`
	JSONLog                 bool              `default:"true" envconfig:"JSON_LOG"`
	ShutdownDelaySeconds    int               `default:"15" envconfig:"SHUTDOWN_DELAY_SECONDS"`
	GracePeriodSeconds      int               `default:"0" envconfig:"GRACE_PERIOD_SECONDS"`
	PollIntervalSeconds     int               `default:"10" envconfig:"POLL_INTERVAL_SECONDS"`
	GraphApiToken           string            `envconfig:"GRAPH_API_TOKEN" validate:"required"`
	ConfigFilePath          string            `default:"" envconfig:"CONFIG_FILE_PATH" validate:"omitempty,filepath"`
}

func LoadConfig() (*Config, error) {
	godotenv.Load(".env.local")
	godotenv.Load()

	var c Config
	err := envconfig.Process("", &c)
	if err != nil {
		return nil, err
	}

	err = validator.New().Struct(c)
	if err != nil {
		return nil, err
	}

	return &c, nil
}
