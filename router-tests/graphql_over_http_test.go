package integration

import (
	"bytes"
	"compress/gzip"
	"compress/zlib"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestGraphQLOverHTTPCompatibility(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		t.Run("valid request should return 200 OK with valid response", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}}}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, res.Header.Get("Content-Type"), "application/json; charset=utf-8")
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, string(data))
		})
		t.Run("valid request with Operation Name null should return 200 OK with valid response", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"operationName": null,"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}}}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, res.Header.Get("Content-Type"), "application/json; charset=utf-8")
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, string(data))
		})
		t.Run("return 400 bad request when variables is not a map", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":true}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.StatusCode)
			require.Equal(t, res.Header.Get("Content-Type"), "application/json; charset=utf-8")
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"error parsing request body"}]}`, string(data))
		})
		t.Run("return 400 bad request when extensions is not a map", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","extensions":true}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.StatusCode)
			require.Equal(t, res.Header.Get("Content-Type"), "application/json; charset=utf-8")
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"error parsing request body"}]}`, string(data))
		})
		t.Run("valid request with Operation Name should return 200 OK with valid response", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}},"operationName":"Find"}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, string(data))
		})
		t.Run("malformed JSON should return 400", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}}}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.StatusCode)
			require.Equal(t, res.Header.Get("Content-Type"), "application/json; charset=utf-8")
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"error parsing request body"}]}`, string(data))
		})
		t.Run("malformed JSON variant should return 400", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{{"query":query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}}}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.StatusCode)
			require.Equal(t, res.Header.Get("Content-Type"), "application/json; charset=utf-8")
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"error parsing request body"}]}`, string(data))
		})
		t.Run("malformed JSON variant #2 should return 400", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.StatusCode)
			require.Equal(t, res.Header.Get("Content-Type"), "application/json; charset=utf-8")
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"error parsing request body"}]}`, string(data))
		})
		t.Run("malformed JSON variables variant should return 400", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":GERMAN}}}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.StatusCode)
			require.Equal(t, res.Header.Get("Content-Type"), "application/json; charset=utf-8")
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"error parsing request body"}]}`, string(data))
		})
		t.Run("missing variables should return 200 OK with validation errors response", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}"}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, res.Header.Get("Content-Type"), "application/json; charset=utf-8")
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Variable \"$criteria\" of required type \"SearchInput!\" was not provided."}]}`, string(data))
		})
		t.Run("mismatching variables although valid JSON should not be 400", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"whatever":123}}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, res.Header.Get("Content-Type"), "application/json; charset=utf-8")
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Variable \"$criteria\" of required type \"SearchInput!\" was not provided."}]}`, string(data))
		})
		t.Run("variables null should be 200 ok with validation error", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":null}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, res.Header.Get("Content-Type"), "application/json; charset=utf-8")
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Variable \"$criteria\" of required type \"SearchInput!\" was not provided."}]}`, string(data))
		})
		t.Run("variables null with space should be 200 ok with validation error", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":  null }`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, res.Header.Get("Content-Type"), "application/json; charset=utf-8")
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Variable \"$criteria\" of required type \"SearchInput!\" was not provided."}]}`, string(data))
		})
		t.Run("request with spaces and tabs should be 200 ok", func(t *testing.T) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}
			body := []byte("{\n\"query\":\"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}\"\n,\t\"variables\"\n\t:\n\t{\"criteria\":\n\t{\"nationality\"\n\t:\n\t\"GERMAN\"}}\n}")
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, res.Header.Get("Content-Type"), "application/json; charset=utf-8")
			data, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, string(data))
		})
		t.Run("request with long header should return 431 response", func(t *testing.T) {
			header := http.Header{}

			// the limit actually behaves a bit weird in the http library. It's not exactly 1<<20 (1MiB)
			// It also has some threshold added, and when running all tests at the same time the limit goes even higher.
			// I couldn't figure out why, so I just go way beyond the limit to make sure it fails.
			header.Add("X-Long-Header", strings.Repeat("abc", http.DefaultMaxHeaderBytes)) // 3MB

			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}},"operationName":"Find"}`)
			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusRequestHeaderFieldsTooLarge, res.StatusCode)
		})
	})

	t.Run("request with long header and updated max size should return 200 response", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithRouterTrafficConfig(&config.RouterTrafficConfiguration{
					MaxHeaderBytes:      4 << 20, // 4MiB
					MaxRequestBodyBytes: 5 << 20, // 5MiB
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := http.Header{
				"Content-Type": []string{"application/json"},
				"Accept":       []string{"application/json"},
			}

			header.Add("X-Long-Header", strings.Repeat("abc", http.DefaultMaxHeaderBytes)) // 3MB

			body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}},"operationName":"Find"}`)

			res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
		})
	})

	t.Run("requests with compression", func(t *testing.T) {
		t.Parallel()

		t.Run("valid request with Content-Encoding header and compressed payload should return 200 OK with valid response", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithRouterTrafficConfig(&config.RouterTrafficConfiguration{
						MaxRequestBodyBytes:  5 << 20, // 5MiB
						DecompressionEnabled: true,
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := http.Header{
					"Content-Type":     []string{"application/json"},
					"Accept":           []string{"application/json"},
					"Content-Encoding": []string{"gzip"},
				}

				body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}},"operationName":"Find"}`)

				var builder strings.Builder
				gzBody := gzip.NewWriter(&builder)
				defer func() {}()

				_, err := gzBody.Write(body)
				require.NoError(t, err)
				require.NoError(t, gzBody.Close())

				res, err := xEnv.MakeRequest("POST", "/graphql", header, strings.NewReader(builder.String()))
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.StatusCode)
				require.Equal(t, res.Header.Get("Content-Type"), "application/json; charset=utf-8")
				b, err := io.ReadAll(res.Body)
				require.NoError(t, err)

				require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, string(b))
			})
		})

		t.Run("valid request with deflate Content-Encoding header and compression should not be supported", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithRouterTrafficConfig(&config.RouterTrafficConfiguration{
						MaxRequestBodyBytes:  5 << 20, // 5MiB
						DecompressionEnabled: true,
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := http.Header{
					"Content-Type":     []string{"application/json"},
					"Accept":           []string{"application/json"},
					"Content-Encoding": []string{"deflate"},
				}

				body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}},"operationName":"Find"}`)

				var builder strings.Builder
				w := zlib.NewWriter(&builder)
				_, err := w.Write(body)
				require.NoError(t, err)
				require.NoError(t, w.Close())

				res, err := xEnv.MakeRequest("POST", "/graphql", header, strings.NewReader(builder.String()))
				require.NoError(t, err)
				require.Equal(t, http.StatusUnsupportedMediaType, res.StatusCode)
				b, err := io.ReadAll(res.Body)
				require.NoError(t, err)
				require.Contains(t, string(b), "unsupported media type")

			})
		})

		t.Run("request that specifies Content-Encoding without compressed payload should return status 422", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithRouterTrafficConfig(&config.RouterTrafficConfiguration{
						MaxRequestBodyBytes:  5 << 20, // 5MiB
						DecompressionEnabled: true,
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := http.Header{
					"Content-Type":     []string{"application/json"},
					"Accept":           []string{"application/json"},
					"Content-Encoding": []string{"gzip"},
				}

				body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}},"operationName":"Find"}`)

				res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
				require.NoError(t, err)
				require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
				b, err := io.ReadAll(res.Body)
				require.NoError(t, err)

				require.Contains(t, string(b), "invalid gzip payload")
			})
		})

		t.Run("valid mutation request with compression should return 200 OK with valid response", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithRouterTrafficConfig(&config.RouterTrafficConfiguration{
						MaxRequestBodyBytes:  5 << 20, // 5MiB
						DecompressionEnabled: true,
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := http.Header{
					"Content-Type":     []string{"application/json"},
					"Accept":           []string{"application/json"},
					"Content-Encoding": []string{"gzip"},
				}

				body := []byte(`{"query": "mutation { updateEmployeeTag(id: 1, tag: \"test\") { id tag } }"}`)

				var builder strings.Builder
				gzBody := gzip.NewWriter(&builder)
				defer func() {}()

				_, err := gzBody.Write(body)
				require.NoError(t, err)
				require.NoError(t, gzBody.Close())

				res, err := xEnv.MakeRequest("POST", "/graphql", header, strings.NewReader(builder.String()))
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.StatusCode)
				require.Equal(t, res.Header.Get("Content-Type"), "application/json; charset=utf-8")
				b, err := io.ReadAll(res.Body)
				require.NoError(t, err)

				require.Equal(t, `{"data":{"updateEmployeeTag":{"id":1,"tag":"test"}}}`, string(b))
			})
		})
	})

	t.Run("requests with custom Path", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			OverrideGraphQLPath: "/custom-graphql",
		}, func(t *testing.T, xEnv *testenv.Environment) {
			t.Run("valid request should return 200 with custom path", func(t *testing.T) {
				t.Parallel()
				header := http.Header{
					"Content-Type": []string{"application/json"},
					"Accept":       []string{"application/json"},
				}
				body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}}}`)
				res, err := xEnv.MakeRequest("POST", "/custom-graphql", header, bytes.NewReader(body))
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.StatusCode)
				data, err := io.ReadAll(res.Body)
				require.NoError(t, err)
				require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, string(data))
			})

			t.Run("valid request should return 404 with custom path", func(t *testing.T) {
				t.Parallel()
				header := http.Header{
					"Content-Type": []string{"application/json"},
					"Accept":       []string{"application/json"},
				}
				body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}}}`)
				res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
				require.NoError(t, err)
				require.Equal(t, http.StatusNotFound, res.StatusCode)
			})

		})

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithGraphQLPath("/*"),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			t.Run("valid request should return status 200 when wildcard was defined for path", func(t *testing.T) {
				t.Parallel()

				header := http.Header{
					"Content-Type": []string{"application/json"},
					"Accept":       []string{"application/json"},
				}

				body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}}}`)
				res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.StatusCode)
				data, err := io.ReadAll(res.Body)
				require.NoError(t, err)
				require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, string(data))
			})
		})

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithGraphQLPath("/"),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			t.Run("valid request should return status 404 when no wildcard was defined on root path", func(t *testing.T) {
				t.Parallel()

				header := http.Header{
					"Content-Type": []string{"application/json"},
					"Accept":       []string{"application/json"},
				}

				body := []byte(`{"query":"query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}","variables":{"criteria":{"nationality":"GERMAN"}}}`)
				res, err := xEnv.MakeRequest("POST", "/graphql", header, bytes.NewReader(body))
				require.NoError(t, err)
				require.Equal(t, http.StatusNotFound, res.StatusCode)
			})
		})
	})
}
