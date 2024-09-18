package config

import (
	"time"

	"github.com/go-playground/validator/v10"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

type Config struct {
	ListenAddr      string        `envDefault:"localhost:4005" validate:"hostname_port" env:"LISTEN_ADDR"`
	LogLevel        string        `envDefault:"info" env:"LOG_LEVEL" validate:"oneof=debug info warning error fatal panic"`
	IngestJWTSecret string        `env:"INGEST_JWT_SECRET" validate:"required"`
	ClickHouseDSN   string        `env:"CLICKHOUSE_DSN" validate:"required,url"`
	JSONLog         bool          `envDefault:"true" env:"JSON_LOG"`
	ShutdownDelay   time.Duration `default:"30s" envDefault:"5s" validate:"required,min=5s" env:"SHUTDOWN_DELAY"`

	IsPrometheusEnabled  bool   `envDefault:"false" env:"PROMETHEUS_ENABLED"`
	PrometheusListenAddr string `envDefault:"127.0.0.1:8088" env:"PROMETHEUS_LISTEN_ADDR"`
	PrometheusPath       string `envDefault:"/metrics" env:"PROMETHEUS_PATH"`
}

func LoadConfig() (*Config, error) {
	godotenv.Load(".env.local")
	godotenv.Load()

	var c Config

	err := env.Parse(&c)
	if err != nil {
		return nil, err
	}

	err = validator.New().Struct(c)
	if err != nil {
		return nil, err
	}

	return &c, nil
}
