package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/buger/jsonparser"
	"github.com/sebdah/goldie/v2"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

const employeesIDData = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`

func normalizeJSON(tb testing.TB, data []byte) []byte {
	buf := new(bytes.Buffer)
	err := json.Indent(buf, data, "", "  ")
	require.NoError(tb, err)
	return buf.Bytes()
}

func TestSimpleQuery(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `query { employees { id } }`,
		})
		require.Equal(t, res.Response.Header.Get("Content-Type"), "application/json; charset=utf-8")
		require.JSONEq(t, employeesIDData, res.Body)
	})
}

func TestConfigReload(t *testing.T) {
	t.Parallel()

	createConfigurationFile := func(t *testing.T, input string, fileName string, directoryPath string) {
		f, err := os.Create(filepath.Join(directoryPath, fileName))
		require.NoError(t, err)

		_, err = f.WriteString(input)
		require.NoError(t, err)

		err = f.Close()
		require.NoError(t, err)
	}

	t.Run("Successfully reloads to a valid new configuration file with SIGHUP", func(t *testing.T) {
		// Can be very slow, compiles the router binary if needed
		err := testenv.RunRouterBinary(t, &testenv.Config{
			DemoMode: true,
		}, testenv.RunRouterBinConfigOptions{}, func(t *testing.T, xEnv *testenv.Environment) {
			t.Logf("running router binary, cwd: %s", xEnv.GetRouterProcessCwd())

			ctx := context.Background()

			require.NoError(t, xEnv.WaitForServer(ctx, xEnv.RouterURL+"/health/ready", 600, 60), "healthcheck pre-reload failed")

			f, err := os.Create(filepath.Join(xEnv.GetRouterProcessCwd(), "config.yaml"))
			require.NoError(t, err)

			_, err = f.WriteString(`
version: "1"

readiness_check_path: "/after"
`)
			require.NoError(t, err)

			require.NoError(t, f.Close())

			err = xEnv.SignalRouterProcess(syscall.SIGHUP)
			require.NoError(t, err)

			require.NoError(t, xEnv.WaitForServer(ctx, xEnv.RouterURL+"/after", 600, 60), "healthcheck post-reload failed")
		})

		require.NoError(t, err)
	})

	t.Run("Falls back to initial configuration if new configuration file is invalid", func(t *testing.T) {
		// Can be very slow, compiles the router binary if needed
		err := testenv.RunRouterBinary(t, &testenv.Config{
			DemoMode: true,
		}, testenv.RunRouterBinConfigOptions{}, func(t *testing.T, xEnv *testenv.Environment) {
			t.Logf("running router binary, cwd: %s", xEnv.GetRouterProcessCwd())

			ctx := context.Background()

			require.NoError(t, xEnv.WaitForServer(ctx, xEnv.RouterURL+"/health/ready", 600, 60), "healthcheck pre-reload failed")

			f, err := os.Create(filepath.Join(xEnv.GetRouterProcessCwd(), "config.yaml"))
			require.NoError(t, err)

			_, err = f.WriteString(`
asdasdasdasdas: "NOT WORKING CONFIG!!!"
`)
			require.NoError(t, err)

			require.NoError(t, f.Close())

			err = xEnv.SignalRouterProcess(syscall.SIGHUP)
			require.NoError(t, err)

			require.NoError(t, xEnv.WaitForServer(ctx, xEnv.RouterURL+"/health/ready", 600, 60), "healthcheck post-reload failed")
		})

		require.NoError(t, err)
	})

	t.Run("Successfully reloads multiple configuration files with SIGHUP", func(t *testing.T) {
		file1 := "demo1.config.yaml"
		file2 := "demo2.config.yaml"
		file3 := "demo2.config.yaml"
		files := []string{file1, file2, file3}

		opts := testenv.RunRouterBinConfigOptions{
			ConfigOverridePath:       strings.Join(files, ","),
			AssertOnRouterBinaryLogs: true,
			OverrideDirectory:        t.TempDir(),
		}

		for _, file := range files {
			createConfigurationFile(t, `version: "1"`, file, opts.OverrideDirectory)
		}

		err := testenv.RunRouterBinary(t, &testenv.Config{
			DemoMode: true,
		}, opts, func(t *testing.T, xEnv *testenv.Environment) {
			t.Logf("running router binary, cwd: %s", xEnv.GetRouterProcessCwd())

			ctx := context.Background()

			// Force a restart on the router using sighup
			err := xEnv.SignalRouterProcess(syscall.SIGHUP)
			require.NoError(t, err)

			require.True(t, xEnv.IsLogReceivedFromOutput(ctx, `"msg":"Reloading Router"`, 10*time.Second))
		})

		require.NoError(t, err)
	})

	t.Run("Successfully reload multiple configuration files with watch configuration", func(t *testing.T) {
		file1 := "demo1.config.yaml"
		file2 := "demo2.config.yaml"
		file3 := "demo2.config.yaml"
		files := []string{file1, file2, file3}

		opts := testenv.RunRouterBinConfigOptions{
			ConfigOverridePath:       strings.Join(files, ","),
			AssertOnRouterBinaryLogs: true,
			OverrideDirectory:        t.TempDir(),
		}

		for _, file := range files {
			input := `version: "1"`

			// Have the second file have the watch config
			if file == file2 {
				input = `version: "1"
watch_config:
  enabled: true
  interval: "5s"
`
			}
			createConfigurationFile(t, input, file, opts.OverrideDirectory)
		}

		err := testenv.RunRouterBinary(t, &testenv.Config{
			DemoMode: true,
		}, opts, func(t *testing.T, xEnv *testenv.Environment) {
			t.Logf("running router binary, cwd: %s", xEnv.GetRouterProcessCwd())

			ctx := context.Background()

			// Create will update the same file if it exists
			createConfigurationFile(t, `version: "1"
watch_config:
  enabled: true
  interval: "10s"
			`, file2, opts.OverrideDirectory)

			require.True(t, xEnv.IsLogReceivedFromOutput(ctx, `"msg":"Reloading Router"`, 10*time.Second))
		})

		require.NoError(t, err)
	})

}

func TestNoSubgraphConfigWithoutDemoMode(t *testing.T) {
	t.Parallel()

	err := testenv.RunRouterBinary(t, &testenv.Config{
		DemoMode:      false,
		NoRetryClient: true,
	}, testenv.RunRouterBinConfigOptions{}, func(t *testing.T, xEnv *testenv.Environment) {
		require.Fail(t, "Router should not start without execution config")
	})
	require.Error(t, err)
}

func TestNoSubgraphConfigWithDemoMode(t *testing.T) {
	t.Parallel()

	err := testenv.RunRouterBinary(t, &testenv.Config{
		DemoMode:      true,
		NoRetryClient: true,
	}, testenv.RunRouterBinConfigOptions{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `query { hello }`,
		})
		require.JSONEq(t, `{"data":{"hello":"Cosmo Router is ready! Follow this guide to deploy your first Supergraph: https://cosmo-docs.wundergraph.com/tutorial/from-zero-to-federation-in-5-steps-using-cosmo"}}`, res.Body)
	})
	require.NoError(t, err)
}

func TestContentTypes(t *testing.T) {
	t.Parallel()

	type contentType struct {
		ContentType string
	}

	var contentTypes = []contentType{
		{""},
		{"application/json"},
		{"application/JSON"},
		{"application/json; charset=utf-8"},
		{"application/json; charset=UTF-8"},
		{"application/json; charset=UTF-8;"},
	}

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		for _, ct := range contentTypes {
			res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", http.Header{
				"Content-Type": []string{ct.ContentType},
			}, bytes.NewReader([]byte(`{"query":"{ employees { id } }"}`)))
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.Equal(t, res.Header.Get("Content-Type"), "application/json; charset=utf-8")

			body, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.JSONEq(t, employeesIDData, string(body))

		}
	})
}

func TestPlayground(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
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
}

func TestExecutionPlanCache(t *testing.T) {
	t.Parallel()

	t.Run("enabled variables remapping", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			// MISS - First query
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`{"criteria":{"nationality":"GERMAN"}}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, "MISS", res.Response.Header.Get("X-WG-Execution-Plan-Cache"))
			require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res.Body)

			// MISS - Same query as above with different variables nullability
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`{"criteria":{"nationality":"GERMAN"}}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, "MISS", res.Response.Header.Get("X-WG-Execution-Plan-Cache"))
			require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res.Body)

			// HIT - Same query as above with different variables values
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`{"criteria":{"nationality":"AMERICAN"}}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, "HIT", res.Response.Header.Get("X-WG-Execution-Plan-Cache"))
			require.Equal(t, `{"data":{"findEmployees":[{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}]}}`, res.Body)

			// HIT - Same query as above with different variable name
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteriaDifferent: SearchInput) {findEmployees(criteria: $criteriaDifferent){id details {forename surname}}}`,
				Variables: json.RawMessage(`{"criteriaDifferent":{"nationality":"AMERICAN"}}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, "HIT", res.Response.Header.Get("X-WG-Execution-Plan-Cache"))
			require.Equal(t, `{"data":{"findEmployees":[{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}]}}`, res.Body)

			// HIT - Same query as above with variables default value
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query Find($criteria: SearchInput! = { nationality: ENGLISH }) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, "HIT", res.Response.Header.Get("X-WG-Execution-Plan-Cache"))
			require.Equal(t, `{"data":{"findEmployees":[{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, res.Body)

			// HIT - Same query as above with inline value
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query Find {findEmployees(criteria: { nationality: ENGLISH }){id details {forename surname}}}`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, "HIT", res.Response.Header.Get("X-WG-Execution-Plan-Cache"))
			require.Equal(t, `{"data":{"findEmployees":[{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, res.Body)

			// HIT - Same query as above but with different whitespace and operation name
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query Foo      ($criteria: SearchInput! = { nationality: ENGLISH }) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, "HIT", res.Response.Header.Get("X-WG-Execution-Plan-Cache"))
			require.Equal(t, `{"data":{"findEmployees":[{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, res.Body)
		})
	})

	t.Run("disabled variables remapping", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.DisableVariablesRemapping = true
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// MISS - First query
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`{"criteria":{"nationality":"GERMAN"}}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, "MISS", res.Response.Header.Get("X-WG-Execution-Plan-Cache"))
			require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res.Body)

			// MISS - Same query as above with different variables nullability
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`{"criteria":{"nationality":"GERMAN"}}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, "MISS", res.Response.Header.Get("X-WG-Execution-Plan-Cache"))
			require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res.Body)

			// HIT - Same query as above with different variables values
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`{"criteria":{"nationality":"AMERICAN"}}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, "HIT", res.Response.Header.Get("X-WG-Execution-Plan-Cache"))
			require.Equal(t, `{"data":{"findEmployees":[{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}]}}`, res.Body)

			// MISS - Same query as above with different variable name
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteriaDifferent: SearchInput) {findEmployees(criteria: $criteriaDifferent){id details {forename surname}}}`,
				Variables: json.RawMessage(`{"criteriaDifferent":{"nationality":"AMERICAN"}}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, "MISS", res.Response.Header.Get("X-WG-Execution-Plan-Cache"))
			require.Equal(t, `{"data":{"findEmployees":[{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}]}}`, res.Body)

			// HIT - Same query as above with variables default value
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query Find($criteria: SearchInput! = { nationality: ENGLISH }) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, "HIT", res.Response.Header.Get("X-WG-Execution-Plan-Cache"))
			require.Equal(t, `{"data":{"findEmployees":[{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, res.Body)

			// MISS - Same query as above with inline value
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query Find {findEmployees(criteria: { nationality: ENGLISH }){id details {forename surname}}}`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, "MISS", res.Response.Header.Get("X-WG-Execution-Plan-Cache"))
			require.Equal(t, `{"data":{"findEmployees":[{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, res.Body)

			// HIT - Same query as above but with different whitespace and operation name
			res, err = xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query Foo      ($criteria: SearchInput! = { nationality: ENGLISH }) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, "HIT", res.Response.Header.Get("X-WG-Execution-Plan-Cache"))
			require.Equal(t, `{"data":{"findEmployees":[{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, res.Body)
		})
	})
}

func TestTypenameValidation(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			GlobalMiddleware: func(handler http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusOK)
					_, _ = w.Write([]byte(`{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"__typename":"wrongTypeName"},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"__typename":"wrongTypeName"},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"__typename":"wrongTypeName"},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"__typename":"wrongTypeName"}]}}`))
				})
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname} __typename}}`,
			Variables: json.RawMessage(`{"criteria":{"nationality":"GERMAN"}}`),
		})
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, res.Response.StatusCode)
		require.Equal(t, `{"errors":[{"message":"Subgraph 'family' returned invalid value 'wrongTypeName' for __typename field.","path":["findEmployees",0],"extensions":{"code":"INVALID_GRAPHQL"}}],"data":null}`, res.Body)
	})
}

func TestExecutionPlanCacheDisabled(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.ExecutionPlanCacheSize = 0
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
			Variables: json.RawMessage(`{"criteria":{"nationality":"GERMAN"}}`),
		})
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, res.Response.StatusCode)
		require.Equal(t, "MISS", res.Response.Header.Get("X-WG-Execution-Plan-Cache"))
		require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res.Body)

		res2, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
			Variables: json.RawMessage(`{"criteria":{"nationality":"GERMAN"}}`),
		})
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, res2.Response.StatusCode)
		require.Equal(t, "MISS", res2.Response.Header.Get("X-WG-Execution-Plan-Cache"))
		require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res2.Body)

		res3, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query: `query Find($criteria: SearchInput! = { nationality: ENGLISH }) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
		})
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, res3.Response.StatusCode)
		require.Equal(t, "MISS", res3.Response.Header.Get("X-WG-Execution-Plan-Cache"))
		require.Equal(t, `{"data":{"findEmployees":[{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, res3.Body)
	})
}

func TestVariables(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		t.Run("correct validation", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`{"criteria":{"nationality":"GERMAN"}}`),
			})
			require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res.Body)
		})

		t.Run("query with variables", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.JSONEq(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		})

		t.Run("inline variables", func(t *testing.T) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employee(id:1) { id details { forename surname } } }`,
			})
			require.JSONEq(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		})

		t.Run("invalid number", func(t *testing.T) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`1`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"invalid request body: variables must be a JSON object"}]}`, res.Body)
		})

		t.Run("invalid string", func(t *testing.T) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`"1"`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"invalid request body: variables must be a JSON object"}]}`, res.Body)
		})

		t.Run("invalid boolean", func(t *testing.T) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`true`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"invalid request body: variables must be a JSON object"}]}`, res.Body)
		})

		t.Run("invalid array", func(t *testing.T) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`[]`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"invalid request body: variables must be a JSON object"}]}`, res.Body)
		})

		t.Run("missing", func(t *testing.T) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`{}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"Variable \"$criteria\" of required type \"SearchInput!\" was not provided."}]}`, res.Body)
		})

		t.Run("wrong value variable", func(t *testing.T) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`{"criteria":1}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"Variable \"$criteria\" got invalid value 1; Expected type \"SearchInput\" to be an object."}]}`, res.Body)
		})
	})
}

func TestPropagateOperationName(t *testing.T) {
	t.Parallel()

	t.Run("simple", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.EnableSubgraphFetchOperationName = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							body, _ := io.ReadAll(r.Body)
							var req core.GraphQLRequest
							require.NoError(t, json.Unmarshal(body, &req))

							require.Equal(t, `query ScalarRequest__employees__0($a: Int!){employee(id: $a){id}}`, req.Query)
							require.Equal(t, json.RawMessage(`{"a":1}`), req.Variables)

							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"data":{"employee":{"id":1}}}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			t.Run("scalar argument type", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query ScalarRequest ($count:Int!) { employee(id:$count) { id } }`,
					Variables: json.RawMessage(`{"count":1}`),
				})
				require.JSONEq(t, `{"data":{"employee":{"id":1}}}`, res.Body)
			})
		})
	})

	t.Run("complex", func(t *testing.T) {
		t.Parallel()
		employeePrefix := "query Requires__employees__"
		var mut sync.Mutex
		// Middleware for Employee Subgraph should remove queries it sees.
		expectEmployeeOps := []string{employeePrefix + "0", employeePrefix + "3", employeePrefix + "4"}

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.EnableSubgraphFetchOperationName = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							body, err := io.ReadAll(r.Body)
							require.NoError(t, err)
							var req core.GraphQLRequest
							require.NoError(t, json.Unmarshal(body, &req))

							got := req.Query[:len(employeePrefix)+1]
							mut.Lock()
							idx := slices.Index(expectEmployeeOps, got)
							require.True(t, idx != -1, "expected one of %v, got %v", expectEmployeeOps, got)
							expectEmployeeOps = slices.Delete(expectEmployeeOps, idx, idx+1)
							mut.Unlock()

							r.Body = io.NopCloser(bytes.NewReader(body))
							handler.ServeHTTP(w, r)
						})
					},
				},
				Mood: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							body, err := io.ReadAll(r.Body)
							require.NoError(t, err)
							var req core.GraphQLRequest
							require.NoError(t, json.Unmarshal(body, &req))

							require.Contains(t, req.Query, "query Requires__mood__1")

							r.Body = io.NopCloser(bytes.NewReader(body))
							handler.ServeHTTP(w, r)
						})
					},
				},
				Availability: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							body, err := io.ReadAll(r.Body)
							require.NoError(t, err)
							var req core.GraphQLRequest
							require.NoError(t, json.Unmarshal(body, &req))

							require.Contains(t, req.Query, "query Requires__availability__2")

							r.Body = io.NopCloser(bytes.NewReader(body))
							handler.ServeHTTP(w, r)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			t.Run("scalar argument type", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query Requires {
					  products {
						__typename
						... on Consultancy {
						  lead {
							__typename
							id
							derivedMood
						  }
						  isLeadAvailable
						}
					  }
					}`,
				})
				require.Empty(t, expectEmployeeOps, "unexpected remaining operations")
				require.JSONEq(t, `{"data":{"products":[{"__typename":"Consultancy","lead":{"__typename":"Employee","id":1,"derivedMood":"HAPPY"},"isLeadAvailable":false},{"__typename":"Cosmo"},{"__typename":"SDK"}]}}`, res.Body)
			})
		})
	})
}

func TestVariablesRemapping(t *testing.T) {
	t.Parallel()

	t.Run("enabled", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							body, _ := io.ReadAll(r.Body)
							var req core.GraphQLRequest
							require.NoError(t, json.Unmarshal(body, &req))

							require.Equal(t, `query($a: Int!){employee(id: $a){id}}`, req.Query)
							require.Equal(t, json.RawMessage(`{"a":1}`), req.Variables)

							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"data":{"employee":{"id":1}}}`))
						})
					},
				},
				Test1: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							body, _ := io.ReadAll(r.Body)
							var req core.GraphQLRequest
							require.NoError(t, json.Unmarshal(body, &req))

							require.Equal(t, `query($a: InputArg!){rootFieldWithInput(arg: $a)}`, req.Query)
							require.Equal(t, json.RawMessage(`{"a":{"string":"foo"}}`), req.Variables)

							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"data":{"rootFieldWithInput":"bar"}}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			t.Run("scalar argument type", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query ($count:Int!) { employee(id:$count) { id } }`,
					Variables: json.RawMessage(`{"count":1}`),
				})
				require.JSONEq(t, `{"data":{"employee":{"id":1}}}`, res.Body)
			})

			t.Run("input object argument type - variable argument", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query ($arg:InputArg!) { rootFieldWithInput(arg: $arg) }`,
					Variables: json.RawMessage(`{"arg":{"string": "foo"}}`),
				})
				require.JSONEq(t, `{"data":{"rootFieldWithInput":"bar"}}`, res.Body)
			})

			t.Run("input object argument type - inline value", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query { rootFieldWithInput(arg: {string: "foo"}) }`,
				})
				require.JSONEq(t, `{"data":{"rootFieldWithInput":"bar"}}`, res.Body)
			})
		})
	})

	t.Run("disabled", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.DisableVariablesRemapping = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							body, _ := io.ReadAll(r.Body)
							var req core.GraphQLRequest
							require.NoError(t, json.Unmarshal(body, &req))

							require.Equal(t, `query($count: Int!){employee(id: $count){id}}`, req.Query)
							require.Equal(t, json.RawMessage(`{"count":1}`), req.Variables)

							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"data":{"employee":{"id":1}}}`))
						})
					},
				},
				Test1: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							body, _ := io.ReadAll(r.Body)
							var req core.GraphQLRequest
							require.NoError(t, json.Unmarshal(body, &req))

							require.Equal(t, `query($arg: InputArg!){rootFieldWithInput(arg: $arg)}`, req.Query)
							require.Equal(t, json.RawMessage(`{"arg":{"string":"foo"}}`), req.Variables)

							w.WriteHeader(http.StatusOK)
							_, _ = w.Write([]byte(`{"data":{"rootFieldWithInput":"bar"}}`))
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			t.Run("scalar argument type", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query ($count:Int!) { employee(id:$count) { id } }`,
					Variables: json.RawMessage(`{"count":1}`),
				})
				require.JSONEq(t, `{"data":{"employee":{"id":1}}}`, res.Body)
			})

			t.Run("input object argument type", func(t *testing.T) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query ($arg:InputArg!) { rootFieldWithInput(arg: $arg) }`,
					Variables: json.RawMessage(`{"arg":{"string": "foo"}}`),
				})
				require.JSONEq(t, `{"data":{"rootFieldWithInput":"bar"}}`, res.Body)
			})
		})
	})
}

func TestEnableRequireFetchReasons(t *testing.T) {
	t.Parallel()

	// Simple test to verify that the configuration switch works.
	// Multi subgraphs calls are tested in the engine.
	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigWithRequireFetchReasonsJSONTemplate,
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.EnableRequireFetchReasons = true
		},
		Subgraphs: testenv.SubgraphsConfig{
			Employees: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						body, _ := io.ReadAll(r.Body)
						var req core.GraphQLRequest
						require.NoError(t, json.Unmarshal(body, &req))

						require.Equal(t, `query($a: Int!){employee(id: $a){id}}`, req.Query)
						require.Equal(t, `{"fetch_reasons":[{"typename":"Employee","field":"id","by_user":true},{"typename":"Query","field":"employee","by_user":true}]}`, string(req.Extensions))

						w.WriteHeader(http.StatusOK)
						_, _ = w.Write([]byte(`{"data":{"employee":{"id":1}}}`))
					})
				},
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query:     `query ($count:Int!) { employee(id:$count) { id } }`,
			Variables: json.RawMessage(`{"count":1}`),
		})
		require.JSONEq(t, `{"data":{"employee":{"id":1}}}`, res.Body)
	})
}

func TestAnonymousQuery(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		t.Run("anonymous query", func(t *testing.T) {
			t.Parallel()

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)
		})

		t.Run("sequence of queries with different count of variables", func(t *testing.T) {
			t.Parallel()

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query ($a: Float! = 1) { floatField(arg: $a) }`,
			})
			require.JSONEq(t, `{"data":{"floatField":1}}`, res.Body)

			// we need to obtain more parse kits to reuse them
			for i := 0; i < 10; i++ {
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `query ($a: String = "A", $b: Int = 1) { delay(response: $a, ms: $b ) }`,
				})
				require.JSONEq(t, `{"data":{"delay":"A"}}`, res.Body)
			}

			// this query should not fail with panic because of the reuse of variables normalizer
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query ($a: Float! = 1) { floatField(arg: $a) }`,
			})
			require.JSONEq(t, `{"data":{"floatField":1}}`, res.Body)
		})
	})
}

func TestProxy(t *testing.T) {
	t.Parallel()

	fakeSubgraph := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"data":{"employees":[{"id":1234}]}}`))
	}))

	u, err := url.Parse(fakeSubgraph.URL)
	require.NoError(t, err)

	proxy := httptest.NewServer(httputil.NewSingleHostReverseProxy(u))
	require.NoError(t, err)

	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithProxy(func(req *http.Request) (*url.URL, error) {
				return url.Parse(proxy.URL)
			}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id } }`,
		})
		require.Equal(t, `{"data":{"employees":[{"id":1234}]}}`, res.Body)
	})
}

func TestConcurrentBodyRead(t *testing.T) {
	t.Parallel()
	expectedData := `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true},"role":{"title":["Founder","CEO"],"departments":["ENGINEERING","MARKETING"]},"hobbies":[{"category":"SPORT"},{"name":"Counter Strike","genres":["FPS"],"yearsOfExperience":20},{"name":"WunderGraph"},{"languages":["GO","TYPESCRIPT"]},{"countriesLived":[{"language":"English"},{"language":"German"}]}]},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false},"role":{"title":["Co-founder","Tech Lead"],"departments":["ENGINEERING"]},"hobbies":[{"category":"STRENGTH_TRAINING"},{"name":"Counter Strike","genres":["FPS"],"yearsOfExperience":0.5},{"languages":["GO","RUST"]}]},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false},"role":{"title":["Co-founder","Head of Growth"],"departments":["MARKETING"]},"hobbies":[{"category":"HIKING"},{"category":"SPORT"},{"name":"Reading"},{"countriesLived":[{"language":"English"},{"language":"Serbian"}]}]},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true},"role":{"title":["Co-founder","COO"],"departments":["OPERATIONS","MARKETING"]},"hobbies":[{"category":"HIKING"},{"planeModels":["Aquila AT01","Cessna C172","Cessna C206","Cirrus SR20","Cirrus SR22","Diamond DA40","Diamond HK36","Diamond DA20","Piper Cub","Pitts Special","Robin DR400"],"yearsOfExperience":20},{"countriesLived":[{"language":"English"},{"language":"German"}]}]},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false},"role":{"title":["Senior GO Engineer"],"departments":["ENGINEERING"]},"hobbies":[{"name":"Building a house"},{"name":"Forumla 1"},{"name":"Raising cats"}]},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false},"role":{"title":["Software Engineer"],"departments":["ENGINEERING"]},"hobbies":[{"name":"Chess","genres":["BOARD"],"yearsOfExperience":9.5},{"name":"Watching anime"}]},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false},"role":{"title":["Software Engineer"],"departments":["ENGINEERING"]},"hobbies":[{"category":"STRENGTH_TRAINING"},{"name":"Miscellaneous","genres":["ADVENTURE","RPG","SIMULATION","STRATEGY"],"yearsOfExperience":17},{"name":"Watching anime"}]},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false},"role":{"title":["Senior Frontend Engineer"],"departments":["ENGINEERING"]},"hobbies":[{"languages":["TYPESCRIPT"]},{"category":"CALISTHENICS"},{"category":"HIKING"},{"category":"STRENGTH_TRAINING"},{"name":"saas-ui"},{"countriesLived":[{"language":"German"},{"language":"Indonesian"},{"language":"Dutch"},{"language":"Portuguese"},{"language":"Spanish"},{"language":"Thai"}]}]},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true},"role":{"title":["Accounting & Finance"],"departments":["OPERATIONS"]},"hobbies":[{"name":"Spending time with the family"}]},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false},"role":{"title":["Software Engineer"],"departments":["ENGINEERING"]},"hobbies":[{"languages":["CSHARP","GO","RUST","TYPESCRIPT"]},{"category":"STRENGTH_TRAINING"},{"name":"Miscellaneous","genres":["ADVENTURE","BOARD","CARD","ROGUELITE","RPG","SIMULATION","STRATEGY"],"yearsOfExperience":25.5},{"countriesLived":[{"language":"English"},{"language":"Korean"},{"language":"Taiwanese"}]}]}]}}`

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		goRoutines := 10
		wg := &sync.WaitGroup{}
		wg.Add(goRoutines)
		for i := 0; i < goRoutines; i++ {
			go func() {
				defer wg.Done()
				res, err := xEnv.MakeGraphQLRequestWithContext(context.Background(), testenv.GraphQLRequest{
					Query: bigEmployeesQuery,
				})
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				require.Equal(t, expectedData, res.Body)
			}()
		}
		wg.Wait()
	})
}

func TestTracing(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.EnableRequestTracing = true
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		g := goldie.New(
			t,
			goldie.WithFixtureDir("testdata"),
			goldie.WithNameSuffix(".json"),
			goldie.WithDiffEngine(goldie.ClassicDiff),
		)

		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query: bigEmployeesQuery,
			Header: http.Header{
				"X-WG-Trace": []string{"true", "enable_predictable_debug_timings"},
			},
		})
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, res.Response.StatusCode)

		// we generate a random port for the test server, so we need to replace the port in the tracing json
		rex, err := regexp.Compile(`http://127.0.0.1:\d+/graphql`)
		require.NoError(t, err)
		resultBody := rex.ReplaceAllString(res.Body, "http://localhost/graphql")
		resultBody = prettifyJSON(t, resultBody)

		g.Assert(t, "tracing", []byte(resultBody))
		// make the request again, but with "enable_predictable_debug_timings" disabled
		// compare the result and ensure that the timings are different
		res2, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query: bigEmployeesQuery,
			Header: http.Header{
				"X-WG-Trace": []string{"true"},
			},
		})
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, res2.Response.StatusCode)
		body := []byte(res2.Body)
		data, _, _, err := jsonparser.Get(body, "data")
		require.NoError(t, err)
		require.NotNilf(t, data, "data should not be nil: %s", body)
		tracing, _, _, err := jsonparser.Get(body, "extensions", "trace")
		require.NoError(t, err)
		require.NotNilf(t, tracing, "tracing should not be nil: %s", body)

		newResultBody := prettifyJSON(t, string(body))

		testBody := g.GoldenFileName(t, "tracing")
		require.NotEqual(t, testBody, newResultBody)
	})
}

func prettifyJSON(t *testing.T, jsonStr string) string {
	res := &bytes.Buffer{}
	require.NoError(t, json.Indent(res, []byte(jsonStr), "", "  "))
	return res.String()
}

func TestOperationSelection(t *testing.T) {
	t.Parallel()

	t.Run("anonymous query", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } }`,
			})
			require.JSONEq(t, employeesIDData, res.Body)
		})
	})

	t.Run("multiple anonymous queries", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ employees { id } } { employees { id } }`,
			})
			require.Equal(t, `{"errors":[{"message":"operation name is required when multiple operations are defined"}]}`, res.Body)
		})
	})

	t.Run("operation name null returns data", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:         `{ employees { id } }`,
				OperationName: []byte(`null`),
			})
			require.Equal(t, employeesIDData, res.Body)
		})
	})

	t.Run("operation name wrong on anonymous operation", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:         `{ employees { id } }`,
				OperationName: []byte(`"Missing"`),
			})
			require.Equal(t, `{"errors":[{"message":"operation with name 'Missing' not found"}]}`, res.Body)
		})
	})

	t.Run("operation name wrong on named operation", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:         `query Exists { employees { id } }`,
				OperationName: []byte(`"Missing"`),
			})
			require.Equal(t, `{"errors":[{"message":"operation with name 'Missing' not found"}]}`, res.Body)
		})

		t.Run("multiple named operations", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:         `query A { employees { id } } query B { employees { id details { forename surname } } }`,
					OperationName: []byte(`"A"`),
				})
				require.Equal(t, employeesIDData, res.Body)
			})
		})

		t.Run("multiple named operations B", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:         `query A { employees { id } } query B { employees { id details { forename surname } } }`,
					OperationName: []byte(`"B"`),
				})
				require.Equal(t, `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":3,"details":{"forename":"Stefan","surname":"Avram"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"}},{"id":7,"details":{"forename":"Suvij","surname":"Surya"}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}},{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, res.Body)
			})
		})

		t.Run("multiple named operations C", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:         `query A { employees { id } } query B { employees { id details { forename surname } } }`,
					OperationName: []byte(`"C"`),
				})
				require.Equal(t, `{"errors":[{"message":"operation with name 'C' not found"}]}`, res.Body)
			})
		})
	})
}

func TestTestdataQueries(t *testing.T) {
	t.Parallel()

	testDir := filepath.Join("testdata", "queries")
	entries, err := os.ReadDir(testDir)
	require.NoError(t, err)
	for _, entry := range entries {
		fileName := entry.Name()
		ext := filepath.Ext(fileName)
		name := strings.TrimSuffix(fileName, ext)

		if ext != ".graphql" {
			continue
		}

		t.Run(name, func(t *testing.T) {
			t.Parallel()

			g := goldie.New(
				t,
				goldie.WithFixtureDir("testdata/queries"),
				goldie.WithNameSuffix(".json"),
				goldie.WithDiffEngine(goldie.ClassicDiff),
			)

			testenv.Run(t, &testenv.Config{
				ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
					cfg.Debug = config.EngineDebugConfiguration{
						// PrintQueryPlans: true,
					}
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				queryData, err := os.ReadFile(filepath.Join(testDir, fmt.Sprintf("%s.graphql", name)))
				require.NoError(t, err)
				payload := map[string]any{
					"query": string(queryData),
				}
				payloadData, err := json.Marshal(payload)
				require.NoError(t, err)

				res, err := xEnv.MakeRequest(http.MethodPost, "/graphql", nil, bytes.NewReader(payloadData))
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.StatusCode)
				result, err := io.ReadAll(res.Body)
				require.NoError(t, err)

				actual := normalizeJSON(t, result)
				g.Assert(t, name, actual)
			})
		})
	}
}

func TestIntegrationWithUndefinedField(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id notDefined } }`,
		})
		require.JSONEq(t, `{"errors":[{"message":"Cannot query field \"notDefined\" on type \"Employee\".","path":["query","employees"]}]}`, res.Body)
	})
}

func TestParallel(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		expect := `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`
		trigger := make(chan struct{})
		wg := sync.WaitGroup{}
		wg.Add(10)
		for i := 0; i < 10; i++ {
			go func() {
				defer wg.Done()
				<-trigger
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.JSONEq(t, expect, res.Body)
			}()
		}
		time.Sleep(10 * time.Millisecond)
		close(trigger)
		wg.Wait()
	})
}

func BenchmarkSequential(b *testing.B) {
	testenv.Bench(b, &testenv.Config{}, func(b *testing.B, xEnv *testenv.Environment) {
		expect := `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`
		b.SetBytes(int64(len(expect)))
		b.ReportAllocs()
		b.ResetTimer()
		for ii := 0; ii < b.N; ii++ {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:         `query Employee ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				OperationName: []byte(`"Employee"`),
				Variables:     json.RawMessage(`{"n":1}`),
			})
			if res.Body != expect {
				b.Errorf("unexpected result %q, expecting %q", res.Body, expect)
			}
		}
	})
}

func BenchmarkParallel(b *testing.B) {
	testenv.Bench(b, &testenv.Config{}, func(b *testing.B, xEnv *testenv.Environment) {
		expect := `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`
		b.SetBytes(int64(len(expect)))
		b.ReportAllocs()
		b.ResetTimer()
		b.RunParallel(func(pb *testing.PB) {
			for pb.Next() {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:         `query Employee($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
					OperationName: []byte(`"Employee"`),
					Variables:     json.RawMessage(`{"n":1}`),
				})
				if res.Body != expect {
					b.Errorf("unexpected result %q, expecting %q", res.Body, expect)
				}
			}
		})
	})
}

func BenchmarkParallelWithMinify(b *testing.B) {
	testenv.Bench(b, &testenv.Config{
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.MinifySubgraphOperations = true
			cfg.ExecutionPlanCacheSize = 0
		},
	}, func(b *testing.B, xEnv *testenv.Environment) {
		expect := `{"data":{"a":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}],"b":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}],"c":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}],"d":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}],"e":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}]}}`
		b.SetBytes(int64(len(expect)))
		b.ReportAllocs()
		b.ResetTimer()
		b.RunParallel(func(pb *testing.PB) {
			for pb.Next() {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:         `query MyQuery {a: employees { ...EmployeeDetails } b: employees { ...EmployeeDetails } c: employees { ...EmployeeDetails } d: employees { ...EmployeeDetails } e: employees { ...EmployeeDetails } } fragment EmployeeDetails on Employee { id details { forename surname hasChildren } }`,
					OperationName: json.RawMessage(`"MyQuery"`),
				})
				if res.Body != expect {
					b.Errorf("unexpected result %q, expecting %q", res.Body, expect)
				}
			}
		})
	})
}

const (
	bigEmployeesQuery = `{
  employees {
    id
    details {
      forename
      surname
      hasChildren
    }
    role {
      title
      departments
    }
    hobbies {
      ... on Exercise {
        category
      }
      ... on Flying {
        planeModels
        yearsOfExperience
      }
      ... on Gaming {
        name
        genres
        yearsOfExperience
      }
      ... on Programming {
        languages
      }
      ... on Travelling {
        countriesLived {
		  language
		}
      }
      ... on Other {
        name
      }
    }
  }
}`
	bigEmployeesResponse = `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true},"role":{"title":["Founder","CEO"],"departments":["ENGINEERING","MARKETING"]},"hobbies":[{"category":"SPORT"},{"name":"Counter Strike","genres":["FPS"],"yearsOfExperience":20},{"name":"WunderGraph"},{"languages":["GO","TYPESCRIPT"]},{"countriesLived":[{"language": "English"},{"language": "German"}]}]},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false},"role":{"title":["Co-founder","Tech Lead"],"departments":["ENGINEERING"]},"hobbies":[{"category":"STRENGTH_TRAINING"},{"name":"Counter Strike","genres":["FPS"],"yearsOfExperience":0.5},{"languages":["GO","RUST"]}]},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false},"role":{"title":["Co-founder","Head of Growth"],"departments":["MARKETING"]},"hobbies":[{"category":"HIKING"},{"category":"SPORT"},{"name":"Reading"},{"countriesLived":[{"language": "English"},{"language": "Serbian"}]}]},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true},"role":{"title":["Co-founder","COO"],"departments":["OPERATIONS"]},"hobbies":[{"category":"HIKING"},{"planeModels":["Aquila AT01","Cessna C172","Cessna C206","Cirrus SR20","Cirrus SR22","Diamond DA40","Diamond HK36","Diamond DA20","Piper Cub","Pitts Special","Robin DR400"],"yearsOfExperience":20},{"countriesLived":[{"language": "English"},{"language": "German"}]}]},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false},"role":{"title":["Senior GO Engineer"],"departments":["ENGINEERING"]},"hobbies":[{"name":"Building a house"},{"name":"Forumla 1"},{"name":"Raising cats"}]},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false},"role":{"title":["Software Engineer"],"departments":["ENGINEERING"]},"hobbies":[{"name":"Chess","genres":["BOARD"],"yearsOfExperience":9.5},{"name":"Watching anime"}]},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false},"role":{"title":["Software Engineer"],"departments":["ENGINEERING"]},"hobbies":[{"category":"STRENGTH_TRAINING"},{"name":"Miscellaneous","genres":["ADVENTURE","RPG","SIMULATION","STRATEGY"],"yearsOfExperience":17},{"name":"Watching anime"}]},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false},"role":{"title":["Senior Frontend Engineer"],"departments":["ENGINEERING"]},"hobbies":[{"languages":["TYPESCRIPT"]},{"category":"CALISTHENICS"},{"category":"HIKING"},{"category":"STRENGTH_TRAINING"},{"name":"saas-ui"},{"countriesLived":[{"language": "German"},{"language": "Indonesian"},{"language": "Dutch"},{"language": "Portuguese"},{"language": "Spanish"},{"language": "Thai"}]}]},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true},"role":{"title":["Accounting \\u0026 Finance"],"departments":["OPERATIONS"]},"hobbies":[{"name":"Spending time with the family"}]},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false},"role":{"title":["Software Engineer"],"departments":["ENGINEERING"]},"hobbies":[{"languages":["CSHARP","GO","RUST","TYPESCRIPT"]},{"category":"STRENGTH_TRAINING"},{"name":"Miscellaneous","genres":["ADVENTURE","BOARD","CARD","ROGUELITE","RPG","SIMULATION","STRATEGY"],"yearsOfExperience":25.5},{"countriesLived":["language": "English"},"language": "Korean"},"language": "Taiwanese"}]}]}]}}`
)

func BenchmarkPb(b *testing.B) {
	testenv.Bench(b, &testenv.Config{}, func(b *testing.B, xEnv *testenv.Environment) {
		b.SetBytes(int64(len(bigEmployeesResponse)))
		b.ReportAllocs()
		b.ResetTimer()
		b.RunParallel(func(pb *testing.PB) {
			for pb.Next() {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: bigEmployeesQuery,
				})
				if len(res.Body) < 3000 {
					b.Errorf("unexpected result %q, expecting \n\n%q", res.Body, bigEmployeesResponse)
				}
			}
		})
	})
}

func TestSubgraphOperationMinifier(t *testing.T) {
	t.Parallel()
	t.Run("prefer minified version", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.MinifySubgraphOperations = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							body, err := io.ReadAll(r.Body)
							require.NoError(t, err)
							require.Equal(t, `{"query":"{a: employees {...A} b: employees {...A} c: employees {...A} d: employees {...A} e: employees {...A}} fragment A on Employee {__typename id}"}`, string(body))
							r.Body = io.NopCloser(bytes.NewReader(body))
							handler.ServeHTTP(w, r)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:         `query MyQuery {a: employees { ...EmployeeDetails } b: employees { ...EmployeeDetails } c: employees { ...EmployeeDetails } d: employees { ...EmployeeDetails } e: employees { ...EmployeeDetails } } fragment EmployeeDetails on Employee { id details { forename surname hasChildren } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.Equal(t, `{"data":{"a":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}],"b":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}],"c":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}],"d":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}],"e":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}]}}`, res.Body)
		})
	})
	t.Run("prefer non-minified when disabled", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							body, err := io.ReadAll(r.Body)
							require.NoError(t, err)
							require.Equal(t, `{"query":"{a: employees {id __typename} b: employees {id __typename} c: employees {id __typename} d: employees {id __typename} e: employees {id __typename}}"}`, string(body))
							r.Body = io.NopCloser(bytes.NewReader(body))
							handler.ServeHTTP(w, r)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:         `query MyQuery {a: employees { ...EmployeeDetails } b: employees { ...EmployeeDetails } c: employees { ...EmployeeDetails } d: employees { ...EmployeeDetails } e: employees { ...EmployeeDetails } } fragment EmployeeDetails on Employee { id details { forename surname hasChildren } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.Equal(t, `{"data":{"a":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}],"b":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}],"c":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}],"d":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}],"e":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}]}}`, res.Body)
		})
	})
	t.Run("minify concurrently without plan cache", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.MinifySubgraphOperations = true
				cfg.ExecutionPlanCacheSize = 0
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							body, err := io.ReadAll(r.Body)
							require.NoError(t, err)
							require.Equal(t, `{"query":"{a: employees {...A} b: employees {...A} c: employees {...A} d: employees {...A} e: employees {...A}} fragment A on Employee {__typename id}"}`, string(body))
							r.Body = io.NopCloser(bytes.NewReader(body))
							handler.ServeHTTP(w, r)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			wg := &sync.WaitGroup{}
			wg.Add(100)
			start := make(chan struct{})
			for i := 0; i < 100; i++ {
				go func() {
					defer wg.Done()
					<-start
					res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query:         `query MyQuery {a: employees { ...EmployeeDetails } b: employees { ...EmployeeDetails } c: employees { ...EmployeeDetails } d: employees { ...EmployeeDetails } e: employees { ...EmployeeDetails } } fragment EmployeeDetails on Employee { id details { forename surname hasChildren } }`,
						OperationName: json.RawMessage(`"MyQuery"`),
					})
					require.Equal(t, `{"data":{"a":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}],"b":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}],"c":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}],"d":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}],"e":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}]}}`, res.Body)
				}()
			}
			close(start)
			wg.Wait()
		})
	})
	t.Run("prefer non-minified version", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.MinifySubgraphOperations = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							body, err := io.ReadAll(r.Body)
							require.NoError(t, err)
							require.Equal(t, `{"query":"{a: employees {id __typename}}"}`, string(body))
							r.Body = io.NopCloser(bytes.NewReader(body))
							handler.ServeHTTP(w, r)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:         `query MyQuery {a: employees { ...EmployeeDetails } } fragment EmployeeDetails on Employee { id details { forename surname hasChildren } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.Equal(t, `{"data":{"a":[{"id":1,"details":{"forename":"Jens","surname":"Neuse","hasChildren":true}},{"id":2,"details":{"forename":"Dustin","surname":"Deus","hasChildren":false}},{"id":3,"details":{"forename":"Stefan","surname":"Avram","hasChildren":false}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer","hasChildren":true}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin","hasChildren":false}},{"id":7,"details":{"forename":"Suvij","surname":"Surya","hasChildren":false}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar","hasChildren":false}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma","hasChildren":false}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse","hasChildren":true}},{"id":12,"details":{"forename":"David","surname":"Stutt","hasChildren":false}}]}}`, res.Body)
		})
	})
}

func TestEmptyFragment(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `fragment A on Query {} query { ...A }`,
		})
		require.Equal(t, res.Response.Header.Get("Content-Type"), "application/json; charset=utf-8")
		require.Equal(t, `{"errors":[{"message":"unexpected token - got: RBRACE want one of: [IDENT SPREAD]","locations":[{"line":1,"column":22}]}]}`, res.Body)
	})
}

func TestPlannerErrorMessage(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		// Error message should contain the invalid argument name instead of a
		// generic planning error message
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{  employee(id:3, does_not_exist: 42) { id } }`,
		})
		var resp testenv.GraphQLResponse
		if err := json.NewDecoder(strings.NewReader(res.Body)).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		require.Len(t, resp.Errors, 1)
		require.Equal(t, `Unknown argument "does_not_exist" on field "Query.employee".`, resp.Errors[0].Message)
	})
}

func TestConcurrentQueriesWithDelay(t *testing.T) {
	t.Parallel()
	const (
		numQueries   = 20
		queryDelayMs = 100
	)
	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			GlobalMiddleware: func(handler http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					time.Sleep(time.Millisecond * queryDelayMs)
					handler.ServeHTTP(w, r)
				})
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		var wg sync.WaitGroup
		wg.Add(numQueries)
		for ii := 0; ii < numQueries; ii++ {
			go func(ii int) {
				defer wg.Done()
				resp := strconv.FormatInt(rand.Int63(), 10)
				// For this test, we don't need any delays on the server side
				query := fmt.Sprintf(`{ delay(response:"%s", ms:%d) }`, resp, queryDelayMs)
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: query,
				})
				require.JSONEq(t, fmt.Sprintf(`{"data":{"delay":"%s"}}`, resp), res.Body, "query %d failed", ii)
			}(ii)
		}
		wg.Wait()
	})
}

func TestRequestBodySizeLimit(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{core.WithRouterTrafficConfig(&config.RouterTrafficConfiguration{
			MaxRequestBodyBytes: 10,
		})},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query: `{ employeeAsList(id: 1) { id details { forename surname } rootFieldThrowsError fieldThrowsError rootFieldErrorWrapper { okField errorField } } }`,
		})
		require.NoError(t, err)
		require.Equal(t, http.StatusRequestEntityTooLarge, res.Response.StatusCode)
		require.Equal(t, res.Response.Header.Get("Content-Type"), "application/json; charset=utf-8")
		require.Equal(t, `{"errors":[{"message":"request body too large, max size is 10 bytes"}]}`, res.Body)
	})
}

func TestDataNotSetOnPreExecutionErrors(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
			cfg.Enabled = true
			cfg.Mode = config.SubgraphErrorPropagationModePassthrough
			cfg.DefaultExtensionCode = "DEFAULT_CODE"
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query: `{ employees { rootFieldThrowWithErrorCode(ex }}`,
		})
		require.NoError(t, err)
		require.Equal(t, res.Response.Header.Get("Content-Type"), "application/json; charset=utf-8")
		require.Equal(t, `{"errors":[{"message":"unexpected token - got: RBRACE want one of: [COLON]","locations":[{"line":1,"column":46}]}]}`, res.Body)
	})
}
