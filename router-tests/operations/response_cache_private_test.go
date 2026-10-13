package integration

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router-tests/freeport"
	"github.com/wundergraph/cosmo/router-tests/jwks"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutils"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

const (
	privateUserHeader     = "X-User-Id"
	privateUserExpression = "request.header.Get('X-User-Id')"
)

// privateMoodMiddleware answers the mood entity batch with the mood the caller
// asked for: a subgraph personalising on a forwarded header, as one that
// marks its answers private would.
func privateMoodMiddleware(cacheControl string) func(http.Handler) http.Handler {
	return func(http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mood := "HAPPY"
			if r.Header.Get(privateUserHeader) == "sad" {
				mood = "SAD"
			}
			entity := fmt.Sprintf(`{"__typename":"Employee","currentMood":%q}`, mood)
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", cacheControl)
			_, _ = fmt.Fprintf(w, `{"data":{"_entities":[%s]}}`, strings.Repeat(entity+",", 9)+entity)
		})
	}
}

// privateMoodConfig scopes private answers to the caller named by the header,
// which is also forwarded so the subgraph can personalise on it.
func privateMoodConfig(t *testing.T, mutate func(cfg *config.ResponseCacheConfiguration)) (*config.ResponseCacheConfiguration, []core.Option) {
	t.Helper()

	cfg := responseCacheConfig(t, time.Minute)
	cfg.All.PrivateID = privateUserExpression
	if mutate != nil {
		mutate(cfg)
	}
	return cfg, []core.Option{
		responseCacheStorageProviders(),
		core.WithResponseCache(cfg),
		core.WithHeaderRules(config.HeaderRules{
			All: &config.GlobalHeaderRule{
				Request: []*config.RequestHeaderRule{
					{Operation: config.HeaderRuleOperationPropagate, Named: privateUserHeader},
				},
			},
		}),
	}
}

func moodAs(t *testing.T, xEnv *testenv.Environment, user string) *testenv.TestResponse {
	t.Helper()
	req := testenv.GraphQLRequest{Query: moodQuery}
	if user != "" {
		req.Header = http.Header{privateUserHeader: []string{user}}
	}
	return xEnv.MakeGraphQLRequestOK(req)
}

func requireMood(t *testing.T, res *testenv.TestResponse, mood string) {
	t.Helper()
	require.Contains(t, res.Body, `"currentMood":"`+mood+`"`)
	require.NotContains(t, res.Body, `"errors"`)
}

// privateKeySegments is how many ':' separated segments a per-user key has;
// a shared key has one fewer.
const privateKeySegments = 4

func requireKeysScoped(t *testing.T, prefix string, count int, private bool) {
	t.Helper()
	entries, _ := responseCacheStored(t, prefix)
	require.Len(t, entries, count)
	want := privateKeySegments
	if !private {
		want--
	}
	for _, entry := range entries {
		require.Len(t, strings.Split(entry, ":"), want, "key %s", entry)
	}
}

func TestResponseCachePrivate(t *testing.T) {
	t.Parallel()

	t.Run("each user is served their own entry", func(t *testing.T) {
		t.Parallel()

		cfg, opts := privateMoodConfig(t, nil)
		testenv.Run(t, &testenv.Config{
			RouterOptions: opts,
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: privateMoodMiddleware("private, max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			requireMood(t, moodAs(t, xEnv, "happy"), "HAPPY")
			requireMood(t, moodAs(t, xEnv, "happy"), "HAPPY")
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(), "the second request is a hit")

			requireMood(t, moodAs(t, xEnv, "sad"), "SAD")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(), "another user is not served the first user's entry")

			requireMood(t, moodAs(t, xEnv, "sad"), "SAD")
			requireMood(t, moodAs(t, xEnv, "happy"), "HAPPY")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())

			requireKeysScoped(t, cfg.KeyPrefix, 20, true)
		})
	})

	t.Run("without an id a private response is not cached", func(t *testing.T) {
		t.Parallel()

		cfg, opts := privateMoodConfig(t, nil)
		testenv.Run(t, &testenv.Config{
			RouterOptions: opts,
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: privateMoodMiddleware("private, max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			requireMood(t, moodAs(t, xEnv, ""), "HAPPY")
			requireMood(t, moodAs(t, xEnv, ""), "HAPPY")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())

			entries, _ := responseCacheStored(t, cfg.KeyPrefix)
			require.Empty(t, entries)

			// A user who was cached is not served to the anonymous caller either.
			requireMood(t, moodAs(t, xEnv, "sad"), "SAD")
			requireMood(t, moodAs(t, xEnv, ""), "HAPPY")
			require.EqualValues(t, 4, xEnv.SubgraphRequestCount.Mood.Load())
		})
	})

	t.Run("a public response is shared across users", func(t *testing.T) {
		t.Parallel()

		cfg, opts := privateMoodConfig(t, nil)
		testenv.Run(t, &testenv.Config{
			RouterOptions: opts,
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: privateMoodMiddleware("public, max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			requireMood(t, moodAs(t, xEnv, "happy"), "HAPPY")
			requireMood(t, moodAs(t, xEnv, "sad"), "HAPPY")
			requireMood(t, moodAs(t, xEnv, ""), "HAPPY")
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(),
				"the subgraph declared its answer shareable, and an id does not change that")

			requireKeysScoped(t, cfg.KeyPrefix, 10, false)
		})
	})

	t.Run("a private hit tells the client it is private", func(t *testing.T) {
		t.Parallel()

		_, opts := privateMoodConfig(t, nil)
		testenv.Run(t, &testenv.Config{
			RouterOptions:      opts,
			CacheControlPolicy: config.CacheControlPolicy{Enabled: true, Value: "max-age=300"},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: privateMoodMiddleware("private, max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			moodAs(t, xEnv, "happy")
			second := moodAs(t, xEnv, "happy")
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())

			cacheControl := second.Response.Header.Get("Cache-Control")
			require.Contains(t, cacheControl, "private")
			require.NotContains(t, cacheControl, "public")
			maxAge := maxAgeOf(t, cacheControl)
			require.Positive(t, maxAge)
			require.LessOrEqual(t, maxAge, 60, "the entry's remaining life, not the 300 default")
		})
	})

	t.Run("invalidating the subgraph drops private entries", func(t *testing.T) {
		t.Parallel()

		addr := fmt.Sprintf("127.0.0.1:%d", freeport.GetOne(t))
		cfg, opts := privateMoodConfig(t, func(cfg *config.ResponseCacheConfiguration) {
			cfg.Invalidation.Endpoint = config.ResponseCacheInvalidationEndpointConfig{
				Enabled:    true,
				ListenAddr: addr,
				Path:       "/invalidation",
				SharedKey:  responseCacheSharedKey,
			}
		})
		testenv.Run(t, &testenv.Config{
			RouterOptions: opts,
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: privateMoodMiddleware("private, max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			moodAs(t, xEnv, "happy")
			requireKeysScoped(t, cfg.KeyPrefix, 10, true)

			req, err := http.NewRequest(http.MethodPost, "http://"+addr+"/invalidation",
				strings.NewReader(`[{"kind":"subgraph","subgraph":"mood"}]`))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", responseCacheSharedKey)
			res, err := http.DefaultClient.Do(req)
			require.NoError(t, err)
			defer func() { _ = res.Body.Close() }()
			var decoded struct {
				Count int `json:"count"`
			}
			require.NoError(t, json.NewDecoder(res.Body).Decode(&decoded))
			require.Equal(t, http.StatusAccepted, res.StatusCode)
			require.Equal(t, 10, decoded.Count)

			moodAs(t, xEnv, "happy")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())
		})
	})

	t.Run("the id can come from a claim", func(t *testing.T) {
		t.Parallel()

		authServer, err := jwks.NewServer(t)
		require.NoError(t, err)
		t.Cleanup(authServer.Close)
		tokenDecoder, _ := authentication.NewJwksTokenDecoder(testutils.NewContextWithCancel(t), zap.NewNop(), []authentication.JWKSConfig{
			{URL: authServer.JWKSURL(), RefreshInterval: 5 * time.Second},
		})
		authenticator, err := authentication.NewHttpHeaderAuthenticator(authentication.HttpHeaderAuthenticatorOptions{
			Name:         "my-jwks-server",
			TokenDecoder: tokenDecoder,
		})
		require.NoError(t, err)
		accessController, err := core.NewAccessController(core.AccessControllerOptions{
			Authenticators:         []authentication.Authenticator{authenticator},
			AuthenticationRequired: false,
		})
		require.NoError(t, err)

		cfg, opts := privateMoodConfig(t, func(cfg *config.ResponseCacheConfiguration) {
			cfg.All.PrivateID = "request.auth.claims.sub"
		})
		testenv.Run(t, &testenv.Config{
			RouterOptions: append(opts, core.WithAccessController(accessController)),
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: privateMoodMiddleware("private, max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			as := func(sub string) {
				t.Helper()
				token, err := authServer.Token(map[string]any{"sub": sub})
				require.NoError(t, err)
				res, err := xEnv.MakeGraphQLRequestWithHeaders(testenv.GraphQLRequest{Query: moodQuery},
					map[string]string{"Authorization": "Bearer " + token})
				require.NoError(t, err)
				require.Equal(t, http.StatusOK, res.Response.StatusCode)
				requireMood(t, res, "HAPPY")
			}

			as("alice")
			as("alice")
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
			as("bob")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())

			// Anonymous: the claim is nil, which is no id, and no error.
			moodAs(t, xEnv, "")
			moodAs(t, xEnv, "")
			require.EqualValues(t, 4, xEnv.SubgraphRequestCount.Mood.Load())

			requireKeysScoped(t, cfg.KeyPrefix, 20, true)
		})
	})

	t.Run("the in memory provider scopes entries the same way", func(t *testing.T) {
		t.Parallel()

		_, opts := privateMoodConfig(t, func(cfg *config.ResponseCacheConfiguration) {
			cfg.Storage = config.ResponseCacheStorageConfig{
				Provider:   config.ResponseCacheStorageProviderMemory,
				MaxEntries: 1000,
			}
		})
		testenv.Run(t, &testenv.Config{
			RouterOptions: opts,
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: privateMoodMiddleware("private, max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			requireMood(t, moodAs(t, xEnv, "happy"), "HAPPY")
			requireMood(t, moodAs(t, xEnv, "happy"), "HAPPY")
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load())
			requireMood(t, moodAs(t, xEnv, "sad"), "SAD")
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())
			requireMood(t, moodAs(t, xEnv, ""), "HAPPY")
			requireMood(t, moodAs(t, xEnv, ""), "HAPPY")
			require.EqualValues(t, 4, xEnv.SubgraphRequestCount.Mood.Load())
		})
	})
}
