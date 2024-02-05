package integration

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestRateLimit(t *testing.T) {
	t.Run("disabled", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithRateLimitConfig(&config.RateLimitConfiguration{
					Enabled: false,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.JSONEq(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		})
	})
	t.Run("enabled - below limit", func(t *testing.T) {
		key := uuid.New().String()
		t.Cleanup(func() {
			client := redis.NewClient(&redis.Options{Addr: "localhost:6379", Password: "test"})
			del := client.Del(context.Background(), key)
			require.NoError(t, del.Err())
		})
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithRateLimitConfig(&config.RateLimitConfiguration{
					Enabled:  true,
					Strategy: "simple",
					SimpleStrategy: config.RateLimitSimpleStrategy{
						Rate:                             1,
						Burst:                            1,
						Period:                           time.Second * 2,
						RejectExceedingRateLimitRequests: false,
					},
					Storage: config.RedisConfiguration{
						Addr:      "localhost:6379",
						Password:  "test",
						KeyPrefix: key,
					},
					Debug: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.Equal(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}},"extensions":{"rateLimit":{"remaining":0,"retryAfterSeconds":0,"resetAfterSeconds":1}}}`, res.Body)
		})
	})
	t.Run("enabled - above limit", func(t *testing.T) {
		key := uuid.New().String()
		t.Cleanup(func() {
			client := redis.NewClient(&redis.Options{Addr: "localhost:6379", Password: "test"})
			del := client.Del(context.Background(), key)
			require.NoError(t, del.Err())
		})
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithRateLimitConfig(&config.RateLimitConfiguration{
					Enabled:  true,
					Strategy: "simple",
					SimpleStrategy: config.RateLimitSimpleStrategy{
						Rate:                             2,
						Burst:                            2,
						Period:                           time.Second * 2,
						RejectExceedingRateLimitRequests: false,
					},
					Storage: config.RedisConfiguration{
						Addr:      "localhost:6379",
						Password:  "test",
						KeyPrefix: key,
					},
					Debug: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.Equal(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}},"extensions":{"rateLimit":{"remaining":1,"retryAfterSeconds":0,"resetAfterSeconds":0}}}`, res.Body)
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.Equal(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}},"extensions":{"rateLimit":{"remaining":0,"retryAfterSeconds":0,"resetAfterSeconds":1}}}`, res.Body)
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.Equal(t, `{"errors":[{"message":"Rate limit exceeded for Subgraph '0' at path 'query'."}],"data":null,"extensions":{"rateLimit":{"remaining":0,"retryAfterSeconds":0,"resetAfterSeconds":1}}}`, res.Body)
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.Equal(t, `{"errors":[{"message":"Rate limit exceeded for Subgraph '0' at path 'query'."}],"data":null,"extensions":{"rateLimit":{"remaining":0,"retryAfterSeconds":0,"resetAfterSeconds":1}}}`, res.Body)
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.Equal(t, `{"errors":[{"message":"Rate limit exceeded for Subgraph '0' at path 'query'."}],"data":null,"extensions":{"rateLimit":{"remaining":0,"retryAfterSeconds":0,"resetAfterSeconds":1}}}`, res.Body)
		})
	})
	t.Run("enabled - below limit with nesting", func(t *testing.T) {
		key := uuid.New().String()
		t.Cleanup(func() {
			client := redis.NewClient(&redis.Options{Addr: "localhost:6379", Password: "test"})
			del := client.Del(context.Background(), key)
			require.NoError(t, del.Err())
		})
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithRateLimitConfig(&config.RateLimitConfiguration{
					Enabled:  true,
					Strategy: "simple",
					SimpleStrategy: config.RateLimitSimpleStrategy{
						Rate:                             4,
						Burst:                            4,
						Period:                           time.Second * 2,
						RejectExceedingRateLimitRequests: false,
					},
					Storage: config.RedisConfiguration{
						Addr:      "localhost:6379",
						Password:  "test",
						KeyPrefix: key,
					},
					Debug: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: bigNestedQuery,
			})
			require.Equal(t, `{"data":{"products":[{"__typename":"Consultancy","upc":"consultancy","lead":{"id":1,"details":{"surname":"Neuse","forename":"Jens"}}},{"__typename":"Cosmo","engineers":[{"details":{"forename":"Jens"}},{"details":{"forename":"Dustin"}},{"details":{"forename":"Sergiy"}},{"details":{"forename":"Suvij"}},{"details":{"forename":"Nithin"}},{"details":{"forename":"Eelco"}},{"details":{"forename":"David"}}]},{"__typename":"SDK"}],"employees":[{"id":1,"role":{"title":["Founder","CEO"],"__typename":"Engineer","engineerType":"BACKEND"},"details":{"pets":null}},{"id":2,"role":{"title":["Co-founder","Tech Lead"],"__typename":"Engineer","engineerType":"FULLSTACK"},"details":{"pets":null}},{"id":3,"role":{"title":["Co-founder","Head of Growth"]},"details":{"pets":[{"class":"REPTILE","name":"Snappy"}]}},{"id":4,"role":{"title":["Co-founder","COO"]},"details":{"pets":[{},{}]}},{"id":5,"role":{"title":["Senior GO Engineer"],"__typename":"Engineer","engineerType":"BACKEND"},"details":{"pets":[{"__typename":"Cat"},{"__typename":"Cat"},{"__typename":"Cat"},{"__typename":"Cat"},{"__typename":"Cat"},{"__typename":"Cat"},{"__typename":"Cat"},{"__typename":"Cat"},{"__typename":"Cat"},{"__typename":"Cat"}]}},{"id":7,"role":{"title":["Software Engineer"],"__typename":"Engineer","engineerType":"FULLSTACK"},"details":{"pets":null}},{"id":8,"role":{"title":["Software Engineer"],"__typename":"Engineer","engineerType":"FULLSTACK"},"details":{"pets":null}},{"id":10,"role":{"title":["Senior Frontend Engineer"],"__typename":"Engineer","engineerType":"FRONTEND"},"details":{"pets":[{}]}},{"id":11,"role":{"title":["Accounting \u0026 Finance"]},"details":{"pets":null}},{"id":12,"role":{"title":["Software Engineer"],"__typename":"Engineer","engineerType":"FULLSTACK"},"details":{"pets":[{"__typename":"Cat"}]}}]},"extensions":{"rateLimit":{"remaining":2,"retryAfterSeconds":0,"resetAfterSeconds":0}}}`, res.Body)
		})
	})
	t.Run("enabled - above limit with nesting", func(t *testing.T) {
		key := uuid.New().String()
		t.Cleanup(func() {
			client := redis.NewClient(&redis.Options{Addr: "localhost:6379", Password: "test"})
			del := client.Del(context.Background(), key)
			require.NoError(t, del.Err())
		})
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithRateLimitConfig(&config.RateLimitConfiguration{
					Enabled:  true,
					Strategy: "simple",
					SimpleStrategy: config.RateLimitSimpleStrategy{
						Rate:                             1,
						Burst:                            1,
						Period:                           time.Second * 2,
						RejectExceedingRateLimitRequests: false,
					},
					Storage: config.RedisConfiguration{
						Addr:      "localhost:6379",
						Password:  "test",
						KeyPrefix: key,
					},
					Debug: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: bigNestedQuery,
			})
			require.Equal(t, `{"errors":[{"message":"Rate limit exceeded for Subgraph '1' at path 'query.employees.@'."}],"data":{"products":[{"__typename":"Consultancy","upc":"consultancy","lead":{"id":1,"details":{"surname":"Neuse","forename":"Jens"}}},{"__typename":"Cosmo","engineers":[{"details":{"forename":"Jens"}},{"details":{"forename":"Dustin"}},{"details":{"forename":"Sergiy"}},{"details":{"forename":"Suvij"}},{"details":{"forename":"Nithin"}},{"details":{"forename":"Eelco"}},{"details":{"forename":"David"}}]},{"__typename":"SDK"}],"employees":[{"id":1,"role":{"title":["Founder","CEO"],"__typename":"Engineer","engineerType":"BACKEND"},"details":null},{"id":2,"role":{"title":["Co-founder","Tech Lead"],"__typename":"Engineer","engineerType":"FULLSTACK"},"details":null},{"id":3,"role":{"title":["Co-founder","Head of Growth"]},"details":null},{"id":4,"role":{"title":["Co-founder","COO"]},"details":null},{"id":5,"role":{"title":["Senior GO Engineer"],"__typename":"Engineer","engineerType":"BACKEND"},"details":null},{"id":7,"role":{"title":["Software Engineer"],"__typename":"Engineer","engineerType":"FULLSTACK"},"details":null},{"id":8,"role":{"title":["Software Engineer"],"__typename":"Engineer","engineerType":"FULLSTACK"},"details":null},{"id":10,"role":{"title":["Senior Frontend Engineer"],"__typename":"Engineer","engineerType":"FRONTEND"},"details":null},{"id":11,"role":{"title":["Accounting \u0026 Finance"]},"details":null},{"id":12,"role":{"title":["Software Engineer"],"__typename":"Engineer","engineerType":"FULLSTACK"},"details":null}]},"extensions":{"rateLimit":{"remaining":0,"retryAfterSeconds":0,"resetAfterSeconds":1}}}`, res.Body)
		})
	})
	t.Run("enabled - above limit with nesting and reject", func(t *testing.T) {
		key := uuid.New().String()
		t.Cleanup(func() {
			client := redis.NewClient(&redis.Options{Addr: "localhost:6379", Password: "test"})
			del := client.Del(context.Background(), key)
			require.NoError(t, del.Err())
		})
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithRateLimitConfig(&config.RateLimitConfiguration{
					Enabled:  true,
					Strategy: "simple",
					SimpleStrategy: config.RateLimitSimpleStrategy{
						Rate:                             1,
						Burst:                            1,
						Period:                           time.Second * 2,
						RejectExceedingRateLimitRequests: true,
					},
					Storage: config.RedisConfiguration{
						Addr:      "localhost:6379",
						Password:  "test",
						KeyPrefix: key,
					},
					Debug: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: bigNestedQuery,
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusTooManyRequests, res.Response.StatusCode)
			require.Equal(t, `{}`, res.Body)
		})
	})
}

const (
	bigNestedQuery = `query Demo {
  products {
    __typename
    ... on Consultancy {
      upc
      lead {
        id
        details {
          surname
          forename
        }
      }
    }
    ... on Cosmo {
      engineers {
        details {
          forename
        }
      }
    }
  }
  employees {
    id
    role {
      title
      ... on Engineer {
        __typename
        title
        engineerType
      }
    }
    details {
      pets {
        ... on Alligator {
          class
          name
        }
        ... on Cat {
          __typename
        }
      }
    }
  }
}
`
)
