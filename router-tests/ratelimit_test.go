package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/jwks"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestRateLimit(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	t.Parallel()

	t.Run("disabled", func(t *testing.T) {
		t.Parallel()

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
	t.Run("disabled should not require redis", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithRateLimitConfig(&config.RateLimitConfiguration{
					Enabled: false,
					Storage: config.RedisConfiguration{
						URLs:      []string{"redis://localhost:1"},
						KeyPrefix: "non",
					},
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
		t.Parallel()

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
						Rate:                    1,
						Burst:                   1,
						Period:                  time.Second * 2,
						RejectExceedingRequests: false,
					},
					Storage: config.RedisConfiguration{
						URLs:      []string{"redis://localhost:6379"},
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
			require.Equal(t, fmt.Sprintf(`{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}},"extensions":{"rateLimit":{"key":"%s","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
		})
	})
	t.Run("enabled - header key", func(t *testing.T) {
		t.Parallel()

		key := uuid.New().String()
		t.Cleanup(func() {
			client := redis.NewClient(&redis.Options{Addr: "localhost:6379", Password: "test"})
			del := client.Del(context.Background(), fmt.Sprintf("%s:localhost", key))
			require.NoError(t, del.Err())
		})
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithRateLimitConfig(&config.RateLimitConfiguration{
					Enabled:  true,
					Strategy: "simple",
					SimpleStrategy: config.RateLimitSimpleStrategy{
						Rate:                    1,
						Burst:                   1,
						Period:                  time.Second * 2,
						RejectExceedingRequests: false,
					},
					Storage: config.RedisConfiguration{
						URLs:      []string{"redis://localhost:6379"},
						KeyPrefix: key,
					},
					Debug:               true,
					KeySuffixExpression: "request.header.Get('X-Forwarded-For')",
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			}, map[string]string{
				"X-Forwarded-For": "localhost",
			})
			require.NoError(t, err)
			require.Equal(t, fmt.Sprintf(`{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}},"extensions":{"rateLimit":{"key":"%s:localhost","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
		})
	})
	t.Run("enabled - custom key works as discriminator", func(t *testing.T) {
		t.Parallel()

		key := uuid.New().String()
		t.Cleanup(func() {
			client := redis.NewClient(&redis.Options{Addr: "localhost:6379", Password: "test"})
			del := client.Del(context.Background(), fmt.Sprintf("%s:foo", key))
			require.NoError(t, del.Err())
			del = client.Del(context.Background(), fmt.Sprintf("%s:bar", key))
			require.NoError(t, del.Err())
		})
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithRateLimitConfig(&config.RateLimitConfiguration{
					Enabled:  true,
					Strategy: "simple",
					SimpleStrategy: config.RateLimitSimpleStrategy{
						Rate:                    1,
						Burst:                   1,
						Period:                  time.Second * 2,
						RejectExceedingRequests: false,
					},
					Storage: config.RedisConfiguration{
						URLs:      []string{"redis://localhost:6379"},
						KeyPrefix: key,
					},
					Debug:               true,
					KeySuffixExpression: "request.header.Get('X-Forwarded-For')",
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			}, map[string]string{
				"X-Forwarded-For": "foo",
			})
			require.NoError(t, err)
			require.Equal(t, fmt.Sprintf(`{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}},"extensions":{"rateLimit":{"key":"%s:foo","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
			res, err = xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			}, map[string]string{
				"X-Forwarded-For": "bar",
			})
			require.NoError(t, err)
			require.Equal(t, fmt.Sprintf(`{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}},"extensions":{"rateLimit":{"key":"%s:bar","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
			res, err = xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			}, map[string]string{
				"X-Forwarded-For": "foo",
			})
			require.NoError(t, err)
			require.Equal(t, fmt.Sprintf(`{"errors":[{"message":"Rate limit exceeded for Subgraph 'employees'."}],"data":{"employee":null},"extensions":{"rateLimit":{"key":"%s:foo","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
			res, err = xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			}, map[string]string{
				"X-Forwarded-For": "bar",
			})
			require.NoError(t, err)
			require.Equal(t, fmt.Sprintf(`{"errors":[{"message":"Rate limit exceeded for Subgraph 'employees'."}],"data":{"employee":null},"extensions":{"rateLimit":{"key":"%s:bar","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
		})
	})
	t.Run("enabled - key hidden without debug", func(t *testing.T) {
		t.Parallel()

		key := uuid.New().String()
		t.Cleanup(func() {
			client := redis.NewClient(&redis.Options{Addr: "localhost:6379", Password: "test"})
			del := client.Del(context.Background(), fmt.Sprintf("%s:localhost", key))
			require.NoError(t, del.Err())
		})
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithRateLimitConfig(&config.RateLimitConfiguration{
					Enabled:  true,
					Strategy: "simple",
					SimpleStrategy: config.RateLimitSimpleStrategy{
						Rate:                    1,
						Burst:                   1,
						Period:                  time.Second * 2,
						RejectExceedingRequests: false,
					},
					Storage: config.RedisConfiguration{
						URLs:      []string{"redis://localhost:6379"},
						KeyPrefix: key,
					},
					KeySuffixExpression: "request.header.Get('X-Forwarded-For')",
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			}, map[string]string{
				"X-Forwarded-For": "localhost",
			})
			require.NoError(t, err)
			require.NotContains(t, res.Body, fmt.Sprintf(`"key":"%s:localhost"`, key))
		})
	})
	t.Run("enabled - claim key", func(t *testing.T) {
		t.Parallel()

		key := uuid.New().String()
		t.Cleanup(func() {
			client := redis.NewClient(&redis.Options{Addr: "localhost:6379", Password: "test"})
			del := client.Del(context.Background(), fmt.Sprintf("%s:localhorst", key))
			require.NoError(t, del.Err())
		})

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)
		tokenDecoder, _ := authentication.NewJwksTokenDecoder(NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{
			{
				URL:             authServer.JWKSURL(),
				RefreshInterval: time.Second * 5,
			},
		})
		authOptions := authentication.HttpHeaderAuthenticatorOptions{
			Name:         "my-jwks-server",
			TokenDecoder: tokenDecoder,
		}
		authenticator, err := authentication.NewHttpHeaderAuthenticator(authOptions)
		require.NoError(t, err)
		authenticators := []authentication.Authenticator{authenticator}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(core.NewAccessController(authenticators, false)),
				core.WithRateLimitConfig(&config.RateLimitConfiguration{
					Enabled:  true,
					Strategy: "simple",
					SimpleStrategy: config.RateLimitSimpleStrategy{
						Rate:                    1,
						Burst:                   1,
						Period:                  time.Second * 2,
						RejectExceedingRequests: false,
					},
					Storage: config.RedisConfiguration{
						URLs:      []string{"redis://localhost:6379"},
						KeyPrefix: key,
					},
					Debug:               true,
					KeySuffixExpression: "request.auth.claims.sub",
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			token, err := authServer.Token(map[string]any{
				"sub": "localhorst",
			})
			require.NoError(t, err)
			res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			}, map[string]string{
				"Authorization": "Bearer " + token,
			})
			require.NoError(t, err)
			require.Equal(t, fmt.Sprintf(`{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}},"extensions":{"rateLimit":{"key":"%s:localhorst","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
		})
	})
	t.Run("enabled - above limit", func(t *testing.T) {
		t.Parallel()

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
						Rate:                    2,
						Burst:                   2,
						Period:                  time.Second * 2,
						RejectExceedingRequests: false,
					},
					Storage: config.RedisConfiguration{
						URLs:      []string{"redis://localhost:6379"},
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
			require.Equal(t, fmt.Sprintf(`{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}},"extensions":{"rateLimit":{"key":"%s","requestRate":1,"remaining":1,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.Equal(t, fmt.Sprintf(`{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}},"extensions":{"rateLimit":{"key":"%s","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.Equal(t, fmt.Sprintf(`{"errors":[{"message":"Rate limit exceeded for Subgraph 'employees'."}],"data":{"employee":null},"extensions":{"rateLimit":{"key":"%s","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.Equal(t, fmt.Sprintf(`{"errors":[{"message":"Rate limit exceeded for Subgraph 'employees'."}],"data":{"employee":null},"extensions":{"rateLimit":{"key":"%s","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.Equal(t, fmt.Sprintf(`{"errors":[{"message":"Rate limit exceeded for Subgraph 'employees'."}],"data":{"employee":null},"extensions":{"rateLimit":{"key":"%s","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
		})
	})
	t.Run("enabled - below limit with nesting", func(t *testing.T) {
		t.Parallel()

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
						Rate:                    4,
						Burst:                   4,
						Period:                  time.Second * 2,
						RejectExceedingRequests: false,
					},
					Storage: config.RedisConfiguration{
						URLs:      []string{"redis://localhost:6379"},
						KeyPrefix: key,
					},
					Debug: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: bigNestedQuery,
			})
			require.Equal(t, fmt.Sprintf(`{"data":{"products":[{"__typename":"Consultancy","upc":"consultancy","lead":{"id":1,"details":{"surname":"Neuse","forename":"Jens"}}},{"__typename":"Cosmo","engineers":[{"details":{"forename":"Jens"}},{"details":{"forename":"Dustin"}},{"details":{"forename":"Sergiy"}},{"details":{"forename":"Suvij"}},{"details":{"forename":"Nithin"}},{"details":{"forename":"Eelco"}},{"details":{"forename":"David"}}]},{"__typename":"SDK"}],"employees":[{"id":1,"role":{"title":["Founder","CEO"],"__typename":"Engineer","engineerType":"BACKEND"},"details":{"pets":null}},{"id":2,"role":{"title":["Co-founder","Tech Lead"],"__typename":"Engineer","engineerType":"FULLSTACK"},"details":{"pets":null}},{"id":3,"role":{"title":["Co-founder","Head of Growth"]},"details":{"pets":[{"class":"REPTILE","name":"Snappy"}]}},{"id":4,"role":{"title":["Co-founder","COO"]},"details":{"pets":[{},{}]}},{"id":5,"role":{"title":["Senior GO Engineer"],"__typename":"Engineer","engineerType":"BACKEND"},"details":{"pets":[{"__typename":"Cat"},{"__typename":"Cat"},{"__typename":"Cat"},{"__typename":"Cat"},{"__typename":"Cat"},{"__typename":"Cat"},{"__typename":"Cat"},{"__typename":"Cat"},{"__typename":"Cat"},{"__typename":"Cat"}]}},{"id":7,"role":{"title":["Software Engineer"],"__typename":"Engineer","engineerType":"FULLSTACK"},"details":{"pets":null}},{"id":8,"role":{"title":["Software Engineer"],"__typename":"Engineer","engineerType":"FULLSTACK"},"details":{"pets":null}},{"id":10,"role":{"title":["Senior Frontend Engineer"],"__typename":"Engineer","engineerType":"FRONTEND"},"details":{"pets":[{}]}},{"id":11,"role":{"title":["Accounting & Finance"]},"details":{"pets":null}},{"id":12,"role":{"title":["Software Engineer"],"__typename":"Engineer","engineerType":"FULLSTACK"},"details":{"pets":[{"__typename":"Cat"}]}}]},"extensions":{"rateLimit":{"key":"%s","requestRate":2,"remaining":2,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
		})
	})
	t.Run("enabled - above limit with nesting", func(t *testing.T) {
		t.Parallel()

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
						Rate:                    1,
						Burst:                   1,
						Period:                  time.Second * 2,
						RejectExceedingRequests: false,
					},
					Storage: config.RedisConfiguration{
						URLs:      []string{"redis://localhost:6379"},
						KeyPrefix: key,
					},
					Debug: true,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: bigNestedQuery,
			})
			require.Equal(t, fmt.Sprintf(`{"errors":[{"message":"Rate limit exceeded for Subgraph 'family' at Path 'employees'."}],"data":{"products":[{"__typename":"Consultancy","upc":"consultancy","lead":{"id":1,"details":{"surname":"Neuse","forename":"Jens"}}},{"__typename":"Cosmo","engineers":[{"details":{"forename":"Jens"}},{"details":{"forename":"Dustin"}},{"details":{"forename":"Sergiy"}},{"details":{"forename":"Suvij"}},{"details":{"forename":"Nithin"}},{"details":{"forename":"Eelco"}},{"details":{"forename":"David"}}]},{"__typename":"SDK"}],"employees":[{"id":1,"role":{"title":["Founder","CEO"],"__typename":"Engineer","engineerType":"BACKEND"},"details":null},{"id":2,"role":{"title":["Co-founder","Tech Lead"],"__typename":"Engineer","engineerType":"FULLSTACK"},"details":null},{"id":3,"role":{"title":["Co-founder","Head of Growth"]},"details":null},{"id":4,"role":{"title":["Co-founder","COO"]},"details":null},{"id":5,"role":{"title":["Senior GO Engineer"],"__typename":"Engineer","engineerType":"BACKEND"},"details":null},{"id":7,"role":{"title":["Software Engineer"],"__typename":"Engineer","engineerType":"FULLSTACK"},"details":null},{"id":8,"role":{"title":["Software Engineer"],"__typename":"Engineer","engineerType":"FULLSTACK"},"details":null},{"id":10,"role":{"title":["Senior Frontend Engineer"],"__typename":"Engineer","engineerType":"FRONTEND"},"details":null},{"id":11,"role":{"title":["Accounting & Finance"]},"details":null},{"id":12,"role":{"title":["Software Engineer"],"__typename":"Engineer","engineerType":"FULLSTACK"},"details":null}]},"extensions":{"rateLimit":{"key":"%s","requestRate":2,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
		})
	})
	t.Run("enabled - above limit with nesting and reject", func(t *testing.T) {
		t.Parallel()

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
						Rate:                    1,
						Burst:                   1,
						Period:                  time.Second * 2,
						RejectExceedingRequests: true,
						RejectStatusCode:        http.StatusOK,
					},
					Storage: config.RedisConfiguration{
						URLs:      []string{"redis://localhost:6379"},
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
			require.Equal(t, http.StatusOK, res.Response.StatusCode)
			require.Equal(t, fmt.Sprintf(`{"errors":[{"message":"Rate limit exceeded"}],"data":null,"extensions":{"rateLimit":{"key":"%s","requestRate":2,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
		})
	})
	t.Run("enabled - reject with custom status code", func(t *testing.T) {
		t.Parallel()

		key := uuid.New().String()
		t.Cleanup(func() {
			client := redis.NewClient(&redis.Options{Addr: "localhost:6379", Password: "test"})
			del := client.Del(context.Background(), key)
			require.NoError(t, del.Err())
		})
		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				core.WithRateLimitConfig(&config.RateLimitConfiguration{
					Enabled:  true,
					Strategy: "simple",
					SimpleStrategy: config.RateLimitSimpleStrategy{
						Rate:                    1,
						Burst:                   1,
						Period:                  time.Second * 2,
						RejectExceedingRequests: true,
						RejectStatusCode:        http.StatusTooManyRequests,
					},
					Storage: config.RedisConfiguration{
						URLs:      []string{"redis://localhost:6379"},
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
			require.Equal(t, fmt.Sprintf(`{"errors":[{"message":"Rate limit exceeded"}],"data":null,"extensions":{"rateLimit":{"key":"%s","requestRate":2,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
		})
	})
	t.Run("enabled - above limit - hide stats", func(t *testing.T) {
		t.Parallel()

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
						Rate:                           2,
						Burst:                          2,
						Period:                         time.Second * 2,
						RejectExceedingRequests:        false,
						HideStatsFromResponseExtension: true,
					},
					Storage: config.RedisConfiguration{
						URLs:      []string{"redis://localhost:6379"},
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
			require.Equal(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
		})
	})
	t.Run("enabled - above limit - hide stats - code enabled", func(t *testing.T) {
		t.Parallel()

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
						Rate:                           1,
						Burst:                          1,
						Period:                         time.Second * 2,
						RejectExceedingRequests:        false,
						HideStatsFromResponseExtension: true,
					},
					Storage: config.RedisConfiguration{
						URLs:      []string{"redis://localhost:6379"},
						KeyPrefix: key,
					},
					Debug: true,
					ErrorExtensionCode: config.RateLimitErrorExtensionCode{
						Enabled: true,
						Code:    "RATE_LIMIT_EXCEEDED",
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.Equal(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Rate limit exceeded for Subgraph 'employees'.","extensions":{"code":"RATE_LIMIT_EXCEEDED"}}],"data":{"employee":null}}`, res.Body)
		})
	})
	t.Run("enabled - above limit - hide stats - code enabled - reject", func(t *testing.T) {
		t.Parallel()

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
						Rate:                           1,
						Burst:                          1,
						Period:                         time.Second * 2,
						RejectExceedingRequests:        true,
						HideStatsFromResponseExtension: true,
					},
					Storage: config.RedisConfiguration{
						URLs:      []string{"redis://localhost:6379"},
						KeyPrefix: key,
					},
					Debug: true,
					ErrorExtensionCode: config.RateLimitErrorExtensionCode{
						Enabled: true,
						Code:    "RATE_LIMIT_EXCEEDED",
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.Equal(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Rate limit exceeded","extensions":{"code":"RATE_LIMIT_EXCEEDED"}}],"data":null}`, res.Body)
		})
	})
	t.Run("enabled - above limit - hide stats with reject", func(t *testing.T) {
		t.Parallel()

		key := uuid.New().String()
		t.Cleanup(func() {
			client := redis.NewClient(&redis.Options{Addr: "localhost:6379", Password: "test"})
			del := client.Del(context.Background(), key)
			require.NoError(t, del.Err())
		})
		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: []core.Option{
				core.WithRateLimitConfig(&config.RateLimitConfiguration{
					Enabled:  true,
					Strategy: "simple",
					SimpleStrategy: config.RateLimitSimpleStrategy{
						Rate:                           1,
						Burst:                          1,
						Period:                         time.Second * 2,
						RejectExceedingRequests:        true,
						HideStatsFromResponseExtension: true,
					},
					Storage: config.RedisConfiguration{
						URLs:      []string{"redis://localhost:6379"},
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
			require.Equal(t, `{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}}}`, res.Body)
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.NoError(t, err)
			require.Equal(t, `{"errors":[{"message":"Rate limit exceeded"}],"data":null}`, res.Body)
		})
	})
	t.Run("Cluster Mode", func(t *testing.T) {

		if _, set := os.LookupEnv("SKIP_REDIS_CLUSTER_TESTS"); set {
			t.Skip("skipping redis cluster tests")
		}

		t.Parallel()

		var (
			clusterUrlSlice     = []string{"redis://cosmo:test@localhost:7001", "redis://cosmo:test@localhost:7002", "redis://cosmo:test@localhost:7003"}
			noSchemeClusterUrls = []string{"localhost:7001", "localhost:7002", "localhost:7003"}
			user                = "cosmo"
			password            = "test"
		)

		t.Run("correctly parses url options and authentication", func(t *testing.T) {
			t.Parallel()

			tests := []struct {
				name            string
				clusterUrlSlice []string
			}{
				{
					name:            "should successfully use auth from first url",
					clusterUrlSlice: []string{"redis://cosmo:test@localhost:7003", "redis://cosmo1:test1@localhost:7001", "redis://cosmo2:test2@localhost:7002"},
				},
				{
					name:            "should successfully use auth from later url if no auth in first urls",
					clusterUrlSlice: []string{"redis://localhost:7003", "rediss://localhost:7001", "rediss://cosmo:test@localhost:7002"},
				},
				{
					name:            "should successfully work with two urls",
					clusterUrlSlice: []string{"redis://cosmo:test@localhost:7002", "rediss://localhost:7001"},
				},
			}

			for _, tt := range tests {
				t.Run(tt.name, func(t *testing.T) {
					t.Parallel()
					key := uuid.New().String()
					t.Cleanup(func() {
						client := redis.NewClusterClient(&redis.ClusterOptions{Addrs: noSchemeClusterUrls, Username: user, Password: password})
						del := client.Del(context.Background(), key)
						require.NoError(t, del.Err())
					})

					testenv.Run(t, &testenv.Config{
						RouterOptions: []core.Option{
							core.WithRateLimitConfig(&config.RateLimitConfiguration{
								Enabled:  true,
								Strategy: "simple",
								SimpleStrategy: config.RateLimitSimpleStrategy{
									Rate:                    1,
									Burst:                   1,
									Period:                  time.Second * 2,
									RejectExceedingRequests: false,
								},
								Storage: config.RedisConfiguration{
									ClusterEnabled: true,
									URLs:           tt.clusterUrlSlice,
									KeyPrefix:      key,
								},
								Debug: true,
							}),
						},
					}, func(t *testing.T, xEnv *testenv.Environment) {
						res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
							Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
							Variables: json.RawMessage(`{"n":1}`),
						})
						require.Equal(t, fmt.Sprintf(`{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}},"extensions":{"rateLimit":{"key":"%s","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
					})
				})
			}

			t.Run("should fail with bad auth", func(t *testing.T) {
				t.Parallel()
				clusterUrlSlice = []string{"redis://cosmo1:test1@localhost:7001", "redis://cosmo:test@localhost:7003", "redis://cosmo2:test2@localhost:7002"}

				key := uuid.New().String()
				t.Cleanup(func() {
					client := redis.NewClusterClient(&redis.ClusterOptions{Addrs: noSchemeClusterUrls, Username: user, Password: password})
					del := client.Del(context.Background(), key)
					require.NoError(t, del.Err())
				})
				testenv.FailsOnStartup(t, &testenv.Config{
					RouterOptions: []core.Option{
						core.WithRateLimitConfig(&config.RateLimitConfiguration{
							Enabled:  true,
							Strategy: "simple",
							SimpleStrategy: config.RateLimitSimpleStrategy{
								Rate:                    1,
								Burst:                   1,
								Period:                  time.Second * 2,
								RejectExceedingRequests: false,
							},
							Storage: config.RedisConfiguration{
								ClusterEnabled: true,
								URLs:           clusterUrlSlice,
								KeyPrefix:      key,
							},
							Debug: true,
						}),
					},
				}, func(t *testing.T, err error) {
					require.Contains(t, err.Error(), "failed to create a functioning redis client")
				})
			})
		})
		t.Run("enabled - below limit", func(t *testing.T) {
			t.Parallel()

			key := uuid.New().String()
			t.Cleanup(func() {
				client := redis.NewClusterClient(&redis.ClusterOptions{Addrs: noSchemeClusterUrls, Username: user, Password: password})
				del := client.Del(context.Background(), key)
				require.NoError(t, del.Err())
			})
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithRateLimitConfig(&config.RateLimitConfiguration{
						Enabled:  true,
						Strategy: "simple",
						SimpleStrategy: config.RateLimitSimpleStrategy{
							Rate:                    1,
							Burst:                   1,
							Period:                  time.Second * 2,
							RejectExceedingRequests: false,
						},
						Storage: config.RedisConfiguration{
							ClusterEnabled: true,
							URLs:           clusterUrlSlice,
							KeyPrefix:      key,
						},
						Debug: true,
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
					Variables: json.RawMessage(`{"n":1}`),
				})
				require.Equal(t, fmt.Sprintf(`{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}},"extensions":{"rateLimit":{"key":"%s","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
			})
		})
		t.Run("enabled - header key", func(t *testing.T) {
			t.Parallel()

			key := uuid.New().String()
			t.Cleanup(func() {
				client := redis.NewClusterClient(&redis.ClusterOptions{Addrs: noSchemeClusterUrls, Username: user, Password: password})
				del := client.Del(context.Background(), fmt.Sprintf("%s:localhost", key))
				require.NoError(t, del.Err())
			})
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithRateLimitConfig(&config.RateLimitConfiguration{
						Enabled:  true,
						Strategy: "simple",
						SimpleStrategy: config.RateLimitSimpleStrategy{
							Rate:                    1,
							Burst:                   1,
							Period:                  time.Second * 2,
							RejectExceedingRequests: false,
						},
						Storage: config.RedisConfiguration{
							ClusterEnabled: true,
							URLs:           clusterUrlSlice,
							KeyPrefix:      key,
						},
						Debug:               true,
						KeySuffixExpression: "request.header.Get('X-Forwarded-For')",
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
					Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
					Variables: json.RawMessage(`{"n":1}`),
				}, map[string]string{
					"X-Forwarded-For": "localhost",
				})
				require.NoError(t, err)
				require.Equal(t, fmt.Sprintf(`{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}},"extensions":{"rateLimit":{"key":"%s:localhost","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
			})
		})
		t.Run("enabled - above limit", func(t *testing.T) {
			t.Parallel()

			key := uuid.New().String()
			t.Cleanup(func() {
				client := redis.NewClusterClient(&redis.ClusterOptions{Addrs: noSchemeClusterUrls, Username: user, Password: password})
				del := client.Del(context.Background(), key)
				require.NoError(t, del.Err())
			})
			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithRateLimitConfig(&config.RateLimitConfiguration{
						Enabled:  true,
						Strategy: "simple",
						SimpleStrategy: config.RateLimitSimpleStrategy{
							Rate:                    2,
							Burst:                   2,
							Period:                  time.Second * 2,
							RejectExceedingRequests: false,
						},
						Storage: config.RedisConfiguration{
							ClusterEnabled: true,
							URLs:           clusterUrlSlice,
							KeyPrefix:      key,
						},
						Debug: true,
					}),
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
					Variables: json.RawMessage(`{"n":1}`),
				})
				require.Equal(t, fmt.Sprintf(`{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}},"extensions":{"rateLimit":{"key":"%s","requestRate":1,"remaining":1,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
					Variables: json.RawMessage(`{"n":1}`),
				})
				require.Equal(t, fmt.Sprintf(`{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}},"extensions":{"rateLimit":{"key":"%s","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
					Variables: json.RawMessage(`{"n":1}`),
				})
				require.Equal(t, fmt.Sprintf(`{"errors":[{"message":"Rate limit exceeded for Subgraph 'employees'."}],"data":{"employee":null},"extensions":{"rateLimit":{"key":"%s","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
					Variables: json.RawMessage(`{"n":1}`),
				})
				require.Equal(t, fmt.Sprintf(`{"errors":[{"message":"Rate limit exceeded for Subgraph 'employees'."}],"data":{"employee":null},"extensions":{"rateLimit":{"key":"%s","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
				res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
					Variables: json.RawMessage(`{"n":1}`),
				})
				require.Equal(t, fmt.Sprintf(`{"errors":[{"message":"Rate limit exceeded for Subgraph 'employees'."}],"data":{"employee":null},"extensions":{"rateLimit":{"key":"%s","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
			})
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
