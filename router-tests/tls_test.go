package integration

import (
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"io"
	"net/http"
	"testing"
)

const employeesIDData = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`

func TestTLS(t *testing.T) {

	t.Parallel()

	t.Run("TestTLSPlayground", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			TLSConfig: &core.TlsConfig{
				Enabled:  true,
				CertFile: "testdata/tls/cert.pem",
				KeyFile:  "testdata/tls/key.pem",
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeRequest(http.MethodGet, "/", http.Header{
				"Accept": []string{"text/html"},
			}, nil)
			require.NoError(t, err)
			defer res.Body.Close()

			require.Contains(t, res.Header.Get("Content-Type"), "text/html")
			body, err := io.ReadAll(res.Body)
			require.NoError(t, err)

			require.Contains(t, string(body), `WunderGraph Playground`)
		})
	})

	t.Run("TestTLSQuery", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			TLSConfig: &core.TlsConfig{
				Enabled:  true,
				CertFile: "testdata/tls/cert.pem",
				KeyFile:  "testdata/tls/key.pem",
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)
		})
	})
}
