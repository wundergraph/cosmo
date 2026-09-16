package config

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestJWTOnErrorConfig(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name, yaml string
		want       JWTOnError
	}{
		{name: "default", want: JWTOnErrorReject},
		{name: "reject", yaml: "on_error: reject", want: JWTOnErrorReject},
		{name: "continue", yaml: "on_error: continue", want: JWTOnErrorContinue},
		{name: "unknown", yaml: "on_error: unknown"},
		{name: "empty", yaml: `on_error: ""`},
		{name: "boolean", yaml: "on_error: true"},
		{name: "number", yaml: "on_error: 42"},
		{name: "array", yaml: "on_error: []"},
		{name: "object", yaml: "on_error: {}"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			path := createTempFileFromFixture(t, fmt.Sprintf(`
version: "1"
router_config_path: config.json
authentication:
  jwt:
    header_name: Authorization
    %s
`, tt.yaml))
			result, err := LoadConfig([]string{path})
			if tt.want == "" {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tt.want, result.Config.Authentication.JWT.OnError)
		})
	}
}
