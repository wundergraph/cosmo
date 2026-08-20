package integration

import (
	"github.com/wundergraph/cosmo/router-tests/testutils"

	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
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
		tokenDecoder, _ := authentication.NewJwksTokenDecoder(testutils.NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{
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

		accessController, err := core.NewAccessController(core.AccessControllerOptions{
			Authenticators:           authenticators,
			AuthenticationRequired:   false,
			SkipIntrospectionQueries: false,
			IntrospectionSkipSecret:  "",
		})
		require.NoError(t, err)

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithAccessController(accessController),
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
	t.Run("enabled - override applies higher limit for matching key", func(t *testing.T) {
		t.Parallel()

		key := uuid.New().String()

		t.Cleanup(func() {
			client := redis.NewClient(&redis.Options{Addr: "localhost:6379", Password: "test"})
			del := client.Del(context.Background(), fmt.Sprintf("%s:premium-user", key))
			require.NoError(t, del.Err())
			del = client.Del(context.Background(), fmt.Sprintf("%s:regular-user", key))
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
						Overrides: []config.RateLimitOverride{
							{
								Matching: "^premium-.*",
								Rate:     4,
								Burst:    4,
								Period:   time.Second * 2,
							},
						},
					},
					Storage: config.RedisConfiguration{
						URLs:      []string{"redis://localhost:6379"},
						KeyPrefix: key,
					},
					Debug:               true,
					KeySuffixExpression: "request.header.Get('X-Client-ID')",
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Regular user: default limit of 1, second request is rate limited
			res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			}, map[string]string{
				"X-Client-ID": "regular-user",
			})
			require.NoError(t, err)
			require.Contains(t, res.Body, `"remaining":0`)
			require.NotContains(t, res.Body, `"errors"`)

			res, err = xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			}, map[string]string{
				"X-Client-ID": "regular-user",
			})
			require.NoError(t, err)
			require.Contains(t, res.Body, `"errors"`)

			// Premium user: override limit of 4, still has remaining after first request
			res, err = xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			}, map[string]string{
				"X-Client-ID": "premium-user",
			})
			require.NoError(t, err)
			require.Contains(t, res.Body, `"remaining":3`)
			require.NotContains(t, res.Body, `"errors"`)

			res, err = xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			}, map[string]string{
				"X-Client-ID": "premium-user",
			})
			require.NoError(t, err)
			require.Contains(t, res.Body, `"remaining":2`)
			require.NotContains(t, res.Body, `"errors"`)

			res, err = xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			}, map[string]string{
				"X-Client-ID": "premium-user",
			})
			require.NoError(t, err)
			require.Contains(t, res.Body, `"remaining":1`)
			require.NotContains(t, res.Body, `"errors"`)

			res, err = xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			}, map[string]string{
				"X-Client-ID": "premium-user",
			})
			require.NoError(t, err)
			require.Contains(t, res.Body, `"remaining":0`)
			require.NotContains(t, res.Body, `"errors"`)

			// Premium user: fifth request exceeds override limit
			res, err = xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			}, map[string]string{
				"X-Client-ID": "premium-user",
			})
			require.NoError(t, err)
			require.Contains(t, res.Body, `"errors"`)
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

				clusterUrlSlice := []string{"redis://cosmo1:test1@localhost:7001", "redis://cosmo:test@localhost:7003", "redis://cosmo2:test2@localhost:7002"}

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

func TestRateLimitExcludeSubscriptions(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	t.Parallel()

	const subscriptionQuery = `{"query":"subscription { employeeUpdated(employeeID: 3) { id details { forename surname } }}"}`
	employeeUpdatedEvent := []byte(`{"id":3,"__typename": "Employee"}`)

	newRateLimitConfig := func(key string, excludeSubscriptions, rejectExceedingRequests bool) *config.RateLimitConfiguration {
		return &config.RateLimitConfiguration{
			Enabled:  true,
			Strategy: "simple",
			SimpleStrategy: config.RateLimitSimpleStrategy{
				Rate:                    1,
				Burst:                   1,
				Period:                  time.Second * 10,
				RejectExceedingRequests: rejectExceedingRequests,
			},
			Storage: config.RedisConfiguration{
				URLs:      []string{"redis://localhost:6379"},
				KeyPrefix: key,
			},
			Debug:                true,
			ExcludeSubscriptions: excludeSubscriptions,
		}
	}

	cleanupKey := func(t *testing.T, key string) func() {
		return func() {
			client := redis.NewClient(&redis.Options{Addr: "localhost:6379", Password: "test"})
			del := client.Del(context.Background(), key)
			t.Error(del.Err())
		}
	}

	t.Run("subscription events are rate limited when exclude_subscriptions is disabled", func(t *testing.T) {
		t.Parallel()

		key := uuid.New().String()
		t.Cleanup(cleanupKey(t, key))

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			RouterOptions: []core.Option{
				core.WithRateLimitConfig(newRateLimitConfig(key, false, false)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(subscriptionQuery),
			})
			require.NoError(t, err)

			xEnv.WaitForSubscriptionCount(1, time.Second*15)
			xEnv.WaitForTriggerCount(1, time.Second*15)

			subject := xEnv.GetPubSubName("employeeUpdated.3")
			xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionDefault, subject, employeeUpdatedEvent, 1, time.Second*15)

			// The first event consumes the whole budget with the entity fetch resolving the details.
			var res testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &res)
			require.NoError(t, err)
			require.Equal(t, "next", res.Type)
			require.Equal(t, "1", res.ID)
			require.Equal(t, fmt.Sprintf(`{"data":{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}},"extensions":{"rateLimit":{"key":"%s","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), string(res.Payload))

			// The entity fetch of the second event must be denied.
			err = xEnv.NatsConnectionDefault.Publish(subject, employeeUpdatedEvent)
			require.NoError(t, err)
			require.NoError(t, xEnv.NatsConnectionDefault.Flush())

			err = testenv.WSReadJSON(t, conn, &res)
			require.NoError(t, err)
			require.Equal(t, "next", res.Type)
			require.Equal(t, "1", res.ID)
			require.Contains(t, string(res.Payload), "Rate limit exceeded")

			require.NoError(t, conn.Close())
			xEnv.WaitForSubscriptionCount(0, time.Second*15)
		})
	})
	t.Run("subscription events over websocket are not rate limited when exclude_subscriptions is enabled", func(t *testing.T) {
		t.Parallel()

		key := uuid.New().String()
		t.Cleanup(cleanupKey(t, key))

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			RouterOptions: []core.Option{
				core.WithRateLimitConfig(newRateLimitConfig(key, true, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(subscriptionQuery),
			})
			require.NoError(t, err)

			xEnv.WaitForSubscriptionCount(1, time.Second*15)
			xEnv.WaitForTriggerCount(1, time.Second*15)

			subject := xEnv.GetPubSubName("employeeUpdated.3")

			// With a budget of 1, any rate limiting of the entity fetches would deny the second and third event.
			for range 3 {
				xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionDefault, subject, employeeUpdatedEvent, 1, time.Second*15)

				var res testenv.WebSocketMessage
				err = testenv.WSReadJSON(t, conn, &res)
				require.NoError(t, err)
				require.Equal(t, "next", res.Type)
				require.Equal(t, "1", res.ID)
				require.Equal(t, `{"data":{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}}`, string(res.Payload))
			}

			// Queries remain rate limited.
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.Equal(t, fmt.Sprintf(`{"data":{"employee":{"id":1,"details":{"forename":"Jens","surname":"Neuse"}}},"extensions":{"rateLimit":{"key":"%s","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)
			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
				Variables: json.RawMessage(`{"n":1}`),
			})
			require.Equal(t, fmt.Sprintf(`{"errors":[{"message":"Rate limit exceeded"}],"data":null,"extensions":{"rateLimit":{"key":"%s","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), res.Body)

			require.NoError(t, conn.Close())
			xEnv.WaitForSubscriptionCount(0, time.Second*15)
		})
	})
	t.Run("queries over websocket are still rate limited when exclude_subscriptions is enabled", func(t *testing.T) {
		t.Parallel()

		key := uuid.New().String()
		t.Cleanup(cleanupKey(t, key))

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithRateLimitConfig(newRateLimitConfig(key, true, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := xEnv.InitGraphQLWebSocketConnection(nil, nil, nil)
			err := testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
				ID:      "1",
				Type:    "subscribe",
				Payload: []byte(`{"query":"query { employee(id:1) { id } }"}`),
			})
			require.NoError(t, err)

			var res testenv.WebSocketMessage
			err = testenv.WSReadJSON(t, conn, &res)
			require.NoError(t, err)
			require.Equal(t, "next", res.Type)
			require.Equal(t, "1", res.ID)
			require.Equal(t, fmt.Sprintf(`{"data":{"employee":{"id":1}},"extensions":{"rateLimit":{"key":"%s","requestRate":1,"remaining":0,"retryAfterMs":1234,"resetAfterMs":1234}}}`, key), string(res.Payload))

			err = testenv.WSReadJSON(t, conn, &res)
			require.NoError(t, err)
			require.Equal(t, "complete", res.Type)
			require.Equal(t, "1", res.ID)

			err = testenv.WSWriteJSON(t, conn, testenv.WebSocketMessage{
				ID:      "2",
				Type:    "subscribe",
				Payload: []byte(`{"query":"query { employee(id:1) { id } }"}`),
			})
			require.NoError(t, err)

			err = testenv.WSReadJSON(t, conn, &res)
			require.NoError(t, err)
			require.Equal(t, "2", res.ID)
			require.Contains(t, string(res.Payload), "Rate limit exceeded")

			require.NoError(t, conn.Close())
		})
	})
	t.Run("subscription events over sse are not rate limited when exclude_subscriptions is enabled", func(t *testing.T) {
		t.Parallel()

		key := uuid.New().String()
		t.Cleanup(cleanupKey(t, key))

		testenv.Run(t, &testenv.Config{
			RouterConfigJSONTemplate: testenv.ConfigWithEdfsNatsJSONTemplate,
			EnableNats:               true,
			RouterOptions: []core.Option{
				core.WithRateLimitConfig(newRateLimitConfig(key, true, true)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()

			events := make(chan string, 8)
			go xEnv.GraphQLSubscriptionOverSSE(ctx, testenv.GraphQLRequest{
				Query: `subscription { employeeUpdated(employeeID: 3) { id details { forename surname } }}`,
				Header: map[string][]string{
					"Content-Type": {"application/json"},
					"Accept":       {"text/event-stream"},
				},
			}, func(data string) {
				events <- data
			})

			xEnv.WaitForSubscriptionCount(1, time.Second*15)
			xEnv.WaitForTriggerCount(1, time.Second*15)

			subject := xEnv.GetPubSubName("employeeUpdated.3")

			// With a budget of 1, any rate limiting of the entity fetches would deny the second and third event.
			for range 3 {
				xEnv.NATSPublishUntilReceived(xEnv.NatsConnectionDefault, subject, employeeUpdatedEvent, 1, time.Second*15)

				select {
				case data := <-events:
					require.Equal(t, `{"data":{"employeeUpdated":{"id":3,"details":{"forename":"Stefan","surname":"Avram"}}}}`, strings.TrimSpace(data))
				case <-ctx.Done():
					t.Fatal("timed out waiting for subscription event")
				}
			}
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
