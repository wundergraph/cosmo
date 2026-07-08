package main

import (
	"errors"
	"io/fs"
	"net/url"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

type Config struct {
	ListenAddr string `env:"LISTEN_ADDR" envDefault:":4041"`
	JWTSecret  string `env:"JWT_SECRET,notEmpty"`

	// LogFormat selects the log output: "text" (tint, human-readable) or "json".
	LogFormat string `env:"LOG_FORMAT" envDefault:"text"`

	UpstreamURL      url.URL `env:"UPSTREAM_URL,notEmpty"`
	UpstreamUser     string  `env:"UPSTREAM_USER"`
	UpstreamPassword string  `env:"UPSTREAM_PASSWORD"`

	// TenantFromOrgID maps the token's organization_id to the X-Scope-OrgID
	// header for multi-tenant Pyroscope setups.
	TenantFromOrgID bool `env:"TENANT_FROM_ORG_ID" envDefault:"false"`
}

func loadConfig() (Config, error) {
	if err := godotenv.Load(); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return Config{}, err
	}
	return env.ParseAs[Config]()
}
