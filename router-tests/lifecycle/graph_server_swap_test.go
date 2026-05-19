package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

// TestHotReload_FailedBuild_KeepsOldServerServing exercises the failure path
// in r.newServer that the recent commit-ordering fix in newGraphServer guards
// against: when newGraphServer returns an error after a hot reload, the router
// must keep using the previously-built graph server, and a subsequent
// successful reload must replace it without leaking the old muxes.
//
// The fix in newGraphServer defers reuse bookkeeping (the mux.reused flag and
// the entry in s.graphMuxList) until after every fallible construction step
// has succeeded. This test verifies two user-visible properties:
//
//  1. A failed hot reload does not interrupt traffic — the router keeps
//     serving the previous config.
//  2. A subsequent successful reload swaps in the new config and tears down
//     the previous server's graph muxes. The teardown is observed via the
//     debug log emitted by graphServer.Shutdown for each mux it shuts down.
func TestHotReload_FailedBuild_KeepsOldServerServing(t *testing.T) {
	t.Parallel()

	configFile := t.TempDir() + "/config.json"
	writeValidLifecycleConfig(t, "initial", configFile)

	testenv.Run(t, &testenv.Config{
		LogObservation: testenv.LogObservationConfig{
			Enabled:  true,
			LogLevel: zapcore.DebugLevel,
		},
		RouterOptions: []core.Option{
			core.WithConfigVersionHeader(true),
			core.WithExecutionConfig(&core.ExecutionConfig{
				Path:          configFile,
				Watch:         true,
				WatchInterval: 100 * time.Millisecond,
			}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		// Step 1: the initial config is serving traffic.
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { hello }`})
		require.Equal(t, "initial", res.Response.Header.Get("X-Router-Config-Version"))
		require.JSONEq(t, `{"data":{"hello":"Hello!"}}`, res.Body)

		// Step 2: write a config that survives JSON unmarshal (so the watcher
		// hands it to r.newServer) but causes newGraphServer to fail when the
		// engine parses the GraphqlSchema field. The reload must be rejected
		// without tearing down the existing server.
		writeBrokenLifecycleConfig(t, "broken", configFile)

		// Wait through several watcher ticks so the broken reload is attempted
		// and rejected. We then assert the router is *still* serving from the
		// initial config — if the old server had been torn down on the failed
		// reload, requests would fail or return a different version header.
		require.Never(t, func() bool {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { hello }`})
			return res.Response.Header.Get("X-Router-Config-Version") != "initial"
		}, 1500*time.Millisecond, 100*time.Millisecond,
			"router must continue serving the previous config while a failed hot reload is in flight")

		// Sanity: the watcher actually saw the broken config and the reload
		// was rejected at the newGraphServer layer.
		require.NotEmpty(t,
			xEnv.Observer().FilterMessage("Failed to update server with new config").All(),
			"watcher should have attempted the broken reload and logged the failure")

		// Step 3: replace the broken config with a fresh valid one. The router
		// must recover and start serving the new version.
		writeValidLifecycleConfig(t, "newValidConfig", configFile)

		require.EventuallyWithT(t, func(c *assert.CollectT) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { hello }`})
			assert.Equal(c, "newValidConfig", res.Response.Header.Get("X-Router-Config-Version"))
			assert.JSONEq(c, `{"data":{"hello":"Hello!"}}`, res.Body)
		}, 3*time.Second, 100*time.Millisecond,
			"router must recover and serve the new config once a valid one is written")

		// Step 4: verify the old initial-config muxes were actually torn down
		// when the recovery reload swapped the new graph server in. The
		// recovery reload calls SwapGraphServer, which in turn calls
		// graphServer.Shutdown on the previous server; that loop emits a
		// "shutting down graph mux" debug log for each mux it cleans up.
		// We require at least one such entry, which corresponds to the base
		// graph mux of the initial config.
		require.EventuallyWithT(t, func(c *assert.CollectT) {
			shutdownLogs := xEnv.Observer().FilterMessage("shutting down graph mux").All()
			assert.NotEmpty(c, shutdownLogs,
				"the initial config's graph mux must be shut down once the recovery reload installs a new server")
		}, 3*time.Second, 100*time.Millisecond)

		// And the reused-skip path must NOT have fired: in the file-watch
		// reload path, Changes is nil, so the new graphServer never reuses any
		// previous mux. Every previous mux should be torn down outright. If
		// this ever flips, it would mean an unintended reuse decision is being
		// taken on the file-watch hot reload path.
		reuseSkipLogs := xEnv.Observer().FilterMessage("graph mux is being reused by new graph server, skipping shutdown").All()
		require.Empty(t, reuseSkipLogs,
			"file-watch reloads always rebuild from scratch; no mux should have been skipped via the reuse flag")
	})
}

// writeValidLifecycleConfig writes a minimal but fully valid router execution
// config with the given version to path. The schema exposes a single
// `hello` query backed by a static datasource so the test does not depend on
// any external subgraph.
func writeValidLifecycleConfig(t *testing.T, version, path string) {
	t.Helper()

	cfg := &nodev1.RouterConfig{
		Version: version,
		EngineConfig: &nodev1.EngineConfiguration{
			DefaultFlushInterval: 500,
			DatasourceConfigurations: []*nodev1.DataSourceConfiguration{
				{
					Kind: nodev1.DataSourceKind_STATIC,
					RootNodes: []*nodev1.TypeField{
						{
							TypeName:   "Query",
							FieldNames: []string{"hello"},
						},
					},
					CustomStatic: &nodev1.DataSourceCustom_Static{
						Data: &nodev1.ConfigurationVariable{
							StaticVariableContent: `{"hello": "Hello!"}`,
						},
					},
					Id: "0",
				},
			},
			GraphqlSchema: "schema {\n  query: Query\n}\ntype Query {\n  hello: String\n}",
			FieldConfigurations: []*nodev1.FieldConfiguration{
				{
					TypeName:  "Query",
					FieldName: "hello",
				},
			},
		},
	}

	bytes, err := json.Marshal(cfg)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, bytes, 0644))
}

// writeBrokenLifecycleConfig writes a config that unmarshals correctly but
// causes newGraphServer to fail when the engine parses the GraphqlSchema
// field (the contents are not a valid GraphQL SDL document).
func writeBrokenLifecycleConfig(t *testing.T, version, path string) {
	t.Helper()

	cfg := &nodev1.RouterConfig{
		Version: version,
		EngineConfig: &nodev1.EngineConfiguration{
			DefaultFlushInterval: 500,
			GraphqlSchema:        "this is not valid graphql sdl @@@ %%% &&&",
		},
	}

	bytes, err := json.Marshal(cfg)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, bytes, 0644))
}

// TestHotReload_PartialFeatureFlagChange_ReusesUnchangedMuxes exercises the
// reuse code path in newGraphServer and buildMultiGraphHandler: when a config
// reload arrives with non-nil Changes that mark only some feature flags as
// modified, the previous server's base mux and the unchanged feature-flag
// muxes must be reused by the new server, and only the modified feature
// flag's mux must be torn down.
//
// The file-watch reload path always passes Changes=nil and therefore always
// rebuilds every mux, so we use testenv's ConfigPollerFactory hook to inject
// a fake poller that emits reloads with the exact Changes we want.
func TestHotReload_PartialFeatureFlagChange_ReusesUnchangedMuxes(t *testing.T) {
	t.Parallel()

	const (
		ff1 = "experiment-a"
		ff2 = "experiment-b"
		ff3 = "experiment-c"
	)

	initial := buildHelloRouterConfig("v1", "Base v1", map[string]string{
		ff1: "FF1 v1",
		ff2: "FF2 v1",
		ff3: "FF3 v1",
	})

	poller := newFakeConfigPoller(initial)

	testenv.Run(t, &testenv.Config{
		LogObservation: testenv.LogObservationConfig{
			Enabled:  true,
			LogLevel: zapcore.DebugLevel,
		},
		RouterConfig: &testenv.RouterConfig{
			ConfigPollerFactory: func(_ *nodev1.RouterConfig) configpoller.ConfigPoller {
				return poller
			},
		},
		RouterOptions: []core.Option{
			core.WithConfigVersionHeader(true),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		// The X-Router-Config-Version response header is baked into each mux
		// at build time, so it doubles as a "did this mux get rebuilt?"
		// fingerprint: a request routed to a reused mux returns that mux's
		// original version, while a request routed to a freshly-built mux
		// returns the version from the new config.
		ff1Header := http.Header{"X-Feature-Flag": []string{ff1}}
		ff2Header := http.Header{"X-Feature-Flag": []string{ff2}}
		ff3Header := http.Header{"X-Feature-Flag": []string{ff3}}

		// Step 1: prime the per-mux versions on the initial server.
		baseRes := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { hello }`})
		require.Equal(t, "v1", baseRes.Response.Header.Get("X-Router-Config-Version"))
		require.JSONEq(t, `{"data":{"hello":"Base v1"}}`, baseRes.Body)

		ff1Res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { hello }`, Header: ff1Header})
		require.Equal(t, "v1-"+ff1, ff1Res.Response.Header.Get("X-Router-Config-Version"))

		ff2Res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { hello }`, Header: ff2Header})
		require.Equal(t, "v1-"+ff2, ff2Res.Response.Header.Get("X-Router-Config-Version"))

		ff3Res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { hello }`, Header: ff3Header})
		require.Equal(t, "v1-"+ff3, ff3Res.Response.Header.Get("X-Router-Config-Version"))

		// Capture the observer position so the post-reload log assertions
		// only consider entries produced by the reload itself.
		baseline := len(xEnv.Observer().All())

		// Step 2: emit a reload that exercises all three branches at once.
		//   - base graph is unchanged              → reused
		//   - ff1 has changed                      → rebuilt
		//   - ff2 is unchanged                     → reused
		//   - ff3 has been removed from the config → torn down. A removed
		//     flag is implicitly handled: the loop in buildMultiGraphHandler
		//     never visits it because the new config does not list it, so its
		//     old mux is not in the new server's reused list and the previous
		//     server's Shutdown loop sees reused=false and tears it down.
		next := buildHelloRouterConfig("v2", "Base v1", map[string]string{
			ff1: "FF1 v2",
			ff2: "FF2 v1",
		})
		require.NoError(t, poller.Emit(t, next, &routerconfig.Changes{
			AddedConfigs:   map[string]struct{}{},
			RemovedConfigs: map[string]struct{}{ff3: {}},
			ChangedConfigs: map[string]struct{}{ff1: {}},
		}))

		// Step 3: probe each mux to confirm which were reused, rebuilt, or
		// removed.
		baseRes = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { hello }`})
		require.Equal(t, "v1", baseRes.Response.Header.Get("X-Router-Config-Version"),
			"the base mux must be reused; its baked-in version must be unchanged")
		require.JSONEq(t, `{"data":{"hello":"Base v1"}}`, baseRes.Body)

		ff1Res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { hello }`, Header: ff1Header})
		require.Equal(t, "v2-"+ff1, ff1Res.Response.Header.Get("X-Router-Config-Version"),
			"the ff1 mux must be rebuilt; its baked-in version must reflect the new config")
		require.JSONEq(t, `{"data":{"hello":"FF1 v2"}}`, ff1Res.Body)

		ff2Res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { hello }`, Header: ff2Header})
		require.Equal(t, "v1-"+ff2, ff2Res.Response.Header.Get("X-Router-Config-Version"),
			"the ff2 mux must be reused; its baked-in version must be unchanged")
		require.JSONEq(t, `{"data":{"hello":"FF2 v1"}}`, ff2Res.Body)

		// ff3 is gone from the new config, so the feature-flag router no
		// longer has a dedicated mux for it. Requests with the now-removed
		// flag fall back to the base mux (see the handler at the bottom of
		// buildMultiGraphHandler), which serves the base graph at "v1".
		ff3Res = xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { hello }`, Header: ff3Header})
		require.Equal(t, "v1", ff3Res.Response.Header.Get("X-Router-Config-Version"),
			"requests for a removed feature flag must fall back to the base mux")
		require.JSONEq(t, `{"data":{"hello":"Base v1"}}`, ff3Res.Body)

		// Step 4: classify the cleanup-loop logs from the previous server's
		// Shutdown into reused vs torn-down muxes by key.
		newEntries := xEnv.Observer().All()[baseline:]
		reusedKeys := collectMuxKeys(newEntries,
			"graph mux is being reused by new graph server, skipping shutdown")
		shutDownKeys := collectMuxKeys(newEntries, "shutting down graph mux")

		require.ElementsMatch(t, []string{"", ff2}, reusedKeys,
			"the base mux and the unchanged feature-flag mux must be reused")
		require.ElementsMatch(t, []string{ff1, ff3}, shutDownKeys,
			"the modified feature-flag mux and the removed feature-flag mux must both be torn down")
	})
}

// fakeConfigPoller implements configpoller.ConfigPoller for tests. It returns
// a fixed initial config from GetRouterConfig and captures the handler passed
// to Subscribe so the test can drive subsequent reloads with controlled
// Config and Changes values via Emit.
type fakeConfigPoller struct {
	initial *routerconfig.Response

	mu      sync.Mutex
	handler func(response *routerconfig.Response) error
}

func newFakeConfigPoller(initial *nodev1.RouterConfig) *fakeConfigPoller {
	return &fakeConfigPoller{
		initial: &routerconfig.Response{Config: initial},
	}
}

func (f *fakeConfigPoller) GetRouterConfig(_ context.Context) (*routerconfig.Response, error) {
	return f.initial, nil
}

func (f *fakeConfigPoller) Subscribe(_ context.Context, handler func(response *routerconfig.Response) error) {
	f.mu.Lock()
	f.handler = handler
	f.mu.Unlock()
}

// Emit invokes the Subscribe handler synchronously with the given config and
// changes. SwapGraphServer (called from the handler) is itself synchronous,
// so when Emit returns the previous server has been fully shut down and any
// per-mux cleanup logs have been written to the observer.
func (f *fakeConfigPoller) Emit(t *testing.T, cfg *nodev1.RouterConfig, changes *routerconfig.Changes) error {
	t.Helper()
	f.mu.Lock()
	h := f.handler
	f.mu.Unlock()
	if h == nil {
		return fmt.Errorf("fakeConfigPoller: Subscribe was never called by the router")
	}
	return h(&routerconfig.Response{Config: cfg, Changes: changes})
}

// buildHelloRouterConfig builds a router config that exposes a `hello` query
// backed by a static datasource. featureFlags maps feature-flag name to the
// message that flag's hello field should return, allowing the caller to give
// each variant a distinct payload when needed.
func buildHelloRouterConfig(version, baseMessage string, featureFlags map[string]string) *nodev1.RouterConfig {
	cfg := &nodev1.RouterConfig{
		Version:      version,
		EngineConfig: buildHelloEngineConfig(baseMessage),
	}
	if len(featureFlags) == 0 {
		return cfg
	}
	cfg.FeatureFlagConfigs = &nodev1.FeatureFlagRouterExecutionConfigs{
		ConfigByFeatureFlagName: make(map[string]*nodev1.FeatureFlagRouterExecutionConfig, len(featureFlags)),
	}
	for name, message := range featureFlags {
		cfg.FeatureFlagConfigs.ConfigByFeatureFlagName[name] = &nodev1.FeatureFlagRouterExecutionConfig{
			Version:      version + "-" + name,
			EngineConfig: buildHelloEngineConfig(message),
		}
	}
	return cfg
}

func buildHelloEngineConfig(message string) *nodev1.EngineConfiguration {
	return &nodev1.EngineConfiguration{
		DefaultFlushInterval: 500,
		DatasourceConfigurations: []*nodev1.DataSourceConfiguration{
			{
				Kind: nodev1.DataSourceKind_STATIC,
				RootNodes: []*nodev1.TypeField{
					{TypeName: "Query", FieldNames: []string{"hello"}},
				},
				CustomStatic: &nodev1.DataSourceCustom_Static{
					Data: &nodev1.ConfigurationVariable{
						StaticVariableContent: fmt.Sprintf(`{"hello": %q}`, message),
					},
				},
				Id: "0",
			},
		},
		GraphqlSchema: "schema {\n  query: Query\n}\ntype Query {\n  hello: String\n}",
		FieldConfigurations: []*nodev1.FieldConfiguration{
			{TypeName: "Query", FieldName: "hello"},
		},
	}
}

// collectMuxKeys returns the values of the `mux` string field from every
// observed log entry whose message equals msg. The cleanup loop in
// graphServer.Shutdown logs one entry per mux with this field, so the
// resulting slice describes exactly which muxes followed the reuse path vs
// the shutdown path.
func collectMuxKeys(entries []observer.LoggedEntry, msg string) []string {
	keys := make([]string, 0)
	for _, e := range entries {
		if e.Message != msg {
			continue
		}
		for _, f := range e.Context {
			if f.Key == "mux" && f.Type == zapcore.StringType {
				keys = append(keys, f.String)
			}
		}
	}
	return keys
}
