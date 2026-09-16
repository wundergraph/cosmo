package config

import (
	"testing"

	"github.com/goccy/go-yaml"
	"github.com/stretchr/testify/require"
)

func TestJWTOnErrorYAML(t *testing.T) {
	t.Parallel()
	for _, value := range []string{"reject", "continue", "unknown", `""`, "true", "42", "[]", "{}"} {
		t.Run(value, func(t *testing.T) {
			var cfg JWTAuthenticationConfiguration
			err := yaml.Unmarshal([]byte("on_error: "+value), &cfg)
			if value == "reject" || value == "continue" {
				require.NoError(t, err)
				require.Equal(t, JWTOnError(value), cfg.OnError)
			} else {
				require.ErrorContains(t, err, "authentication.jwt.on_error")
			}
		})
	}
}
