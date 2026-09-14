package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/pkg/cors"
)

func TestCORSInvalidMatchOriginsFailsStartup(t *testing.T) {
	t.Parallel()

	for _, enabled := range []bool{true, false} {
		cfg := cors.Config{
			Enabled:      enabled,
			AllowOrigins: []string{"*"},
			MatchOrigins: []string{"https://["},
		}
		_, err := NewRouter(t.Context(), WithCors(&cfg))
		if enabled {
			assert.ErrorContains(t, err, "invalid CORS configuration")
			assert.ErrorContains(t, err, `match_origins "https://["`)
		} else {
			assert.NoError(t, err)
		}
	}
}
