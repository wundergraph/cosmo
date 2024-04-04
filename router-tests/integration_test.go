package integration_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/buger/jsonparser"
	"github.com/sebdah/goldie/v2"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

const letterBytes = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

const employeesIDData = `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`

func randString(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = letterBytes[rand.Intn(len(letterBytes))]
	}
	return string(b)
}

type testQuery struct {
	Name      string
	Body      string
	Variables map[string]interface{}
}

func (t *testQuery) Data() []byte {
	name := t.Name
	if name == "" {
		name = randString(10)
	}
	values := map[string]interface{}{
		"query":         fmt.Sprintf("query %s %s", name, t.Body),
		"operationName": name,
	}
	if len(t.Variables) > 0 {
		values["variables"] = t.Variables
	}
	data, err := json.Marshal(values)
	if err != nil {
		panic(err)
	}
	return data
}

func normalizeJSON(tb testing.TB, data []byte) []byte {
	buf := new(bytes.Buffer)
	err := json.Indent(buf, data, "", "  ")
	require.NoError(tb, err)
	return buf.Bytes()
}

func TestIntegration(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `query { employees { id } }`,
		})
		require.JSONEq(t, employeesIDData, res.Body)
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

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
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
		require.Equal(t, "HIT", res2.Response.Header.Get("X-WG-Execution-Plan-Cache"))
		require.Equal(t, `{"data":{"findEmployees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}}]}}`, res2.Body)

		res3, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
			Query: `query Find($criteria: SearchInput! = { nationality: ENGLISH }) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
		})
		require.NoError(t, err)
		require.Equal(t, http.StatusOK, res3.Response.StatusCode)
		require.Equal(t, "HIT", res3.Response.Header.Get("X-WG-Execution-Plan-Cache"))
		require.Equal(t, `{"data":{"findEmployees":[{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`, res3.Body)
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
			require.Equal(t, `{"errors":[{"message":"variables value must not be a number"}],"data":null}`, res.Body)
		})

		t.Run("invalid string", func(t *testing.T) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`"1"`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"variables value must not be a string"}],"data":null}`, res.Body)
		})

		t.Run("invalid boolean", func(t *testing.T) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`true`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"variables value must not be a boolean"}],"data":null}`, res.Body)
		})

		t.Run("invalid array", func(t *testing.T) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`[]`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"variables value must not be an array"}],"data":null}`, res.Body)
		})

		t.Run("missing", func(t *testing.T) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`{}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"Variable \"$criteria\" of required type \"SearchInput!\" was not provided."}],"data":null}`, res.Body)
		})

		t.Run("wrong value variable", func(t *testing.T) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query Find($criteria: SearchInput!) {findEmployees(criteria: $criteria){id details {forename surname}}}`,
				Variables: json.RawMessage(`{"criteria":1}`),
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusBadRequest, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"Variable \"$criteria\" got invalid value 1; Expected type \"SearchInput\" to be an object."}],"data":null}`, res.Body)
		})
	})
}

func TestAnonymousQuery(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id } }`,
		})
		require.JSONEq(t, employeesIDData, res.Body)
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
		// all nodes have UUIDs, so we need to replace them with a static UUID
		rex2, err := regexp.Compile(`"id":"[a-f0-9\-]{36}"`)
		require.NoError(t, err)
		resultBody = rex2.ReplaceAllString(resultBody, `"id":"00000000-0000-0000-0000-000000000000"`)
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
			require.Equal(t, `{"errors":[{"message":"operation name is required when multiple operations are defined"}],"data":null}`, res.Body)
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
			require.Equal(t, `{"errors":[{"message":"operation with name 'Missing' not found"}],"data":null}`, res.Body)
		})
	})

	t.Run("operation name wrong on named operation", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:         `query Exists { employees { id } }`,
				OperationName: []byte(`"Missing"`),
			})
			require.Equal(t, `{"errors":[{"message":"operation with name 'Missing' not found"}],"data":null}`, res.Body)
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

		t.Run("multiple named operations B", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:         `query A { employees { id } } query B { employees { id details { forename surname } } }`,
					OperationName: []byte(`"C"`),
				})
				require.Equal(t, `{"errors":[{"message":"operation with name 'C' not found"}],"data":null}`, res.Body)
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
			g := goldie.New(
				t,
				goldie.WithFixtureDir("testdata/queries"),
				goldie.WithNameSuffix(".json"),
				goldie.WithDiffEngine(goldie.ClassicDiff),
			)

			testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
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
		require.JSONEq(t, `{"errors":[{"message":"field: notDefined not defined on type: Employee","path":["query","employees","notDefined"]}],"data":null}`, res.Body)
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
				<-trigger
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query: `{ employee(id:1) { id details { forename surname } } }`,
				})
				require.JSONEq(t, expect, res.Body)
				wg.Done()
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

func FuzzQuery(f *testing.F) {
	corpus := []struct {
		Query     string
		Variables []byte // As JSON
	}{
		{
			Query: "{ employees { id } }",
		},
		{
			Query: `($team:Department!= MARKETING) {
				team_mates(team:$team) {
				  id
				}
			  }`,
			Variables: []byte(`{"team":"MARKETING"}`),
		},
		{
			Query:     `($n:Int!) { employee(id:$n) { id } }`,
			Variables: []byte(`{"n":4}`),
		},
	}
	for _, tc := range corpus {
		f.Add(tc.Query, tc.Variables)
	}
	f.Fuzz(func(t *testing.T, query string, variables []byte) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			var q testQuery
			if err := json.Unmarshal(variables, &q.Variables); err != nil {
				// Invalid JSON, mark as uninteresting input
				t.Skip()
			}
			q.Body = query

			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     query,
				Variables: variables,
			})
			require.NoError(t, err)
			if res.Response.StatusCode != http.StatusOK && res.Response.StatusCode != http.StatusBadRequest {
				t.Error("unexpected status code", res.Response.StatusCode)
			}
		})
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

func TestBlockMutations(t *testing.T) {
	t.Parallel()
	t.Run("allow", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
			})
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"data":{"updateEmployeeTag":{"id":1,"tag":"test"}}}`, res.Body)
		})
	})
	t.Run("block", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.BlockMutations = true
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
			})
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"operation type 'mutation' is blocked"}],"data":null}`, res.Body)
		})
	})
}

func TestBlockNonPersistedOperations(t *testing.T) {
	t.Parallel()
	t.Run("block", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.BlockNonPersistedOperations = true
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `mutation { updateEmployeeTag(id: 1, tag: "test") { id tag } }`,
			})
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, `{"errors":[{"message":"non-persisted operation is blocked"}],"data":null}`, res.Body)
		})
	})
}

func TestPartialOriginErrors(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			Products: testenv.SubgraphConfig{
				CloseOnStart: true,
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id details { forename surname } notes } }`,
		})
		require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '3' at Path 'query.employees.@'."}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
	})
}

func TestPartialOriginErrors500(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			Products: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.WriteHeader(http.StatusInternalServerError)
					})
				},
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id details { forename surname } notes } }`,
		})
		require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '3' at Path 'query.employees.@', Reason: empty response.","extensions":{"statusCode":500}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
	})
}

func TestPartialOriginErrorsWithNoStatusCodePropagation(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
			cfg.StatusCodes = false
		},
		Subgraphs: testenv.SubgraphsConfig{
			Products: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.WriteHeader(http.StatusInternalServerError)
					})
				},
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id details { forename surname } notes } }`,
		})
		require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '3' at Path 'query.employees.@', Reason: empty response."}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
	})
}

func TestPartialOriginNestedGraphQLErrors(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			Products: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusForbidden)
						_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
					})
				},
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id details { forename surname } notes } }`,
		})
		require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '3' at Path 'query.employees.@'.","extensions":{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}],"statusCode":403}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
	})
}

func TestPartialOriginNestedGraphQLErrorsWithNoErrorPropagation(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
			cfg.Enabled = false
		},
		Subgraphs: testenv.SubgraphsConfig{
			Products: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusForbidden)
						_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
					})
				},
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id details { forename surname } notes } }`,
		})
		require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '3' at Path 'query.employees.@'."}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
	})
}

func TestPartialOriginNestedGraphQLErrorsWithNoErrorPropagationAndFailedFetch(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		ModifySubgraphErrorPropagation: func(cfg *config.SubgraphErrorPropagationConfiguration) {
			cfg.Enabled = false
		},
		Subgraphs: testenv.SubgraphsConfig{
			Products: testenv.SubgraphConfig{
				CloseOnStart: true,
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id details { forename surname } notes } }`,
		})
		require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '3' at Path 'query.employees.@'."}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
	})
}

func TestPartialOriginNestedGraphQLErrorsNoContentType(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			Products: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.WriteHeader(http.StatusForbidden)
						_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
					})
				},
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id details { forename surname } notes } }`,
		})
		require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '3' at Path 'query.employees.@'.","extensions":{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}],"statusCode":403}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
	})
}

func TestPartialOriginNestedGraphQLErrorsWith200OK(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			Products: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.WriteHeader(http.StatusOK)
						_, _ = w.Write([]byte(`{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}]}`))
					})
				},
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id details { forename surname } notes } }`,
		})
		require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '3' at Path 'query.employees.@'.","extensions":{"errors":[{"message":"Unauthorized","extensions":{"code":"UNAUTHORIZED"}}],"statusCode":200}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
	})
}

func TestPartialOriginNestedGraphQLErrorsWithInvalidJSON(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			Products: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.WriteHeader(http.StatusUnauthorized)
						_, _ = w.Write([]byte(`unauthorized`))
					})
				},
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id details { forename surname } notes } }`,
		})
		require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '3' at Path 'query.employees.@', Reason: invalid JSON.","extensions":{"statusCode":401}}],"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"},"notes":null},{"id":2,"details":{"forename":"Dustin","surname":"Deus"},"notes":null},{"id":3,"details":{"forename":"Stefan","surname":"Avram"},"notes":null},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"},"notes":null},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"},"notes":null},{"id":7,"details":{"forename":"Suvij","surname":"Surya"},"notes":null},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"},"notes":null},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"},"notes":null},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"},"notes":null},{"id":12,"details":{"forename":"David","surname":"Stutt"},"notes":null}]}}`, res.Body)
	})
}

func TestWithOriginErrors(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			Employees: testenv.SubgraphConfig{
				CloseOnStart: true,
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id details { forename surname } notes } }`,
		})
		require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '0' at Path 'query'."}],"data":null}`, res.Body)
	})
}

func TestWithOriginErrors500(t *testing.T) {
	t.Parallel()
	testenv.Run(t, &testenv.Config{
		Subgraphs: testenv.SubgraphsConfig{
			Employees: testenv.SubgraphConfig{
				Middleware: func(handler http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.WriteHeader(http.StatusInternalServerError)
					})
				},
			},
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id details { forename surname } notes } }`,
		})
		require.Equal(t, `{"errors":[{"message":"Failed to fetch from Subgraph '0' at Path 'query', Reason: empty response.","extensions":{"statusCode":500}}],"data":null}`, res.Body)
	})
}
