package jwtauthextension

import (
	"errors"

	"go.opentelemetry.io/collector/component"
)

var errNoJWTSecretProvided = errors.New("no jwt secret provided for the JWT configuration")

// Config has the configuration for the JWT authenticator extension.
type Config struct {
	// Attribute is the header name to read the token from. Optional, default value: "authorization".
	Attribute string `mapstructure:"attribute"`

	// JWTSecret is the HMAC secret used to verify the token signature. Required.
	JWTSecret string `mapstructure:"secret"`
}

var _ component.Config = (*Config)(nil)

// Validate checks that the configuration is usable.
func (c *Config) Validate() error {
	if c.JWTSecret == "" {
		return errNoJWTSecretProvided
	}
	return nil
}
