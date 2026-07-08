package integration

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestWebSocketOverTLS(t *testing.T) {
	t.Parallel()

	tlsConfig := config.TLSConfiguration{
		Server: config.TLSServerConfiguration{
			Enabled:  true,
			CertFile: "../testdata/tls/cert.pem",
			KeyFile:  "../testdata/tls/key.pem",
		},
	}

	t.Run("delivers subscription data over a wss connection", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: tlsConfig,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			require.Contains(t, xEnv.RouterURL, "https://")

			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"{ employees { id } }"}`),
			})
			require.NoError(t, err)

			var res testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &res)
			require.NoError(t, err)
			require.Equal(t, "next", res.Type)
			require.Equal(t, "1", res.ID)
			require.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, string(res.Payload))

			var complete testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &complete)
			require.NoError(t, err)
			require.Equal(t, "complete", complete.Type)
			require.Equal(t, "1", complete.ID)

			xEnv.WaitForSubscriptionCount(0, time.Second*5)
		})
	})
}
