package integration

import (
	"context"
	"net/http"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutils"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	"go.uber.org/goleak"
)

func TestShutdownGoroutineLeaks(t *testing.T) {
	defer goleak.VerifyNone(t,
		// Freeport, spawned by init
		goleak.IgnoreTopFunction("github.com/wundergraph/cosmo/router-tests/freeport.checkFreedPorts"),
		// HTTPTest server I can't close if I want to keep the problematic goroutine open for the test
		goleak.IgnoreAnyFunction("net/http.(*conn).serve"),
	)

	xEnv, err := testenv.CreateTestEnv(t, &testenv.Config{
		NoRetryClient:        true, // No need for this, just complicates the checks
		NoShutdownTestServer: true, // Shutting down test server will close idle connections

		RouterOptions: []core.Option{
			core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(config.TrafficShapingRules{
				Subgraphs: map[string]config.GlobalSubgraphRequestRule{
					"employees": {
						MaxIdleConns: testutils.ToPtr(10),
					},
					"products": {
						MaxIdleConns: testutils.ToPtr(10),
					},
					"mood": {
						MaxIdleConns: testutils.ToPtr(10),
					},
				},
			})),
		},
	})
	require.NoError(t, err)

	{
		checkCtx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
		defer cancel()

		_, err := xEnv.MakeGraphQLRequestWithContext(checkCtx, testenv.GraphQLRequest{
			Query: `query { employees { id } }`,
		})
		require.NoError(t, err)
	}

	xEnv.Shutdown()

	{
		// Have to use background context since testenv context gets cancelled during Shutdown()
		res, err := xEnv.MakeGraphQLRequestWithContext(context.Background(), testenv.GraphQLRequest{
			Query: `query { employees { id } }`,
		})
		if assert.Error(t, err) {
			require.ErrorIs(t, err, syscall.ECONNREFUSED)
		}
		require.Nil(t, res)
	}
}

const blockRequestHeader = "x-block-request-id"

// blockingRequestModule holds any request carrying the blockRequestHeader open
// inside the graph mux middleware chain until the test releases it. Router
// middlewares are mounted after the in-flight counting middleware in
// buildGraphMux, so a parked request counts as in-flight for as long as it is
// blocked.
type blockingRequestModule struct {
	// entered receives the request's block id once the request is parked,
	// i.e. after the in-flight counter has been incremented.
	entered chan string
	// release maps a block id to a channel that, once closed, lets the
	// request continue. Requests with an unknown id pass through unblocked.
	release map[string]chan struct{}
}

func (m *blockingRequestModule) Middleware(ctx core.RequestContext, next http.Handler) {
	if id := ctx.Request().Header.Get(blockRequestHeader); id != "" {
		if ch, ok := m.release[id]; ok {
			m.entered <- id
			<-ch
		}
	}
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *blockingRequestModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       "blockingRequestModule",
		Priority: 1,
		// Return the shared instance so the test keeps access to the
		// channels; a fresh instance would lose them to mapstructure's
		// zero-value decoding.
		New: func() core.Module { return m },
	}
}

var _ core.RouterMiddlewareHandler = (*blockingRequestModule)(nil)

// When a hot reload's Changes leave a graph untouched, the new graph server
// reuses that graph's mux and traffic keeps flowing through it. The replaced
// server's shutdown drain waits for requests running in the muxes it tears
// down; requests served by the new server through a reused mux are not the
// replaced server's to wait for.
func TestGraphServerShutdown(t *testing.T) {
	t.Parallel()

	t.Run("waits only for requests in muxes it tears down when a hot reload reuses others", func(t *testing.T) {
		t.Parallel()

		const ff1 = "experiment-a"

		initial := buildHelloRouterConfig("v1", "Base v1", map[string]string{ff1: "FF1 v1"})
		poller := newFakeConfigPoller(initial)

		mod := &blockingRequestModule{
			entered: make(chan string, 2),
			release: map[string]chan struct{}{
				"pre-swap":  make(chan struct{}),
				"post-swap": make(chan struct{}),
			},
		}

		// Release the parked requests exactly once no matter which path the
		// test takes: a request still parked at teardown would leak its
		// goroutine (goleak) and stall the router's shutdown for the full
		// shutdown delay.
		releasePreSwap := sync.OnceFunc(func() { close(mod.release["pre-swap"]) })
		releasePostSwap := sync.OnceFunc(func() { close(mod.release["post-swap"]) })
		t.Cleanup(releasePreSwap)
		t.Cleanup(releasePostSwap)

		testenv.Run(t, &testenv.Config{
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: func(_ *nodev1.RouterConfig) configpoller.ConfigPoller {
					return poller
				},
			},
			RouterOptions: []core.Option{
				core.WithConfigVersionHeader(true),
				core.WithCustomModules(mod),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			type result struct {
				res *testenv.TestResponse
				err error
			}

			startBlockedRequest := func(id string, header http.Header) <-chan result {
				header = header.Clone()
				if header == nil {
					header = http.Header{}
				}
				header.Set(blockRequestHeader, id)
				return testenv.Go(func() result {
					res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
						Query:  `query { hello }`,
						Header: header,
					})
					return result{res, err}
				})
			}

			// Step 1: the initial server serves the base graph at v1.
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { hello }`})
			require.Equal(t, "v1", res.Response.Header.Get("X-Router-Config-Version"))

			// Step 2: park a request on the ff1 mux. The reload below changes
			// ff1, so this mux is torn down by the old server's shutdown —
			// the drain must wait for this request.
			preSwapDone := startBlockedRequest("pre-swap", http.Header{"X-Feature-Flag": []string{ff1}})
			testenv.AwaitChannelWithT(t, 10*time.Second, mod.entered, func(t *testing.T, got string) {
				require.Equal(t, "pre-swap", got)
			}, "pre-swap request never reached the blocking middleware")

			// Step 3: emit a reload that changes only the feature flag. The
			// base graph is unchanged, so the new server reuses the base mux.
			// Emit runs the swap synchronously and blocks until the old
			// server's shutdown completes, so it runs on its own goroutine.
			next := buildHelloRouterConfig("v2", "Base v1", map[string]string{ff1: "FF1 v2"})
			emitDone := testenv.Go(func() error {
				return poller.Emit(t, next, &routerconfig.Changes{
					AddedConfigs:   map[string]struct{}{},
					RemovedConfigs: map[string]struct{}{},
					ChangedConfigs: map[string]struct{}{ff1: {}},
				})
			})

			// Step 4: wait until the new server has been swapped in, observed
			// via the rebuilt feature-flag mux serving the v2 version header.
			require.EventuallyWithT(t, func(c *assert.CollectT) {
				ffRes, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
					Query:  `query { hello }`,
					Header: http.Header{"X-Feature-Flag": []string{ff1}},
				})
				if assert.NoError(c, err) {
					assert.Equal(c, "v2-"+ff1, ffRes.Response.Header.Get("X-Router-Config-Version"))
				}
			}, 10*time.Second, 50*time.Millisecond,
				"new graph server must be swapped in and serving the rebuilt feature-flag mux")

			// The old server still owns the parked pre-swap request, so its
			// shutdown (and with it the Emit call) must not have finished.
			select {
			case err := <-emitDone:
				t.Fatalf("config update returned while a request was still in flight in a mux the old server tears down (err: %v)", err)
			default:
			}

			// Step 5: park a second request on the base graph. It is served
			// by the new server through the reused base mux — the old server
			// does not own it and must not wait for it.
			postSwapDone := startBlockedRequest("post-swap", nil)
			testenv.AwaitChannelWithT(t, 10*time.Second, mod.entered, func(t *testing.T, got string) {
				require.Equal(t, "post-swap", got)
			}, "post-swap request never reached the blocking middleware")

			// Step 6: release the old server's own request. From this moment
			// every request in the muxes the old server tears down is done.
			releasePreSwap()
			testenv.AwaitChannelWithT(t, 10*time.Second, preSwapDone, func(t *testing.T, preSwap result) {
				require.NoError(t, preSwap.err)
				require.Equal(t, "v1-"+ff1, preSwap.res.Response.Header.Get("X-Router-Config-Version"),
					"the pre-swap request was served by the old server's ff1 mux")
			}, "pre-swap request did not complete after being released")

			// Step 7: the old server's shutdown must now complete even though
			// the post-swap request is still running through the reused mux.
			testenv.AwaitChannelWithT(t, 10*time.Second, emitDone, func(t *testing.T, err error) {
				require.NoError(t, err)
			}, "old graph server shutdown did not complete after all requests in the muxes it tears down "+
				"had finished; it must not wait on requests served by the new server through a reused mux")

			// Step 8: the post-swap request is still healthy on the new
			// server; release it and verify it completes.
			releasePostSwap()
			testenv.AwaitChannelWithT(t, 10*time.Second, postSwapDone, func(t *testing.T, postSwap result) {
				require.NoError(t, postSwap.err)
				require.Equal(t, "v1", postSwap.res.Response.Header.Get("X-Router-Config-Version"),
					"the post-swap request was served through the reused base mux, whose version header is baked in from v1")
			}, "post-swap request did not complete after being released")
		})
	})
}
