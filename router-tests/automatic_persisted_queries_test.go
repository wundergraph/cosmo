package integration

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

func TestAutomaticPersistedQueries(t *testing.T) {
	t.Parallel()

	t.Run("local cache", func(t *testing.T) {
		t.Parallel()

		t.Run("Sha without query fails", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithGraphApiToken(""),
				},
				ApqConfig: config.AutomaticPersistedQueriesConfig{
					Enabled: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + cacheHashNotStored + `"}}`),
				})
				require.Equal(t, `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`, res.Body)
			})
		})

		t.Run("Sha with query works", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					// This ensures that no CDN client for persistent operations is created, so we can verify that
					// APQ alone (without persistent operation support setup) works as expected.
					core.WithGraphApiToken(""),
				},
				ApqConfig: config.AutomaticPersistedQueriesConfig{
					Enabled: true,
					Cache: config.AutomaticPersistedQueriesCacheConfig{
						Size: 1024 * 1024,
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res0 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header,
				})
				require.Equal(t, `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`, res0.Body)

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:      `{__typename}`,
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header,
				})
				require.Equal(t, `{"data":{"__typename":"Query"}}`, res.Body)

				res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header,
				})
				require.Equal(t, `{"data":{"__typename":"Query"}}`, res2.Body)

				header2 := make(http.Header)
				header2.Add("graphql-client-name", "not-my-client")
				res3 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header2,
				})
				require.Equal(t, `{"data":{"__typename":"Query"}}`, res3.Body)
			})
		})

		t.Run("SHA with non-matching query fails", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					// This ensures that no CDN client for persistent operations is created, so we can verify that
					// APQ alone (without persistent operation support setup) works as expected.
					core.WithGraphApiToken(""),
				},
				ApqConfig: config.AutomaticPersistedQueriesConfig{
					Enabled: true,
					Cache: config.AutomaticPersistedQueriesCacheConfig{
						Size: 1024 * 1024,
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")

				// Should not work
				res1, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query:      `{__typename}`,
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "85d996c3662d12de4f4abc17ba6f7aa696c1e760c7ed482a8ae64c49a7d68773"}}`),
					Header:     header,
				})
				require.NoError(t, err)
				require.Equal(t, `{"errors":[{"message":"persistedQuery sha256 hash does not match query body"}]}`, res1.Body)

				// Ensure the bad body is not added to APQ
				res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "85d996c3662d12de4f4abc17ba6f7aa696c1e760c7ed482a8ae64c49a7d68773"}}`),
					Header:     header,
				})
				require.Equal(t, `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`, res2.Body)
			})
		})

		t.Run("query is deleted after ttl expires", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				ApqConfig: config.AutomaticPersistedQueriesConfig{
					Enabled: true,
					Cache: config.AutomaticPersistedQueriesCacheConfig{
						Size: 1024 * 1024,
						TTL:  2, // 2 seconds
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:      `{__typename}`,
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header,
				})
				require.Equal(t, `{"data":{"__typename":"Query"}}`, res.Body)

				time.Sleep(3 * time.Second)

				res0 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header,
				})
				require.Equal(t, `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`, res0.Body)
			})
		})

		t.Run("query renews ttl time", func(t *testing.T) {
			t.Parallel()

			testenv.Run(t, &testenv.Config{
				ApqConfig: config.AutomaticPersistedQueriesConfig{
					Enabled: true,
					Cache: config.AutomaticPersistedQueriesCacheConfig{
						Size: 1024 * 1024,
						TTL:  5, // 5 seconds
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:      `{__typename}`,
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header,
				})
				require.Equal(t, `{"data":{"__typename":"Query"}}`, res.Body)

				time.Sleep(3 * time.Second)

				res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header,
				})
				require.Equal(t, `{"data":{"__typename":"Query"}}`, res2.Body)

				time.Sleep(3 * time.Second)

				res3 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header,
				})
				require.Equal(t, `{"data":{"__typename":"Query"}}`, res3.Body)
			})
		})
	})

	t.Run("redis cache", func(t *testing.T) {
		var (
			redisLocalUrl = "localhost:6379"
			redisUrl      = fmt.Sprintf("redis://%s", redisLocalUrl)
			redisUser     = "cosmo"
			redisPassword = "test"
			client        = redis.NewClient(&redis.Options{Addr: redisLocalUrl, Password: redisPassword})
		)
		t.Parallel()

		t.Run("sha without query fails", func(t *testing.T) {
			t.Parallel()

			key := uuid.New().String()
			t.Cleanup(func() {
				del := client.Del(context.Background(), key)
				require.NoError(t, del.Err())
			})

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithStorageProviders(config.StorageProviders{
						Redis: []config.RedisStorageProvider{
							{
								URLs: []string{redisUrl},
								ID:   "redis",
							},
						}})},
				ApqConfig: config.AutomaticPersistedQueriesConfig{
					Enabled: true,
					Storage: config.AutomaticPersistedQueriesStorageConfig{
						ProviderID:   "redis",
						ObjectPrefix: key,
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "` + cacheHashNotStored + `"}}`),
				})
				require.Equal(t, `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`, res.Body)
			})
		})

		t.Run("sha with query works", func(t *testing.T) {
			t.Parallel()

			key := uuid.New().String()
			t.Cleanup(func() {
				del := client.Del(context.Background(), key)
				require.NoError(t, del.Err())
			})

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithStorageProviders(config.StorageProviders{
						Redis: []config.RedisStorageProvider{
							{
								URLs: []string{redisUrl},
								ID:   "redis",
							},
						}})},
				ApqConfig: config.AutomaticPersistedQueriesConfig{
					Enabled: true,
					Storage: config.AutomaticPersistedQueriesStorageConfig{
						ProviderID:   "redis",
						ObjectPrefix: key,
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res0 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header,
				})
				require.Equal(t, `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`, res0.Body)

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:      `{__typename}`,
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header,
				})
				require.Equal(t, `{"data":{"__typename":"Query"}}`, res.Body)

				res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header,
				})
				require.Equal(t, `{"data":{"__typename":"Query"}}`, res2.Body)

				header2 := make(http.Header)
				header2.Add("graphql-client-name", "not-my-client")
				res3 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header2,
				})
				require.Equal(t, `{"data":{"__typename":"Query"}}`, res3.Body)
			})
		})

		t.Run("query is deleted after ttl expires", func(t *testing.T) {
			t.Parallel()

			key := uuid.New().String()
			t.Cleanup(func() {
				del := client.Del(context.Background(), key)
				require.NoError(t, del.Err())
			})

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithStorageProviders(config.StorageProviders{
						Redis: []config.RedisStorageProvider{
							{
								URLs: []string{redisUrl},
								ID:   "redis",
							},
						}})},
				ApqConfig: config.AutomaticPersistedQueriesConfig{
					Enabled: true,
					Cache: config.AutomaticPersistedQueriesCacheConfig{
						TTL: 2, // 2 seconds
					},
					Storage: config.AutomaticPersistedQueriesStorageConfig{
						ProviderID:   "redis",
						ObjectPrefix: key,
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:      `{__typename}`,
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header,
				})
				require.Equal(t, `{"data":{"__typename":"Query"}}`, res.Body)

				time.Sleep(3 * time.Second)

				res0 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header,
				})
				require.Equal(t, `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`, res0.Body)
			})
		})

		t.Run("query renews ttl time", func(t *testing.T) {
			t.Parallel()

			key := uuid.New().String()
			t.Cleanup(func() {
				del := client.Del(context.Background(), key)
				require.NoError(t, del.Err())
			})

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithStorageProviders(config.StorageProviders{
						Redis: []config.RedisStorageProvider{
							{
								URLs: []string{redisUrl},
								ID:   "redis",
							},
						}})},
				ApqConfig: config.AutomaticPersistedQueriesConfig{
					Enabled: true,
					Cache: config.AutomaticPersistedQueriesCacheConfig{
						TTL: 5,
					},
					Storage: config.AutomaticPersistedQueriesStorageConfig{
						ProviderID:   "redis",
						ObjectPrefix: key,
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:      `{__typename}`,
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header,
				})
				require.Equal(t, `{"data":{"__typename":"Query"}}`, res.Body)

				time.Sleep(3 * time.Second)

				res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header,
				})
				require.Equal(t, `{"data":{"__typename":"Query"}}`, res2.Body)

				time.Sleep(3 * time.Second)

				res3 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header,
				})
				require.Equal(t, `{"data":{"__typename":"Query"}}`, res3.Body)
			})
		})

		t.Run("works with cluster mode", func(t *testing.T) {

			if _, set := os.LookupEnv("SKIP_REDIS_CLUSTER_TESTS"); set {
				t.Skip("skipping redis cluster tests")
			}

			t.Parallel()
			clusterUrls := []string{"redis://cosmo:test@localhost:7002", "redis://cosmo:test@localhost:7001"}
			noSchemeClusterUrls := []string{"localhost:7002", "localhost:7001"}
			clusterClient := redis.NewClusterClient(&redis.ClusterOptions{
				Addrs:    noSchemeClusterUrls,
				Username: redisUser,
				Password: redisPassword,
			})

			key := uuid.New().String()
			t.Cleanup(func() {
				del := clusterClient.Del(context.Background(), key)
				require.NoError(t, del.Err())
			})

			testenv.Run(t, &testenv.Config{
				RouterOptions: []core.Option{
					core.WithStorageProviders(config.StorageProviders{
						Redis: []config.RedisStorageProvider{
							{
								ClusterEnabled: true,
								URLs:           clusterUrls,
								ID:             "redis",
							},
						}})},
				ApqConfig: config.AutomaticPersistedQueriesConfig{
					Enabled: true,
					Storage: config.AutomaticPersistedQueriesStorageConfig{
						ProviderID:   "redis",
						ObjectPrefix: key,
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res0 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header,
				})
				require.Equal(t, `{"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}`, res0.Body)

				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:      `{__typename}`,
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header,
				})
				require.Equal(t, `{"data":{"__typename":"Query"}}`, res.Body)

				res2 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header,
				})
				require.Equal(t, `{"data":{"__typename":"Query"}}`, res2.Body)

				header2 := make(http.Header)
				header2.Add("graphql-client-name", "not-my-client")
				res3 := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`),
					Header:     header2,
				})
				require.Equal(t, `{"data":{"__typename":"Query"}}`, res3.Body)
			})
		})
	})
}

func TestAPQNormalizationCacheWithMultiOperationDocument(t *testing.T) {
	t.Parallel()

	t.Run("Should identify correct document after removing unused operations during normalization", func(t *testing.T) {

		document := `query A {
  a: employee(id: 1) {
    id
    details {
      pets {
        name
      }
    }
  }
}
query B ($id: Int!) {
  b: employee(id: $id) {
    id
    details {
      pets {
        name
      }
    }
  }
}`

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				// This ensures that no CDN client for persistent operations is created, so we can verify that
				// APQ alone (without persistent operation support setup) works as expected.
				core.WithGraphApiToken(""),
			},
			ApqConfig: config.AutomaticPersistedQueriesConfig{
				Enabled: true,
				Cache: config.AutomaticPersistedQueriesCacheConfig{
					Size: 1024 * 1024,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			header := make(http.Header)
			header.Add("graphql-client-name", "my-client")

			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				OperationName: []byte(`"A"`),
				Query:         document,
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "6248b42bc35ecebe0d5e95cb1090e44e514b89edf483b592f90883b478b65b2e"}}`),
				Header:        header,
			})
			require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
			require.Equal(t, `{"data":{"a":{"id":1,"details":{"pets":null}}}}`, res.Body)

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				OperationName: []byte(`"A"`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "6248b42bc35ecebe0d5e95cb1090e44e514b89edf483b592f90883b478b65b2e"}}`),
				Header:        header,
			})
			require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
			require.Equal(t, `{"data":{"a":{"id":1,"details":{"pets":null}}}}`, res.Body)

			// Now we send a request for operation with the name B

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				OperationName: []byte(`"B"`),
				Query:         document,
				Variables:     []byte(`{"id": 3}`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "6248b42bc35ecebe0d5e95cb1090e44e514b89edf483b592f90883b478b65b2e"}}`),
				Header:        header,
			})
			require.Equal(t, "MISS", res.Response.Header.Get(core.NormalizationCacheHeader))
			require.Equal(t, `{"data":{"b":{"id":3,"details":{"pets":[{"name":"Snappy"}]}}}}`, res.Body)

			res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				OperationName: []byte(`"B"`),
				Variables:     []byte(`{"id": 3}`),
				Extensions:    []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "6248b42bc35ecebe0d5e95cb1090e44e514b89edf483b592f90883b478b65b2e"}}`),
				Header:        header,
			})
			require.Equal(t, "HIT", res.Response.Header.Get(core.NormalizationCacheHeader))
			require.Equal(t, `{"data":{"b":{"id":3,"details":{"pets":[{"name":"Snappy"}]}}}}`, res.Body)
		})
	})

}

func BenchmarkAutomaticPersistedQueriesCacheEnabled(b *testing.B) {
	expected := `{"data":{"employees":[{"details":{"forename":"Jens","location":{"key":{"name":"Germany"}},"maritalStatus":"MARRIED","middlename":"","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Neuse"}},{"details":{"forename":"Dustin","location":{"key":{"name":"Germany"}},"maritalStatus":"ENGAGED","middlename":"Klaus","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Deus"}},{"details":{"forename":"Stefan","location":{"key":{"name":"America"}},"maritalStatus":"ENGAGED","middlename":"","nationality":"AMERICAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"REPTILE","gender":"UNKNOWN","name":"Snappy","__typename":"Alligator","dangerous":"yes"}],"surname":"Avram"}},{"details":{"forename":"Björn","location":{"key":{"name":"Germany"}},"maritalStatus":"MARRIED","middlename":"Volker","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"FEMALE","name":"Abby","__typename":"Dog","breed":"GOLDEN_RETRIEVER"},{"class":"MAMMAL","gender":"MALE","name":"Survivor","__typename":"Pony"}],"surname":"Schwenzer"}},{"details":{"forename":"Sergiy","location":{"key":{"name":"Ukraine"}},"maritalStatus":"ENGAGED","middlename":"","nationality":"UKRAINIAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"FEMALE","name":"Blotch","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"MALE","name":"Grayone","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"MALE","name":"Rusty","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"FEMALE","name":"Manya","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"MALE","name":"Peach","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"MALE","name":"Panda","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"FEMALE","name":"Mommy","__typename":"Cat","type":"STREET"},{"class":"MAMMAL","gender":"FEMALE","name":"Terry","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"FEMALE","name":"Tilda","__typename":"Cat","type":"HOME"},{"class":"MAMMAL","gender":"MALE","name":"Vasya","__typename":"Cat","type":"HOME"}],"surname":"Petrunin"}},{"details":{"forename":"Suvij","location":{"key":{"name":"India"}},"maritalStatus":null,"middlename":"","nationality":"INDIAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Surya"}},{"details":{"forename":"Nithin","location":{"key":{"name":"India"}},"maritalStatus":null,"middlename":"","nationality":"INDIAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Kumar"}},{"details":{"forename":"Eelco","location":{"key":{"name":"Netherlands"}},"maritalStatus":null,"middlename":"","nationality":"DUTCH","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"UNKNOWN","name":"Vanson","__typename":"Mouse"}],"surname":"Wiersma"}},{"details":{"forename":"Alexandra","location":{"key":{"name":"Germany"}},"maritalStatus":"MARRIED","middlename":"","nationality":"GERMAN","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":null,"surname":"Neuse"}},{"details":{"forename":"David","location":{"key":{"name":"England"}},"maritalStatus":"MARRIED","middlename":null,"nationality":"ENGLISH","pastLocations":[{"country":{"key":{"name":"America"}},"name":"Ohio","type":"city"},{"country":{"key":{"name":"England"}},"name":"London","type":"city"}],"pets":[{"class":"MAMMAL","gender":"FEMALE","name":"Pepper","__typename":"Cat","type":"HOME"}],"surname":"Stutt"}}]}}`

	b.ReportAllocs()
	b.SetBytes(int64(len(expected)))
	b.ResetTimer()

	testenv.Bench(b, &testenv.Config{
		ApqConfig: config.AutomaticPersistedQueriesConfig{
			Enabled: true,
			Cache: config.AutomaticPersistedQueriesCacheConfig{
				Size: 1024 * 1024,
			},
		},
	}, func(b *testing.B, xEnv *testenv.Environment) {
		header := make(http.Header)
		header.Add("graphql-client-name", "my-client")
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query:      `{ employees { details { forename location { ...CountryFields } maritalStatus middlename nationality pastLocations { country { ...CountryFields } name type } pets { class gender name ...AlligatorFields ...CatFields ...DogFields ...MouseFields ...PonyFields } surname } } } fragment CountryFields on Country { key { name } } fragment AlligatorFields on Alligator { __typename class dangerous gender name } fragment CatFields on Cat { __typename class gender name type } fragment DogFields on Dog { __typename breed class gender name } fragment MouseFields on Mouse { __typename class gender name } fragment PonyFields on Pony { __typename class gender name }`,
			Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "fb51f4141cc4f185fedc9956ae9e047b193edb196c6c095af8be785011a7c2ff"}}`),
			Header:     header,
		})
		if res.Body != expected {
			b.Fatalf("unexpected response: %s", res.Body)
		}
		b.RunParallel(func(pb *testing.PB) {
			for pb.Next() {
				header := make(http.Header)
				header.Add("graphql-client-name", "my-client")
				res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:      `{ employees { details { forename location { ...CountryFields } maritalStatus middlename nationality pastLocations { country { ...CountryFields } name type } pets { class gender name ...AlligatorFields ...CatFields ...DogFields ...MouseFields ...PonyFields } surname } } } fragment CountryFields on Country { key { name } } fragment AlligatorFields on Alligator { __typename class dangerous gender name } fragment CatFields on Cat { __typename class gender name type } fragment DogFields on Dog { __typename breed class gender name } fragment MouseFields on Mouse { __typename class gender name } fragment PonyFields on Pony { __typename class gender name }`,
					Extensions: []byte(`{"persistedQuery": {"version": 1, "sha256Hash": "fb51f4141cc4f185fedc9956ae9e047b193edb196c6c095af8be785011a7c2ff"}}`),
					Header:     header,
				})
				if res.Body != expected {
					b.Fatalf("unexpected response: %s", res.Body)
				}
			}
		})
	})
}
