package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/freeport"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestResponseCacheRedis(t *testing.T) {
	t.Parallel()

	t.Run("a second identical request does not reach the subgraph", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(t, time.Minute),
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

		disabled := responseCacheConfig(t, time.Minute)
		disabled.Enabled = false

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{responseCacheStorageProviders(), core.WithResponseCache(disabled)},
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
			RouterOptions: responseCacheOptions(t, time.Minute),
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
			RouterOptions: responseCacheOptions(t, time.Minute),
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
			RouterOptions: responseCacheOptions(t, time.Minute),
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
			RouterOptions: responseCacheOptions(t, time.Minute),
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
			RouterOptions: responseCacheOptions(t, time.Minute),
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
			RouterOptions: responseCacheOptions(t, time.Minute),
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
			RouterOptions: responseCacheOptions(t, time.Minute),
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
			RouterOptions: responseCacheOptions(t, time.Minute),
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
func TestRootFetchResponseCacheRedis(t *testing.T) {
	t.Parallel()

	t.Run("a second identical request does not reach the subgraph", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(t, time.Minute),
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
			RouterOptions: responseCacheOptions(t, time.Minute),
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
			RouterOptions: append(responseCacheOptions(t, time.Minute),
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
			RouterOptions: responseCacheOptions(t, time.Minute),
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
			RouterOptions: responseCacheOptions(t, time.Minute),
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
			RouterOptions: responseCacheOptions(t, time.Minute),
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
			RouterOptions: responseCacheOptions(t, time.Minute),
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

func TestResponseCacheTags(t *testing.T) {
	t.Parallel()

	// One tag list per entity, in the order the batch answered them, which is
	// the order the router asked for them in.
	// __typename on every entity, as the router's own entity fetch selection
	// asks for it whether or not the client query did.
	const entity = `{"__typename":"Employee","currentMood":"HAPPY"},`
	const taggedMoodBatch = `{"data":{"_entities":[` +
		entity + entity + entity + entity + entity +
		entity + entity + entity + entity +
		`{"__typename":"Employee","currentMood":"HAPPY"}` +
		`]},"extensions":{"apolloEntityCacheTags":[` +
		`["moods","employee-1"],["moods","employee-2"],["moods","employee-3"],` +
		`["moods","employee-4"],["moods","employee-5"],["moods","employee-6"],` +
		`["moods","employee-7"],["moods","employee-8"],["moods","employee-9"],` +
		`["moods","employee-10"]` +
		`]}}`

	t.Run("a tagged response is cached exactly as an untagged one", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(t, time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: fixedResponseMiddleware("public, max-age=60", taggedMoodBatch),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})

			require.Equal(t, first.Body, second.Body)
			require.Contains(t, first.Body, `"currentMood":"HAPPY"`)
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(),
				"the second request must still be served from the cache")
		})
	})

	t.Run("the index names every entry under what it is about", func(t *testing.T) {
		t.Parallel()

		cfg := responseCacheConfig(t, time.Minute)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{responseCacheStorageProviders(), core.WithResponseCache(cfg)},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: fixedResponseMiddleware("public, max-age=60", taggedMoodBatch),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})

			entries, tags := responseCacheStored(t, cfg.KeyPrefix)
			require.Len(t, entries, 10, "one entry per entity in the batch")
			require.Len(t, tags, 13, "moods, the subgraph, the type, and one per entity")

			// The three namespaces name the same ten entries, each for its own
			// reason.
			require.ElementsMatch(t, entries, tags["declared:mood:moods"])
			require.ElementsMatch(t, entries, tags["subgraph:mood"])
			require.ElementsMatch(t, entries, tags["type:mood:Employee"])

			// And the per entity tag names one, which is one of those ten.
			for i := 1; i <= 10; i++ {
				tag := fmt.Sprintf("declared:mood:employee-%d", i)
				require.Len(t, tags[tag], 1, "%s must name exactly one entry", tag)
				require.Contains(t, entries, tags[tag][0])
			}

			// A subgraph declaring a tag cannot reach the router's own
			// namespaces with it.
			require.NotContains(t, tags, "moods")
			require.NotContains(t, tags, "declared:moods")
			require.NotContains(t, tags, "subgraph:moods")
		})
	})

	t.Run("a root fetch declares one flat list under its own key", func(t *testing.T) {
		t.Parallel()

		// A root fetch caches its whole answer as one entry, so its tags are
		// one flat list rather than the list per entity an entity fetch sends.
		const taggedRoot = `{"data":{"employees":[{"id":1}]},` +
			`"extensions":{"apolloCacheTags":["employees","homepage"]}}`

		cfg := responseCacheConfig(t, time.Minute)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{responseCacheStorageProviders(), core.WithResponseCache(cfg)},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: fixedResponseMiddleware("public, max-age=60", taggedRoot),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id } }`})

			entries, tags := responseCacheStored(t, cfg.KeyPrefix)
			require.Len(t, entries, 1, "the whole root fetch answer is one entry")

			require.ElementsMatch(t, entries, tags["declared:employees:employees"])
			require.ElementsMatch(t, entries, tags["declared:employees:homepage"])
			require.ElementsMatch(t, entries, tags["subgraph:employees"])

			// A root fetch's data object is a selection set rather than an
			// entity, so there is no one typename to index it under.
			for tag := range tags {
				require.NotContains(t, tag, "type:", "a root fetch has no typename of its own")
			}
		})
	})

	t.Run("a root fetch sending the entity shaped key is not tagged by it", func(t *testing.T) {
		t.Parallel()

		// The two keys are not interchangeable: reading either from the other's
		// key would make the same document mean different things.
		const nestedOnRoot = `{"data":{"employees":[{"id":1}]},` +
			`"extensions":{"apolloEntityCacheTags":[["employees","homepage"]]}}`

		cfg := responseCacheConfig(t, time.Minute)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{responseCacheStorageProviders(), core.WithResponseCache(cfg)},
			Subgraphs: testenv.SubgraphsConfig{
				Employees: testenv.SubgraphConfig{
					Middleware: fixedResponseMiddleware("public, max-age=60", nestedOnRoot),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id } }`})

			entries, tags := responseCacheStored(t, cfg.KeyPrefix)
			require.Len(t, entries, 1, "it is cached all the same")

			require.NotContains(t, tags, "declared:employees:employees")
			require.NotContains(t, tags, "declared:employees:homepage")
			require.ElementsMatch(t, entries, tags["subgraph:employees"],
				"what the router derives for itself is unaffected")
		})
	})

	t.Run("a member is scored and expires with the entry it names", func(t *testing.T) {
		t.Parallel()

		cfg := responseCacheConfig(t, time.Minute)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{responseCacheStorageProviders(), core.WithResponseCache(cfg)},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: fixedResponseMiddleware("public, max-age=60", taggedMoodBatch),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})

			entries, _ := responseCacheStored(t, cfg.KeyPrefix)
			require.NotEmpty(t, entries)

			client := redis.NewClient(&redis.Options{Addr: responseCacheRedisAddr})
			defer func() { _ = client.Close() }()
			ctx := context.Background()

			members, err := client.ZRangeWithScores(ctx, cfg.KeyPrefix+responseCacheTagNamespace+"type:mood:Employee", 0, -1).Result()
			require.NoError(t, err)
			require.Len(t, members, 10)

			for _, member := range members {
				require.Contains(t, entries, member.Member.(string),
					"every member must name an entry that is actually there")

				// Scored with when its entry expires: max-age=60.
				require.WithinDuration(t, time.Now().Add(time.Minute),
					time.UnixMilli(int64(member.Score)), 10*time.Second)
			}

			// The tag key expires too, so a tag whose members have all lapsed
			// does not stay behind as an empty set.
			ttl, err := client.TTL(ctx, cfg.KeyPrefix+responseCacheTagNamespace+"type:mood:Employee").Result()
			require.NoError(t, err)
			require.Greater(t, ttl, time.Duration(0), "the tag key must not be persistent")
		})
	})

	t.Run("the tags do not reach the client unless extensions are forwarded", func(t *testing.T) {
		t.Parallel()

		// Extension propagation is off by default, so the tags are dropped with
		// every other extension. Turning it on forwards them like any other.
		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(t, time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: fixedResponseMiddleware("public, max-age=60", taggedMoodBatch),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})

			require.Contains(t, res.Body, `"currentMood":"HAPPY"`)
			require.NotContains(t, res.Body, "apolloEntityCacheTags")
		})
	})

	t.Run("every index turned off leaves the cache working", func(t *testing.T) {
		t.Parallel()

		noIndexes := responseCacheConfig(t, time.Minute)
		noIndexes.Invalidation = config.ResponseCacheInvalidationConfig{}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{responseCacheStorageProviders(), core.WithResponseCache(noIndexes)},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: fixedResponseMiddleware("public, max-age=60", taggedMoodBatch),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})

			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(),
				"a subgraph sending tags nobody indexes is cached all the same")

			entries, tags := responseCacheStored(t, noIndexes.KeyPrefix)
			require.Len(t, entries, 10, "the entities are cached")
			require.Empty(t, tags, "and nothing is indexed")
		})
	})

	t.Run("a tag list that does not line up costs the tags, not the caching", func(t *testing.T) {
		t.Parallel()

		// Ten entities, three tag lists. Nothing is indexed, and everything is
		// still cached.
		const mismatched = `{"data":{"_entities":[` +
			`{"currentMood":"HAPPY"},{"currentMood":"HAPPY"},{"currentMood":"HAPPY"},` +
			`{"currentMood":"HAPPY"},{"currentMood":"HAPPY"},{"currentMood":"HAPPY"},` +
			`{"currentMood":"HAPPY"},{"currentMood":"HAPPY"},{"currentMood":"HAPPY"},` +
			`{"currentMood":"HAPPY"}` +
			`]},"extensions":{"apolloEntityCacheTags":[["a"],["b"],["c"]]}}`

		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(t, time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: fixedResponseMiddleware("public, max-age=60", mismatched),
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			first := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})
			second := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`})

			require.Equal(t, first.Body, second.Body)
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
		})
	})
}

func TestResponseCacheInvalidation(t *testing.T) {
	t.Parallel()

	const entity = `{"__typename":"Employee","currentMood":"HAPPY"},`
	const taggedMoodBatch = `{"data":{"_entities":[` +
		entity + entity + entity + entity + entity +
		entity + entity + entity + entity +
		`{"__typename":"Employee","currentMood":"HAPPY"}` +
		`]},"extensions":{"apolloEntityCacheTags":[` +
		`["moods","employee-1"],["moods","employee-2"],["moods","employee-3"],` +
		`["moods","employee-4"],["moods","employee-5"],["moods","employee-6"],` +
		`["moods","employee-7"],["moods","employee-8"],["moods","employee-9"],` +
		`["moods","employee-10"]` +
		`]}}`

	const moodQuery = `query { employees { id currentMood } }`

	// invalidate posts an array of requests and returns the status and count.
	invalidate := func(t *testing.T, addr, key, body string) (int, int) {
		t.Helper()

		req, err := http.NewRequest(http.MethodPost, "http://"+addr+"/invalidation", strings.NewReader(body))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		if key != "" {
			req.Header.Set("Authorization", key)
		}

		res, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer func() { _ = res.Body.Close() }()

		var decoded struct {
			Count int `json:"count"`
		}
		require.NoError(t, json.NewDecoder(res.Body).Decode(&decoded))

		return res.StatusCode, decoded.Count
	}

	// invalidatableConfig is a response cache whose entries may be invalidated
	// with responseCacheSharedKey, on a port of this test's own.
	invalidatableConfig := func(t *testing.T) (*config.ResponseCacheConfiguration, string) {
		t.Helper()

		cfg := responseCacheConfig(t, time.Minute)
		addr := fmt.Sprintf("127.0.0.1:%d", freeport.GetOne(t))

		cfg.Invalidation.Endpoint = config.ResponseCacheInvalidationEndpointConfig{
			Enabled:    true,
			ListenAddr: addr,
			Path:       "/invalidation",
			SharedKey:  responseCacheSharedKey,
		}

		return cfg, addr
	}

	moodEnv := func(cfg *config.ResponseCacheConfiguration) *testenv.Config {
		return &testenv.Config{
			RouterOptions: []core.Option{responseCacheStorageProviders(), core.WithResponseCache(cfg)},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: fixedResponseMiddleware("public, max-age=60", taggedMoodBatch),
				},
			},
		}
	}

	t.Run("a cache tag drops the entry it names and no other", func(t *testing.T) {
		t.Parallel()
		cfg, addr := invalidatableConfig(t)

		testenv.Run(t, moodEnv(cfg), func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			entries, _ := responseCacheStored(t, cfg.KeyPrefix)
			require.Len(t, entries, 10)

			status, count := invalidate(t, addr, responseCacheSharedKey,
				`[{"kind":"cache_tag","subgraphs":["mood"],"cache_tag":"employee-1"}]`)
			require.Equal(t, http.StatusAccepted, status)
			require.Equal(t, 1, count, "one entity carried that tag")

			entries, tags := responseCacheStored(t, cfg.KeyPrefix)
			require.Len(t, entries, 9, "the other nine are untouched")
			require.NotContains(t, tags, "declared:mood:employee-1", "the tag goes with the entry")
		})
	})

	t.Run("a subgraph request empties everything that subgraph answered", func(t *testing.T) {
		t.Parallel()
		cfg, addr := invalidatableConfig(t)

		testenv.Run(t, moodEnv(cfg), func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(), "the second was a hit")

			status, count := invalidate(t, addr, responseCacheSharedKey,
				`[{"kind":"subgraph","subgraph":"mood"}]`)
			require.Equal(t, http.StatusAccepted, status)
			require.Equal(t, 10, count)

			entries, _ := responseCacheStored(t, cfg.KeyPrefix)
			require.Empty(t, entries)

			// The point of all of it: the next query goes to the subgraph.
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(),
				"the entries are gone, so the subgraph is asked again")
		})
	})

	t.Run("a type request is scoped to the subgraph that answered", func(t *testing.T) {
		t.Parallel()
		cfg, addr := invalidatableConfig(t)

		testenv.Run(t, moodEnv(cfg), func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			status, count := invalidate(t, addr, responseCacheSharedKey,
				`[{"kind":"type","subgraph":"mood","type":"Employee"}]`)
			require.Equal(t, http.StatusAccepted, status)
			require.Equal(t, 10, count)

			entries, _ := responseCacheStored(t, cfg.KeyPrefix)
			require.Empty(t, entries)
		})
	})

	t.Run("naming another subgraph's type leaves this one alone", func(t *testing.T) {
		t.Parallel()
		cfg, addr := invalidatableConfig(t)

		testenv.Run(t, moodEnv(cfg), func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			// Employee is cached from mood. Asking employees to drop its
			// Employees must not touch mood's, which is the whole reason the
			// type index is scoped by subgraph.
			status, count := invalidate(t, addr, responseCacheSharedKey,
				`[{"kind":"type","subgraph":"employees","type":"Employee"}]`)
			require.Equal(t, http.StatusAccepted, status)
			require.Zero(t, count)

			entries, _ := responseCacheStored(t, cfg.KeyPrefix)
			require.Len(t, entries, 10, "mood's entries are not employees' to drop")
		})
	})

	t.Run("a wrong shared key invalidates nothing", func(t *testing.T) {
		t.Parallel()
		cfg, addr := invalidatableConfig(t)

		testenv.Run(t, moodEnv(cfg), func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			status, _ := invalidate(t, addr, "not-the-shared-key-but-long-enough-yes",
				`[{"kind":"subgraph","subgraph":"mood"}]`)
			require.Equal(t, http.StatusUnauthorized, status)

			entries, _ := responseCacheStored(t, cfg.KeyPrefix)
			require.Len(t, entries, 10)
		})
	})

	t.Run("a disabled index is refused rather than answered with nothing", func(t *testing.T) {
		t.Parallel()
		cfg, addr := invalidatableConfig(t)
		cfg.Invalidation.Type = false

		testenv.Run(t, moodEnv(cfg), func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			status, _ := invalidate(t, addr, responseCacheSharedKey,
				`[{"kind":"type","subgraph":"mood","type":"Employee"}]`)
			require.Equal(t, http.StatusBadRequest, status)

			// And the index really was not built, which is why it was refused.
			_, tags := responseCacheStored(t, cfg.KeyPrefix)
			require.NotContains(t, tags, "type:mood:Employee")
		})
	})

	t.Run("one bad element leaves the rest of the array unapplied", func(t *testing.T) {
		t.Parallel()
		cfg, addr := invalidatableConfig(t)

		testenv.Run(t, moodEnv(cfg), func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			status, _ := invalidate(t, addr, responseCacheSharedKey,
				`[{"kind":"subgraph","subgraph":"mood"},{"kind":"nonsense"}]`)
			require.Equal(t, http.StatusBadRequest, status)

			entries, _ := responseCacheStored(t, cfg.KeyPrefix)
			require.Len(t, entries, 10, "the valid element must not have been applied either")
		})
	})

	t.Run("nothing listens when the endpoint is not enabled", func(t *testing.T) {
		t.Parallel()

		cfg := responseCacheConfig(t, time.Minute)
		addr := fmt.Sprintf("127.0.0.1:%d", freeport.GetOne(t))

		testenv.Run(t, moodEnv(cfg), func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			req, err := http.NewRequest(http.MethodPost, "http://"+addr+"/invalidation",
				strings.NewReader(`[{"kind":"subgraph","subgraph":"mood"}]`))
			require.NoError(t, err)

			_, err = http.DefaultClient.Do(req)
			require.Error(t, err, "the endpoint must not be listening at all")
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

// responseCacheConfig builds a redis backed response cache namespaced to this
// test.
func responseCacheConfig(t *testing.T, ttl time.Duration) *config.ResponseCacheConfiguration {
	t.Helper()

	// Unique per test: one redis is shared, and without a prefix of its own one
	// test's write would answer another's expected miss. Nothing cleans these
	// up, because every key written carries the entry's own TTL.
	prefix := "response_cache_test:" + uuid.New().String() + ":"

	return &config.ResponseCacheConfiguration{
		Enabled:     true,
		FallbackTTL: ttl,
		KeyPrefix:   prefix,
		Storage: config.ResponseCacheStorageConfig{
			Provider:   config.ResponseCacheStorageProviderRedis,
			ProviderID: responseCacheRedisProviderID,
		},
		// Set explicitly: envDefault only reaches config parsed from yaml.
		Invalidation: config.ResponseCacheInvalidationConfig{
			CacheTag: true,
			Subgraph: true,
			Type:     true,
		},
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

const responseCacheSharedKey = "a-shared-key-that-is-long-enough-to-pass"

const (
	responseCacheRedisAddr       = "localhost:6379"
	responseCacheRedisURL        = "redis://" + responseCacheRedisAddr
	responseCacheRedisProviderID = "response-cache-redis"
)

func responseCacheStorageProviders() core.Option {
	return core.WithStorageProviders(config.StorageProviders{
		Redis: []config.RedisStorageProvider{
			{URLs: []string{responseCacheRedisURL}, ID: responseCacheRedisProviderID},
		},
	})
}

func responseCacheOptions(t *testing.T, ttl time.Duration) []core.Option {
	t.Helper()
	return []core.Option{responseCacheStorageProviders(), core.WithResponseCache(responseCacheConfig(t, ttl))}
}

// The segments the redis adapter keeps entries and tag indexes in, under the
// configured key prefix.
const (
	responseCacheEntryNamespace = "e:"
	responseCacheTagNamespace   = "t:"
)

// responseCacheStored reads back what a test wrote, split into the entries
// themselves and the tag index over them, both with the prefix stripped.
func responseCacheStored(t *testing.T, prefix string) (entries []string, tags map[string][]string) {
	t.Helper()

	client := redis.NewClient(&redis.Options{Addr: responseCacheRedisAddr})
	defer func() { _ = client.Close() }()

	ctx := context.Background()
	tags = make(map[string][]string)
	// SCAN may hand the same key back on more than one iteration, so a key is
	// only counted the first time it is seen.
	seen := make(map[string]struct{})

	for cursor := uint64(0); ; {
		keys, next, err := client.Scan(ctx, cursor, prefix+"*", 512).Result()
		require.NoError(t, err)

		for _, key := range keys {
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}

			name := strings.TrimPrefix(key, prefix)

			if tag, isTag := strings.CutPrefix(name, responseCacheTagNamespace); isTag {
				members, err := client.ZRange(ctx, key, 0, -1).Result()
				require.NoError(t, err)
				tags[tag] = members
				continue
			}
			entries = append(entries, strings.TrimPrefix(name, responseCacheEntryNamespace))
		}

		if next == 0 {
			return entries, tags
		}
		cursor = next
	}
}
