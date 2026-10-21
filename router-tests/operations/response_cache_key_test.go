package integration

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// moodFrom answers the mood batch with SAD when pick says so, else HAPPY.
func moodFrom(cacheControl, vary string, pick func(r *http.Request, body []byte) bool) func(http.Handler) http.Handler {
	return func(http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			body, _ := io.ReadAll(r.Body)
			mood := "HAPPY"
			if pick(r, body) {
				mood = "SAD"
			}
			entity := fmt.Sprintf(`{"__typename":"Employee","currentMood":%q}`, mood)
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", cacheControl)
			if vary != "" {
				w.Header().Set("Vary", vary)
			}
			_, _ = fmt.Fprintf(w, `{"data":{"_entities":[%s]}}`, strings.Repeat(entity+",", 9)+entity)
		})
	}
}

// tenantModule sets X-Tenant on subgraph requests outside the header rules.
type tenantModule struct{}

func (tenantModule) Module() core.ModuleInfo {
	return core.ModuleInfo{ID: "auditTenantModule", New: func() core.Module { return &tenantModule{} }}
}

func (tenantModule) OnOriginRequest(req *http.Request, ctx core.RequestContext) (*http.Request, *http.Response) {
	req.Header.Set("X-Tenant", ctx.Request().Header.Get("X-Client-Tenant"))
	return req, nil
}

var _ core.EnginePreOriginHandler = (*tenantModule)(nil)

// TestResponseCacheKey covers requests that differ, and must not share an entry.
func TestResponseCacheKey(t *testing.T) {
	t.Parallel()

	moodCached := testenv.SubgraphsConfig{
		Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("public, max-age=60")},
	}

	t.Run("a mutation's entity fetch is not served from the cache", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(t, time.Minute),
			Subgraphs:     moodCached,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `mutation { updateEmployeeTag(id: 1, tag: "x") { id currentMood } }`})
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(),
				"read-after-write: the mutation must see fresh entities")
		})
	})

	authForwarded := func(t *testing.T) []core.Option {
		return append(responseCacheOptions(t, time.Minute), core.WithHeaderRules(config.HeaderRules{
			All: &config.GlobalHeaderRule{Request: []*config.RequestHeaderRule{
				{Operation: config.HeaderRuleOperationPropagate, Named: "Authorization"},
			}},
		}))
	}
	asUser := func(xEnv *testenv.Environment, token string) {
		xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery, Header: http.Header{"Authorization": {"Bearer " + token}}})
	}

	t.Run("a response to a forwarded Authorization is not shared without public", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: authForwarded(t),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			asUser(xEnv, "alice")
			asUser(xEnv, "bob")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(),
				"RFC 9111 §3.5: shared caches must not reuse an authorized response without public")
		})
	})

	t.Run("public makes an authorized response shareable", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: authForwarded(t),
			Subgraphs:     moodCached,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			asUser(xEnv, "alice")
			asUser(xEnv, "bob")
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
		})
	})

	t.Run("Vary on a header a custom module sets keeps tenants apart", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: append(responseCacheOptions(t, time.Minute),
				core.WithModulesConfig(map[string]any{"auditTenantModule": tenantModule{}}),
				core.WithCustomModules(&tenantModule{}),
			),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: moodFrom("public, max-age=60", "X-Tenant", func(r *http.Request, _ []byte) bool {
					return r.Header.Get("X-Tenant") == "sad"
				})},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			as := func(tenant string) *testenv.TestResponse {
				return xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery, Header: http.Header{"X-Client-Tenant": {tenant}}})
			}
			require.Contains(t, as("happy").Body, `"HAPPY"`)
			require.Contains(t, as("sad").Body, `"SAD"`, "the sad tenant was served the happy tenant's variant")
		})
	})

	t.Run("forwarded extensions keep their answers apart", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: responseCacheOptions(t, time.Minute),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: moodFrom("public, max-age=60", "", func(_ *http.Request, body []byte) bool {
					return strings.Contains(string(body), `"tenant":"sad"`)
				})},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			as := func(tenant string) *testenv.TestResponse {
				return xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery, Extensions: []byte(`{"tenant":"` + tenant + `"}`)})
			}
			require.Contains(t, as("happy").Body, `"HAPPY"`)
			require.Contains(t, as("sad").Body, `"SAD"`, "the sad extensions were served the happy answer")
		})
	})

	t.Run("without the cache the subgraph tells tenants apart", func(t *testing.T) {
		t.Parallel()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(map[string]any{"auditTenantModule": tenantModule{}}),
				core.WithCustomModules(&tenantModule{}),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: moodFrom("public, max-age=60", "X-Tenant", func(r *http.Request, body []byte) bool {
					return r.Header.Get("X-Tenant") == "sad" || strings.Contains(string(body), `"tenant":"sad"`)
				})},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			byHeader := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery, Header: http.Header{"X-Client-Tenant": {"sad"}}})
			require.Contains(t, byHeader.Body, `"SAD"`, "the module's header reaches the subgraph")
			byExtensions := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery, Extensions: []byte(`{"tenant":"sad"}`)})
			require.Contains(t, byExtensions.Body, `"SAD"`, "the extensions reach the subgraph")
		})
	})
}
