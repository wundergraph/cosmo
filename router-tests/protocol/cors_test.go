package integration

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/cors"
)

func TestCors(t *testing.T) {
	t.Parallel()

	t.Run("allow all origins allows requests", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.WebSocketServerReadTimeout = time.Millisecond * 10
			},
			RouterOptions: []core.Option{
				core.WithCors(&cors.Config{
					Enabled:         true,
					AllowAllOrigins: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:      `query { initialPayload }`,
				Extensions: []byte(`{"token":"123"}`),
			}, map[string]string{
				"Origin": "http://example.org",
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"initialPayload":{"extensions":{"token":"123"},"query":"{initialPayload}"}}}`, res.Body)
		})
	})

	t.Run("disallowing origins blocks requests", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCors(&cors.Config{
					Enabled:      true,
					AllowOrigins: []string{"http://example.com"},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:      `query { initialPayload }`,
				Extensions: []byte(`{"token":"123"}`),
			}, map[string]string{
				"Origin": "http://not-example.com",
			})
			require.NoError(t, err)
			require.Equal(t, "", res.Body)
			require.Equal(t, http.StatusForbidden, res.Response.StatusCode)
		})
	})

	t.Run("matching origins succeeds requests", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithCors(&cors.Config{
					Enabled:      true,
					AllowOrigins: []string{"http://example.com"},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:      `query { initialPayload }`,
				Extensions: []byte(`{"token":"123"}`),
			}, map[string]string{
				"Origin": "http://example.com",
			})
			require.NoError(t, err)
			require.Equal(t, `{"data":{"initialPayload":{"extensions":{"token":"123"},"query":"{initialPayload}"}}}`, res.Body)
		})
	})

	t.Run("wildcard matching", func(t *testing.T) {
		t.Parallel()
		t.Run("matching single wildcard succeeds", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCors(&cors.Config{
						Enabled:      true,
						AllowOrigins: []string{"http://example.com/*"},
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
					Query:      `query { initialPayload }`,
					Extensions: []byte(`{"token":"123"}`),
				}, map[string]string{
					"Origin": "http://example.com/test",
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"initialPayload":{"extensions":{"token":"123"},"query":"{initialPayload}"}}}`, res.Body)
			})
		})

		t.Run("matching multiple wildcard succeeds", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCors(&cors.Config{
						Enabled:      true,
						AllowOrigins: []string{"http://*example.com:*"},
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
					Query:      `query { initialPayload }`,
					Extensions: []byte(`{"token":"123"}`),
				}, map[string]string{
					"Origin": "http://matching.double.example.com:123/super-scary-extension",
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"initialPayload":{"extensions":{"token":"123"},"query":"{initialPayload}"}}}`, res.Body)
			})
		})

		t.Run("matching multiple complex wildcards succeeds", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCors(&cors.Config{
						Enabled:      true,
						AllowOrigins: []string{"http://*example.com:*"},
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
					Query:      `query { initialPayload }`,
					Extensions: []byte(`{"token":"123"}`),
				}, map[string]string{
					"Origin": "http://matching.double.example.com:123/super-scary-extension",
				})
				require.NoError(t, err)
				require.Equal(t, `{"data":{"initialPayload":{"extensions":{"token":"123"},"query":"{initialPayload}"}}}`, res.Body)
			})
		})

		t.Run("matching multiple wildcard fails", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithCors(&cors.Config{
						Enabled:      true,
						AllowOrigins: []string{"http://*example.com:*"},
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
					Query:      `query { initialPayload }`,
					Extensions: []byte(`{"token":"123"}`),
				}, map[string]string{
					"Origin": "http://not-matching.double.example.co:123/super-scary-extension",
				})
				require.NoError(t, err)
				require.Equal(t, "", res.Body)
				require.Equal(t, http.StatusForbidden, res.Response.StatusCode)
			})
		})
	})
}
