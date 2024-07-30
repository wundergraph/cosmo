package config

import (
	b64 "encoding/base64"
	"fmt"
	"time"

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
	ListenAddr      string        `default:"localhost:4005" validate:"hostname_port" envconfig:"LISTEN_ADDR"`
	LogLevel        string        `default:"info" envconfig:"LOG_LEVEL" validate:"oneof=debug info warning error fatal panic"`
	IngestJWTSecret string        `envconfig:"INGEST_JWT_SECRET" validate:"required"`
	ClickHouseDSN   string        `envconfig:"CLICKHOUSE_DSN" validate:"required,url"`
	JSONLog         bool          `default:"true" envconfig:"JSON_LOG"`
	ShutdownDelay   time.Duration `default:"30s" validate:"required,min=5s" envconfig:"SHUTDOWN_DELAY"`

	IsPrometheusEnabled  bool   `default:"false" envconfig:"PROMETHEUS_ENABLED"`
	PrometheusListenAddr string `default:"127.0.0.1:8088" envconfig:"PROMETHEUS_LISTEN_ADDR"`
	PrometheusPath       string `default:"/metrics" envconfig:"PROMETHEUS_PATH"`
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
