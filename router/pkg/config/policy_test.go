package config

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPolicyConfiguration(t *testing.T) {
	for _, tt := range []struct {
		name   string
		policy string
		valid  bool
	}{
		{
			name:   "module",
			policy: "source: module",
			valid:  true,
		},
		{
			name:   "unknown source",
			policy: "source: unknown",
		},
		{
			name:   "missing source",
			policy: "{}",
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			path := createTempFileFromFixture(t, fmt.Sprintf(`
version: "1"
router_config_path: config.json
authorization:
  policies:
    %s
`, tt.policy))
			_, err := LoadConfig([]string{path})
			if tt.valid {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
}
