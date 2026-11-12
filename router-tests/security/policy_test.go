package integration

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	custompolicy "github.com/wundergraph/cosmo/router-tests/modules/custom-policy"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// policyField builds the field configuration that composition emits for a field with @policy.
func policyField(typeName, fieldName string, policies ...[]string) *nodev1.FieldConfiguration {
	var required []*nodev1.Policies
	for _, policy := range policies {
		required = append(required, &nodev1.Policies{RequiredAndPolicies: policy})
	}
	return &nodev1.FieldConfiguration{
		TypeName:  typeName,
		FieldName: fieldName,
		AuthorizationConfiguration: &nodev1.AuthorizationConfiguration{
			RequiredOrPolicies: required,
		},
	}
}

// withPolicyFields adds the policies to the router config. A field with arguments already has a
// configuration entry, and the router reads the first entry per field, so the policies merge into it.
func withPolicyFields(fields ...*nodev1.FieldConfiguration) func(cfg *nodev1.RouterConfig) {
	return func(cfg *nodev1.RouterConfig) {
		for _, field := range fields {
			index := slices.IndexFunc(cfg.EngineConfig.FieldConfigurations, func(existing *nodev1.FieldConfiguration) bool {
				return existing.TypeName == field.TypeName && existing.FieldName == field.FieldName
			})
			if index < 0 {
				cfg.EngineConfig.FieldConfigurations = append(cfg.EngineConfig.FieldConfigurations, field)
				continue
			}
			cfg.EngineConfig.FieldConfigurations[index].AuthorizationConfiguration = field.AuthorizationConfiguration
		}
	}
}

// modulePolicySource configures the module decision source with the test policy module.
// The module counts its decisions in calls when calls is not nil.
func modulePolicySource(authorization config.AuthorizationConfiguration, calls *atomic.Int64) []core.Option {
	authorization.Policies = config.PolicyConfiguration{
		Source: "module",
	}
	return []core.Option{
		core.WithModulesConfig(map[string]any{
			custompolicy.ModuleID: custompolicy.PolicyModule{Calls: calls},
		}),
		core.WithCustomModules(&custompolicy.PolicyModule{}),
		core.WithAuthorizationConfig(&authorization),
	}
}

// policyHeader offers the policies to the test policy module.
func policyHeader(policies ...string) http.Header {
	header := http.Header{}
	for _, policy := range policies {
		header.Add(custompolicy.Header, policy)
	}
	return header
}

func compactJSON(t *testing.T, document string) string {
	t.Helper()
	var out bytes.Buffer
	require.NoError(t, json.Compact(&out, []byte(document)))
	return out.String()
}

// authorizationExtension returns the authorization extension of a response body.
func authorizationExtension(t *testing.T, body string) string {
	t.Helper()
	var response struct {
		Extensions struct {
			Authorization json.RawMessage `json:"authorization"`
		} `json:"extensions"`
	}
	require.NoError(t, json.Unmarshal([]byte(body), &response))
	return string(response.Extensions.Authorization)
}

const employeesIDQuery = `
	query {
		employees {
			id
		}
	}`

func TestPolicy(t *testing.T) {
	t.Parallel()

	t.Run("the module decision grants or denies the field per request", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:      modulePolicySource(config.AuthorizationConfiguration{}, nil),
			ModifyRouterConfig: withPolicyFields(policyField("Employee", "id", []string{"read:id"})),
		}, func(t *testing.T, env *testenv.Environment) {
			for _, granted := range []bool{true, false, true} {
				var policies []string
				if granted {
					policies = []string{"read:id"}
				}
				res := env.MakeGraphQLRequestOK(testenv.GraphQLRequest{
					Query:  employeesIDQuery,
					Header: policyHeader(policies...),
				})
				if granted {
					require.NotContains(t, res.Body, "errors")
					require.Contains(t, res.Body, `"id":1`)
					continue
				}
				require.Contains(t, res.Body, "Unauthorized to load field 'Query.employees.id', Reason: missing policies.")
				require.Equal(t, compactJSON(t, `
					{
						"actualScopes": [],
						"missingPolicies": [
							{
								"coordinate": {"typeName": "Employee", "fieldName": "id"},
								"required": [["read:id"]]
							}
						]
					}`), authorizationExtension(t, res.Body))
			}
		})
	})

	t.Run("reject operation if unauthorized fails the whole operation", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:      modulePolicySource(config.AuthorizationConfiguration{RejectOperationIfUnauthorized: true}, nil),
			ModifyRouterConfig: withPolicyFields(policyField("Employee", "id", []string{"read:id"})),
		}, func(t *testing.T, env *testenv.Environment) {
			res := env.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  employeesIDQuery,
				Header: policyHeader("other"),
			})
			require.Equal(t, compactJSON(t, `
				{
					"errors": [
						{"message": "Unauthorized"}
					],
					"data": null,
					"extensions": {
						"authorization": {
							"actualScopes": [],
							"missingPolicies": [
								{
									"coordinate": {"typeName": "Employee", "fieldName": "id"},
									"required": [["read:id"]]
								}
							]
						}
					}
				}`), res.Body)
			res = env.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  employeesIDQuery,
				Header: policyHeader("read:id"),
			})
			require.Contains(t, res.Body, `"id":1`)
		})
	})

	t.Run("a denied mutation root field is not sent to the subgraph", func(t *testing.T) {
		t.Parallel()

		const mutation = `
			mutation {
				updateEmployeeTag(id: 1, tag: "policy") {
					id
				}
			}`
		for _, preFetch := range []bool{false, true} {
			name := "post-fetch"
			if preFetch {
				name = "pre-fetch"
			}
			t.Run(name, func(t *testing.T) {
				t.Parallel()

				testenv.Run(t, &testenv.Config{
					RouterOptions:      modulePolicySource(config.AuthorizationConfiguration{EnablePreFetchFieldAuthorization: preFetch}, nil),
					ModifyRouterConfig: withPolicyFields(policyField("Mutation", "updateEmployeeTag", []string{"write:tag"})),
				}, func(t *testing.T, env *testenv.Environment) {
					res := env.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query:  mutation,
						Header: policyHeader(),
					})
					require.Contains(t, res.Body, "Unauthorized to load field 'Mutation.updateEmployeeTag', Reason: missing policies.")
					require.Contains(t, res.Body, `"data":{"updateEmployeeTag":null}`)
					require.Equal(t, compactJSON(t, `
						{
							"actualScopes": [],
							"missingPolicies": [
								{
									"coordinate": {"typeName": "Mutation", "fieldName": "updateEmployeeTag"},
									"required": [["write:tag"]]
								}
							]
						}`), authorizationExtension(t, res.Body))
					require.EqualValues(t, 0, env.SubgraphRequestCount.Employees.Load())

					res = env.MakeGraphQLRequestOK(testenv.GraphQLRequest{
						Query:  mutation,
						Header: policyHeader("write:tag"),
					})
					require.Equal(t, `{"data":{"updateEmployeeTag":{"id":1}}}`, res.Body)
					require.EqualValues(t, 1, env.SubgraphRequestCount.Employees.Load())
				})
			})
		}
	})

	t.Run("pre-fetch mode does not send a query fetch whose only root field is denied", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions:      modulePolicySource(config.AuthorizationConfiguration{EnablePreFetchFieldAuthorization: true}, nil),
			ModifyRouterConfig: withPolicyFields(policyField("Query", "employees", []string{"read:employees"})),
		}, func(t *testing.T, env *testenv.Environment) {
			res := env.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  employeesIDQuery,
				Header: policyHeader(),
			})
			require.Contains(t, res.Body, "Unauthorized to load field 'Query.employees', Reason: missing policies.")
			require.EqualValues(t, 0, env.SubgraphRequestCount.Employees.Load())
			res = env.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  employeesIDQuery,
				Header: policyHeader("read:employees"),
			})
			require.Contains(t, res.Body, `"id":1`)
			require.EqualValues(t, 1, env.SubgraphRequestCount.Employees.Load())
		})
	})

	// The decision runs at resolve time, after the cache, so a cached subgraph response is still filtered per caller.
	t.Run("a cached subgraph response is filtered per caller", func(t *testing.T) {
		t.Parallel()

		options := append(modulePolicySource(config.AuthorizationConfiguration{}, nil), core.WithResponseCache(&config.ResponseCacheConfiguration{
			Enabled: true,
			All: config.ResponseCacheSubgraphConfiguration{
				Enabled:     true,
				FallbackTTL: time.Minute,
			},
			Storage: config.ResponseCacheStorageConfig{
				Provider:   config.ResponseCacheStorageProviderMemory,
				MaxEntries: 100,
			},
		}))
		const query = `
			query {
				employees {
					id
					currentMood
				}
			}`
		testenv.Run(t, &testenv.Config{
			RouterOptions:      options,
			ModifyRouterConfig: withPolicyFields(policyField("Employee", "currentMood", []string{"read:mood"})),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{
					Middleware: func(next http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							w.Header().Set("Cache-Control", "public, max-age=60")
							next.ServeHTTP(w, r)
						})
					},
				},
			},
		}, func(t *testing.T, env *testenv.Environment) {
			res := env.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  query,
				Header: policyHeader("read:mood"),
			})
			require.Contains(t, res.Body, `"currentMood":"HAPPY"`)
			require.EqualValues(t, 1, env.SubgraphRequestCount.Mood.Load())

			res = env.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  query,
				Header: policyHeader(),
			})
			require.Contains(t, res.Body, "Unauthorized to load field 'Query.employees.currentMood', Reason: missing policies.")
			require.NotContains(t, res.Body, "HAPPY")
			require.EqualValues(t, 1, env.SubgraphRequestCount.Mood.Load(), "the second request must be served from the cache")
		})
	})

	t.Run("each operation of a batch gets its own decision", func(t *testing.T) {
		t.Parallel()

		var calls atomic.Int64
		testenv.Run(t, &testenv.Config{
			RouterOptions: modulePolicySource(config.AuthorizationConfiguration{}, &calls),
			BatchingConfig: config.BatchingConfig{
				Enabled:            true,
				MaxConcurrency:     2,
				MaxEntriesPerBatch: 10,
			},
			ModifyRouterConfig: withPolicyFields(
				policyField("Employee", "id", []string{"read:id"}),
				policyField("Employee", "tag", []string{"read:tag"}),
			),
		}, func(t *testing.T, env *testenv.Environment) {
			res, err := env.MakeGraphQLBatchedRequestRequest([]testenv.GraphQLRequest{
				{
					Query: employeesIDQuery,
				},
				{
					Query: `
						query {
							employees {
								tag
							}
						}`,
				},
				{
					Query: `
						query {
							employees {
								details {
									forename
								}
							}
						}`,
				},
			}, map[string]string{
				custompolicy.Header: "read:id",
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, res.Response.StatusCode)

			var results []json.RawMessage
			require.NoError(t, json.Unmarshal([]byte(res.Body), &results))
			require.Len(t, results, 3)
			require.Contains(t, string(results[0]), `"id":1`)
			require.Contains(t, string(results[1]), "Unauthorized to load field 'Query.employees.tag', Reason: missing policies.")
			require.NotContains(t, string(results[2]), "errors")
			// The third operation needs no policy, so the module is asked twice.
			require.EqualValues(t, 2, calls.Load())
		})
	})

	t.Run("a field is granted when the request has all policies of one AND group", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: modulePolicySource(config.AuthorizationConfiguration{}, nil),
			ModifyRouterConfig: withPolicyFields(
				policyField("Employee", "id", []string{"read:id"}),
				policyField("Employee", "notes", []string{"read:notes"}, []string{"read:id", "read:all"}),
			),
		}, func(t *testing.T, env *testenv.Environment) {
			const query = `
				query {
					employees {
						id
						notes
					}
				}`
			res := env.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  query,
				Header: policyHeader("read:id"),
			})
			require.Contains(t, res.Body, `"id":1`)
			require.Contains(t, res.Body, "Unauthorized to load field 'Query.employees.notes', Reason: missing policies.")
			require.Contains(t, res.Body, `"grantedPolicies":["read:id"]`)

			res = env.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  query,
				Header: policyHeader("read:id", "read:all"),
			})
			require.NotContains(t, res.Body, "errors")
		})
	})

	t.Run("the deferred part of a response uses the decision of the initial part", func(t *testing.T) {
		t.Parallel()

		const query = `
			query {
				employees {
					id
					... @defer {
						isAvailable
					}
				}
			}`
		testenv.Run(t, &testenv.Config{
			RouterOptions:      modulePolicySource(config.AuthorizationConfiguration{}, nil),
			NoRetryClient:      true,
			ModifyRouterConfig: withPolicyFields(policyField("Employee", "isAvailable", []string{"read:availability"})),
		}, func(t *testing.T, env *testenv.Environment) {
			send := func(policies ...string) string {
				payload, err := json.Marshal(testenv.GraphQLRequest{
					Query: query,
				})
				require.NoError(t, err)
				request := env.MakeGraphQLDeferRequest(http.MethodPost, bytes.NewReader(payload))
				for _, policy := range policies {
					request.Header.Add(custompolicy.Header, policy)
				}
				res, err := env.MakeGraphQLRequestRaw(request)
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				return res.Body
			}
			body := send()
			require.Contains(t, body, `"id":1`)
			require.Contains(t, body, "Unauthorized to load field 'Query.employees.isAvailable', Reason: missing policies.")
			require.NotContains(t, body, `"isAvailable":true`)
			require.NotContains(t, body, `"isAvailable":false`)

			body = send("read:availability")
			require.NotContains(t, body, "Unauthorized")
			require.Contains(t, body, `"isAvailable":`)
		})
	})

	t.Run("a subscription decides once at its start and every event enforces the decision", func(t *testing.T) {
		t.Parallel()

		const subscription = `
			subscription {
				currentTime {
					unixTime
				}
			}`
		const denied = `Unauthorized to load field 'Subscription.currentTime.unixTime', Reason: missing policies.`
		run := func(t *testing.T, fn func(t *testing.T, env *testenv.Environment, h http.Header) []string) {
			testenv.Run(t, &testenv.Config{
				RouterOptions:      modulePolicySource(config.AuthorizationConfiguration{}, nil),
				ModifyRouterConfig: withPolicyFields(policyField("Time", "unixTime", []string{"read:time"})),
			}, func(t *testing.T, env *testenv.Environment) {
				for _, event := range fn(t, env, policyHeader()) {
					require.Contains(t, event, denied)
					require.Contains(t, event, `"data":null`)
				}
				for _, event := range fn(t, env, policyHeader("read:time")) {
					require.NotContains(t, event, "Unauthorized")
					require.Contains(t, event, `"unixTime":`)
				}
			})
		}

		t.Run("sse", func(t *testing.T) {
			t.Parallel()

			run(t, func(t *testing.T, env *testenv.Environment, h http.Header) []string {
				ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
				defer cancel()
				events := make(chan string, 8)
				h.Set("Accept", "text/event-stream")
				go env.GraphQLSubscriptionOverSSE(ctx, testenv.GraphQLRequest{
					Query:  subscription,
					Header: h,
				}, func(data string) {
					events <- data
				})
				var out []string
				for len(out) < 2 {
					select {
					case data := <-events:
						out = append(out, data)
					case <-ctx.Done():
						t.Fatal("timed out waiting for a subscription event")
					}
				}
				return out
			})
		})

		t.Run("multipart", func(t *testing.T) {
			t.Parallel()

			run(t, func(t *testing.T, env *testenv.Environment, h http.Header) []string {
				ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
				defer cancel()
				payload, err := json.Marshal(testenv.GraphQLRequest{
					Query: subscription,
				})
				require.NoError(t, err)
				request := env.MakeGraphQLMultipartRequest(http.MethodPost, bytes.NewReader(payload))
				request = request.WithContext(ctx)
				for _, policy := range h.Values(custompolicy.Header) {
					request.Header.Add(custompolicy.Header, policy)
				}
				response, err := env.RouterClient.Do(request)
				require.NoError(t, err)
				defer func() { require.NoError(t, response.Body.Close()) }()
				require.Equal(t, http.StatusOK, response.StatusCode)
				reader := bufio.NewReader(response.Body)
				var out []string
				for len(out) < 2 {
					line, err := reader.ReadString('\n')
					require.NoError(t, err)
					if strings.HasPrefix(line, `{"payload":`) {
						out = append(out, strings.TrimSpace(line))
					}
				}
				return out
			})
		})

		t.Run("websocket", func(t *testing.T) {
			t.Parallel()

			run(t, func(t *testing.T, env *testenv.Environment, h http.Header) []string {
				conn := env.InitGraphQLWebSocketConnection(h, nil, nil)
				defer func() { require.NoError(t, conn.Close()) }()
				payload, err := json.Marshal(testenv.GraphQLRequest{
					Query: subscription,
				})
				require.NoError(t, err)
				require.NoError(t, testenv.WSWriteJSON(t, conn, &testenv.WebSocketMessage{
					ID:      "1",
					Type:    "subscribe",
					Payload: payload,
				}))
				var out []string
				for len(out) < 2 {
					// WSReadJSON allows 2 seconds, too short for a 1 second event source under parallel race tests.
					// A timed-out read breaks the connection, so its retries cannot recover.
					require.NoError(t, conn.SetReadDeadline(time.Now().Add(10*time.Second)))
					var msg testenv.WebSocketMessage
					require.NoError(t, conn.ReadJSON(&msg))
					require.Equal(t, "next", msg.Type)
					out = append(out, string(msg.Payload))
				}
				return out
			})
		})
	})
}
