package integration

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestResponseCacheInMemory(t *testing.T) {
	t.Parallel()

	t.Run("a second identical request does not reach the subgraph", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, max-age=60"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})

			// The bodies, not just the counter: a cache that served the wrong
			// bytes would satisfy the counter on its own.
			require.Equal(t, first.Body, second.Body)
			require.Contains(t, first.Body, `"currentMood"`)

			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(),
				"the second request must be served from the cache")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Employees.Load(),
				"the root fetch is cacheable too, but employees answers without a Cache-Control header, so it is not cached")
		})
	})

	t.Run("the cache is off unless it is configured", func(t *testing.T) {
		t.Parallel()

		// The control for the subtest above. Without it, a passing count of 1 up
		// there could equally be the normalization cache or single flight, and
		// the test would prove nothing about response caching.
		testenv.Run(t, &testenv.Config{
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, max-age=60"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})

			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(),
				"with no response cache configured every request must reach the subgraph")
		})
	})

	t.Run("a disabled cache always reaches the subgraph", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithResponseCache(&config.ResponseCacheConfiguration{
					Enabled:     false,
					FallbackTTL: time.Minute,
					Storage: config.ResponseCacheStorageConfig{
						Provider:   config.ResponseCacheStorageProviderMemory,
						MaxEntries: 1000,
					},
				}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, max-age=60"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})

			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())
		})
	})

	t.Run("different selection sets do not share an entry", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Family: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, max-age=60"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// The two queries differ only in which field of Details they ask for,
			// and both fields are family's alone: the employees subgraph's own
			// Details has forename, location, surname and pastLocations and nothing
			// else, so neither of these can be answered without reaching family.
			children := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id details { hasChildren } } }`})
			marital := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id details { maritalStatus } } }`})

			require.NotEqual(t, children.Body, marital.Body)
			require.Contains(t, children.Body, `"hasChildren"`)
			require.Contains(t, marital.Body, `"maritalStatus"`)

			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Family.Load(),
				"the same entities asked for different fields must not share a cache entry")

			// And the second query is itself cached now, which is what makes the
			// count above a keying result rather than the cache simply not working.
			repeat := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id details { maritalStatus } } }`})
			require.Equal(t, marital.Body, repeat.Body)
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Family.Load())
		})
	})

	t.Run("a single entity fetch is cached", func(t *testing.T) {
		t.Parallel()

		// Distinct from the batch cases above because the planner gives a single
		// entity fetch its own response shape to select from, and the engine reads
		// the cacheable entities out of the wire shape rather than that selection.
		// Reading the selection instead yields one object where the array is
		// expected, and nothing is ever cached.
		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, max-age=60"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employee(id: 1) { id currentMood } }`})
			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employee(id: 1) { id currentMood } }`})

			require.Equal(t, first.Body, second.Body)
			require.Contains(t, first.Body, `"currentMood"`)

			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(),
				"a single entity fetch must be cached just as a batch of one would be")
		})
	})

	t.Run("a partially cached batch is refetched whole", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, max-age=60"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Caches employee 1 alone.
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employee(id: 1) { id currentMood } }`})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			// Asks for every employee. Employee 1 is cached and the rest are not,
			// and a batch is served from the cache only when every entity in it is
			// present, so this goes to the subgraph unchanged.
			all := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(),
				"one miss in a batch must send the whole batch to the subgraph")

			// Now the whole batch is cached, so the same query is a full hit.
			again := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			require.Equal(t, all.Body, again.Body)
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())
		})
	})

	t.Run("public with no max-age is cached for the configured ttl", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})

			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(),
				"a bare public is cacheable and falls back to the configured ttl")
		})
	})

	t.Run("max-age wins over the configured ttl", func(t *testing.T) {
		t.Parallel()

		// The configured ttl is a minute and the subgraph asks for a second. If
		// the configured ttl were the one applied, the entry would still be there
		// when this gives up.
		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, max-age=1"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			// Immediately, so it is still inside the second the subgraph asked for.
			// This is the half that fails if nothing was ever cached.
			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			require.Equal(t, first.Body, second.Body)
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(),
				"the entity should have been cached before its lifetime ran out")

			// And this is the half that fails if the configured minute were applied
			// instead of the second the subgraph named. Polled rather than slept on,
			// because the in memory cache's expiry is only granular to about a
			// second, and a fixed wait on a one second entry is exactly the shape
			// that fails once in a hundred runs.
			require.Eventually(t, func() bool {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
				return xEnv.SubgraphRequestCount.Mood.Load() >= 2
			}, 15*time.Second, 250*time.Millisecond,
				"the cached entity should have expired and been fetched again")
		})
	})

	t.Run("s-maxage wins over max-age", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, s-maxage=1, max-age=60"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			// Immediately, so it is still inside the second s-maxage asked for. This
			// is the half that fails if nothing was ever cached.
			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			require.Equal(t, first.Body, second.Body)
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(),
				"the entity should have been cached before its lifetime ran out")

			// And this is the half that fails if the max-age of sixty were applied
			// instead of the s-maxage of one. Polled rather than slept on, because
			// the in memory cache's expiry is only granular to about a second, and a
			// fixed wait on a one second entry is exactly the shape that fails once
			// in a hundred runs.
			require.Eventually(t, func() bool {
				xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
				return xEnv.SubgraphRequestCount.Mood.Load() >= 2
			}, 15*time.Second, 250*time.Millisecond,
				"the cached entity should have expired and been fetched again")
		})
	})

	t.Run("a failed subgraph response is not cached", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: func(http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							w.Header().Set("Cache-Control", "public, max-age=60")
							w.WriteHeader(http.StatusInternalServerError)
						})
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			require.NoError(t, err)
			require.Contains(t, first.Body, `"errors"`)

			second, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			require.NoError(t, err)
			require.Contains(t, second.Body, `"errors"`)

			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(),
				"a failed subgraph response must not be cached however cacheable it claims to be")
		})
	})
	t.Run("the entities a batch did answer are cached even when one of them is null", func(t *testing.T) {
		t.Parallel()

		moodBatchWithNullEmployee1 := `{"data":{"_entities":[` +
			`null,` +
			`{"currentMood":"HAPPY"},{"currentMood":"HAPPY"},{"currentMood":"HAPPY"},` +
			`{"currentMood":"HAPPY"},{"currentMood":"HAPPY"},{"currentMood":"HAPPY"},` +
			`{"currentMood":"HAPPY"},{"currentMood":"HAPPY"},{"currentMood":"HAPPY"}` +
			`]}}`

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: fixedResponseMiddleware("public, max-age=60", moodBatchWithNullEmployee1),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// The batch carrying the null. currentMood is non null in the schema, so
			// employee 1 nulls out of the response while the other nine are answered
			// in full.
			batch, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			require.NoError(t, err)
			require.Contains(t, batch.Body, `"currentMood":"HAPPY"`)
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			// Operations is employees 4 and 11, both of them entities the batch above
			// answered, and neither of them the one that came back null. Their batch
			// is a full hit only if the null next to them did not throw their entries
			// away with it.
			ops := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { teammates(team: OPERATIONS) { id currentMood } }`})
			require.Contains(t, ops.Body, `"currentMood":"HAPPY"`)
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(),
				"the entities the subgraph did answer must be cached even though one of their batch was null")

			// And the null itself was not cached, which is what makes the hit above a
			// partial write rather than the whole batch having been stored null and
			// all.
			repeat, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			require.NoError(t, err)
			require.Equal(t, batch.Body, repeat.Body)
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(),
				"a batch containing an entity that was never cached must go back to the subgraph")
		})
	})
}

// A root query fetch is cached as one entry holding its whole answer, so what is
// keyed is the request the router sent rather than any one entity in the answer.
func TestRootFetchResponseCacheInMemory(t *testing.T) {
	t.Parallel()

	t.Run("a second identical request does not reach the subgraph", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, max-age=60"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			const query = `query { employees { id } }`

			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})

			// The bodies, not just the counter: a cache that served the wrong
			// bytes would satisfy the counter on its own.
			require.Equal(t, first.Body, second.Body)
			require.Contains(t, first.Body, `"employees"`)
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Employees.Load(),
				"the second request must be served from the cache")
		})
	})

	t.Run("different variable values do not share an entry", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, max-age=60"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			const query = `query Employee($id: Int!) { employee(id: $id) { id } }`

			one := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query, Variables: json.RawMessage(`{"id":1}`)})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query, Variables: json.RawMessage(`{"id":1}`)})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Employees.Load(),
				"the same variables must be served from the cache")

			another := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query, Variables: json.RawMessage(`{"id":2}`)})

			require.NotEqual(t, one.Body, another.Body)
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Employees.Load(),
				"the variables are part of the request, so they are part of the key")
		})
	})

	t.Run("forwarded headers do not separate entries", func(t *testing.T) {
		t.Parallel()

		// Pins today's behaviour rather than endorsing it. The cache key is built
		// from the request the router renders for the subgraph, and header
		// propagation runs after that, so a propagated header never reaches the
		// key. A subgraph whose answer varies by header must therefore not mark
		// that answer public, or one caller is served another caller's response.
		testenv.Run(t, &testenv.Config{
			RouterOptions: append(responseCacheOptions(time.Minute),
				core.WithHeaderRules(config.HeaderRules{
					All: &config.GlobalHeaderRule{
						Request: []*config.RequestHeaderRule{
							{Operation: config.HeaderRuleOperationPropagate, Named: "X-Tenant"},
						},
					},
				}),
			),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, max-age=60"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			forTenant := func(tenant string) *testenv.TestResponse {
				return xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:  `query { employees { id } }`,
					Header: http.Header{"X-Tenant": []string{tenant}},
				})
			}

			one := forTenant("one")
			another := forTenant("another")

			require.Equal(t, one.Body, another.Body)
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Employees.Load(),
				"the second tenant is served the first tenant's entry, which is why a "+
					"header dependent answer must not be marked public")
		})
	})

	t.Run("a root fetch the subgraph did not mark cacheable is not cached", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("private, max-age=60"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			const query = `query { employees { id } }`

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})

			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Employees.Load(),
				"private names a cache that belongs to one client, which this is not")
		})
	})

	t.Run("several root fields answered by one subgraph are one entry", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, max-age=60"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			const both = `query { employees { id } firstEmployee { id } }`
			const narrower = `query { employees { id } }`

			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: both})
			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: both})

			require.Equal(t, first.Body, second.Body)
			require.Contains(t, first.Body, `"firstEmployee"`)
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Employees.Load(),
				"the planner asks for both root fields in one fetch, and one fetch is one entry")

			third := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: narrower})

			// The entry is the whole answer, so nothing can be taken out of it.
			// A cache that served the wider entry here would answer with a field
			// this operation never selected.
			require.NotContains(t, third.Body, `"firstEmployee"`)
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Employees.Load(),
				"a narrower operation is a different request, so it is a miss even though its field sits inside the cached entry")

			fourth := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: narrower})

			require.Equal(t, third.Body, fourth.Body)
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Employees.Load(),
				"the narrower operation then keeps an entry of its own")
		})
	})

	t.Run("root fields answered by different subgraphs are cached separately", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, max-age=60"),
				},
				Family: testenv.SubgraphConfig{
					Middleware: cacheControlMiddleware("public, max-age=60"),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// One operation, two root fetches: employees to the employees
			// subgraph and findEmployees to the family one.
			const query = `query { employees { id } findEmployees(criteria: {nested: {maritalStatus: MARRIED}}) { id } }`

			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})

			require.Equal(t, first.Body, second.Body)
			require.Contains(t, first.Body, `"findEmployees"`)

			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Employees.Load(),
				"each root fetch is keyed by its own request, so each is its own entry")
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Family.Load(),
				"each root fetch is keyed by its own request, so each is its own entry")
		})
	})
}

// TestResponseCacheWithMultiFetch pins what engine.enable_multi_fetch costs the
// response cache. The merged entity fetch it produces is not cached and nothing
// reports that it was skipped, while the root query fetch of the same operation
// is cached as it would be without the flag.
func TestResponseCacheWithMultiFetch(t *testing.T) {
	t.Parallel()

	const query = `query Requires {
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
	  findEmployees(criteria: {nested: {maritalStatus: MARRIED}}) {
		id
	  }
	}`

	t.Run("the merged entity fetch is re-sent on every request", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(time.Minute),
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.EnableMultiFetch = true
			},
			Subgraphs: testenv.SubgraphsConfig{
				Employees:    testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
				Family:       testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
				Mood:         testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
				Availability: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Employees.Load(),
				"the first request is a miss throughout: the root fetch, then the two entity fetches merged into one")
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Family.Load(),
				"and the other root fetch")

			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: query})

			require.Equal(t, first.Body, second.Body)
			require.Contains(t, first.Body, `"derivedMood"`)
			require.Contains(t, first.Body, `"isLeadAvailable"`)
			require.Contains(t, first.Body, `"findEmployees"`)

			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Family.Load(),
				"enable_multi_fetch has nothing to merge here and leaves root caching alone")
			require.EqualValues(t, 3, xEnv.SubgraphRequestCount.Employees.Load(),
				"the merged entity fetch is re-sent, so it was never cached")

			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(),
				"an entity fetch with nothing to merge with is cached as usual")
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Availability.Load(),
				"an entity fetch with nothing to merge with is cached as usual")
		})
	})
}

func fixedResponseMiddleware(cacheControl, body string) func(http.Handler) http.Handler {
	return func(http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", cacheControl)
			_, _ = w.Write([]byte(body))
		})
	}
}

// responseCacheOptions enables the response cache on the in memory provider. ttl is
// the fallback reached only by a response that says public without saying for how
// long; a response naming its own max-age gets that instead.
func responseCacheOptions(ttl time.Duration) []core.Option {
	return []core.Option{
		core.WithResponseCache(&config.ResponseCacheConfiguration{
			Enabled:     true,
			FallbackTTL: ttl,
			// Set explicitly. An empty provider means redis, which would need a
			// server these tests deliberately do not have.
			Storage: config.ResponseCacheStorageConfig{
				Provider:   config.ResponseCacheStorageProviderMemory,
				MaxEntries: 1000,
			},
		}),
	}
}

// cacheControlMiddleware makes a subgraph answer with the given Cache-Control.
// The header is set before the handler runs, because the handler writes the body
// and a header set after that is a header nobody receives.
func cacheControlMiddleware(value string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if value != "" {
				w.Header().Set("Cache-Control", value)
			}
			next.ServeHTTP(w, r)
		})
	}
}
