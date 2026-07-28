package telemetry

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"sort"
	"strings"
	"sync"
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
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.uber.org/zap/zapcore"
	"google.golang.org/protobuf/proto"
)

// A reused mux keeps the transports, and therefore the connection stats, of the
// server that built it. When those stats were graph-server-scoped, the outgoing
// server's shutdown unregistered their callback and the reused mux dropped out
// of router.http.client.active_connections.
//
// Only a feature flag changes here, so the base mux is reused and every
// post-reload request goes through it.
func TestConnectionMetrics_ReusedMuxAfterHotReload(t *testing.T) {
	t.Parallel()

	const featureFlag = "connection-metrics-ff"

	metricReader := metric.NewManualReader()
	poller := newReloadConfigPoller(map[string]string{featureFlag: "v1"})

	testenv.Run(t, connectionMetricsReloadEnv(metricReader, poller), func(t *testing.T, xEnv *testenv.Environment) {
		// Step 1: one request opens exactly one pooled connection.
		xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: queryEmployeesSubgraph})
		requireActiveConnections(t, metricReader, connectionsBySubgraph{"employees": 1})

		baseline := len(xEnv.Observer().All())

		// Step 2: reload with a change that only touches the feature flag. The
		// base graph is untouched, so the base mux must be reused as-is.
		require.NoError(t, poller.Emit(
			poller.configWithFeatureFlags(map[string]string{featureFlag: "v2"}),
			&routerconfig.Changes{
				AddedConfigs:   map[string]struct{}{},
				RemovedConfigs: map[string]struct{}{},
				ChangedConfigs: map[string]struct{}{featureFlag: {}},
			},
		))

		// Guard the premise of the test: if the base mux were rebuilt, its new
		// transports would feed the new server's stats and the assertion below
		// would pass without exercising the reuse path at all.
		require.Contains(t, muxKeysFor(xEnv, baseline, muxReusedMessage), "",
			"the base mux must be reused by the new graph server")

		// Step 3: drive traffic through the reused base mux only. The rebuilt
		// feature-flag mux is never asked to serve a request, so it never dials
		// a subgraph and contributes nothing to the metric.
		xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: queryEmployeesSubgraph})

		// Step 4: still exactly one. Before the fix the callback covering the
		// reused mux was unregistered and this reported nothing at all.
		requireActiveConnections(t, metricReader, connectionsBySubgraph{"employees": 1})
	})
}

// Covers muxes that appear and disappear. One flag is removed and two added, so
// the mux count changes (3 -> 4); a symmetric swap could hide bugs that only
// show up when the population grows or shrinks.
//
// Every role drives traffic to a subgraph no other mux touches, so each data
// point is attributable to one mux: base -> products, reused flag -> test1,
// removed flag -> family, added A -> mood, added B -> hobbies. The mood and
// hobbies queries resolve an Employee entity, so employees is shared and never
// asserted on.
//
// The removed flag's subgraph must fall back to zero: the stats now live for the
// whole router lifetime, so a missing decrement would accumulate forever.
func TestConnectionMetrics_AddedAndRemovedMuxesAfterHotReload(t *testing.T) {
	t.Parallel()

	const (
		ffReused  = "kept-flag"
		ffRemoved = "dropped-flag"
		ffAddedA  = "new-flag-a"
		ffAddedB  = "new-flag-b"
	)

	metricReader := metric.NewManualReader()
	poller := newReloadConfigPoller(map[string]string{
		ffReused:  "v1",
		ffRemoved: "v1",
	})

	testenv.Run(t, connectionMetricsReloadEnv(metricReader, poller), func(t *testing.T, xEnv *testenv.Environment) {
		// Step 1: open a connection from every mux of the initial server, each
		// to its own subgraph.
		xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: queryProductsSubgraph})
		xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: queryTest1Subgraph, Header: featureFlagHeader(ffReused)})
		xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: queryFamilySubgraph, Header: featureFlagHeader(ffRemoved)})

		requireActiveConnections(t, metricReader, connectionsBySubgraph{
			"products": 1, "test1": 1, "family": 1,
		})

		baseline := len(xEnv.Observer().All())

		// Step 2: drop one feature flag and add two. The base graph and the kept
		// flag are unchanged, so their muxes are reused; the dropped flag's mux
		// is torn down with the previous server.
		require.NoError(t, poller.Emit(
			poller.configWithFeatureFlags(map[string]string{
				ffReused: "v1",
				ffAddedA: "v1",
				ffAddedB: "v1",
			}),
			&routerconfig.Changes{
				AddedConfigs:   map[string]struct{}{ffAddedA: {}, ffAddedB: {}},
				RemovedConfigs: map[string]struct{}{ffRemoved: {}},
				ChangedConfigs: map[string]struct{}{},
			},
		))

		// Guard the premise: without the expected reuse/teardown split the
		// assertions below would not mean what they claim.
		require.ElementsMatch(t, []string{"", ffReused}, muxKeysFor(xEnv, baseline, muxReusedMessage),
			"the base mux and the unchanged feature-flag mux must be reused")
		require.Equal(t, []string{ffRemoved}, muxKeysFor(xEnv, baseline, muxShutdownMessage),
			"only the removed feature-flag mux must be torn down")

		// The old server closed every idle connection it owned, including those of
		// the muxes it handed over. Released means decremented, not gone: the stats
		// are insert-only, so each subgraph keeps reporting a zero.
		requireActiveConnections(t, metricReader, connectionsBySubgraph{
			"products": 0, "test1": 0, "family": 0,
		})

		// Step 4: drive traffic through every mux of the new server — the two
		// reused ones and the two freshly built ones.
		xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: queryProductsSubgraph})
		xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: queryTest1Subgraph, Header: featureFlagHeader(ffReused)})
		xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: queryMoodSubgraph, Header: featureFlagHeader(ffAddedA)})
		xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: queryHobbiesSubgraph, Header: featureFlagHeader(ffAddedB)})

		// One connection per subgraph: the two reused muxes re-dialled through the
		// transports they kept, the two new ones through the new server's. employees
		// stays at one because both new muxes share that transport. family, whose
		// mux is gone, must not come back through a stale counter.
		requireActiveConnections(t, metricReader, connectionsBySubgraph{
			"products": 1, "test1": 1, "mood": 1, "hobbies": 1, "employees": 1, "family": 0,
		})
	})
}

// The first four resolve within a single subgraph, so a connection identifies
// the mux that served the request. The last two also reach employees.
const (
	queryEmployeesSubgraph = `query { employees { id } }`
	queryProductsSubgraph  = `query { factTypes }`
	queryTest1Subgraph     = `query { headerValue(name: "X-Test") }`
	queryFamilySubgraph    = `query { findEmployees { id } }`
	queryMoodSubgraph      = `query { employee(id: 1) { currentMood } }`
	queryHobbiesSubgraph   = `query { employee(id: 1) { hobbies { __typename } } }`
)

const (
	muxReusedMessage   = "graph mux is being reused by new graph server, skipping shutdown"
	muxShutdownMessage = "shutting down graph mux"
)

// connectionMetricsReloadEnv builds the shared test environment.
func connectionMetricsReloadEnv(reader *metric.ManualReader, poller *reloadConfigPoller) *testenv.Config {
	return &testenv.Config{
		MetricReader: reader,
		MetricOptions: testenv.MetricOptions{
			EnableOTLPConnectionMetrics: true,
		},
		LogObservation: testenv.LogObservationConfig{
			Enabled:  true,
			LogLevel: zapcore.DebugLevel,
		},
		RouterOptions: []core.Option{
			// A per-subgraph transport is what puts wg.subgraph.name on the data
			// points; the shared base transport dials with an empty name.
			core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(config.TrafficShapingRules{
				Subgraphs: map[string]config.GlobalSubgraphRequestRule{
					"employees": {},
					"family":    {},
					"hobbies":   {},
					"mood":      {},
					"products":  {},
					"test1":     {},
				},
			})),
		},
		RouterConfig: &testenv.RouterConfig{
			// File-watch reloads report Changes=nil and rebuild every mux, so we
			// need a poller to emit a partial change.
			ConfigPollerFactory: func(cfg *nodev1.RouterConfig) configpoller.ConfigPoller {
				poller.setBaseConfig(cfg)
				return poller
			},
		},
	}
}

func featureFlagHeader(flag string) http.Header {
	return http.Header{"X-Feature-Flag": []string{flag}}
}

// requireActiveConnections polls until the gauge reports exactly want. Exact
// counts matter both ways: an undercount is the bug under test, an overcount
// would mean a connection counted twice across transport generations.
func requireActiveConnections(t *testing.T, reader *metric.ManualReader, want connectionsBySubgraph) {
	t.Helper()
	require.EventuallyWithT(t, func(c *assert.CollectT) {
		assert.Equal(c, want, activeConnections(t, reader))
	}, 10*time.Second, 50*time.Millisecond)
}

// activeConnections sums router.http.client.active_connections per subgraph.
// Unreported subgraphs read as zero, which is also how an unregistered callback
// looks: the SDK drops an instrument that produced no observations.
func activeConnections(t *testing.T, reader *metric.ManualReader) connectionsBySubgraph {
	t.Helper()

	rm := metricdata.ResourceMetrics{}
	require.NoError(t, reader.Collect(context.Background(), &rm))

	conns := connectionsBySubgraph{}

	scope := testutils.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router.connections")
	if scope == nil {
		return conns
	}

	m := testutils.GetMetricByName(scope, "router.http.client.active_connections")
	if m == nil {
		return conns
	}

	gauge, ok := m.Data.(metricdata.Gauge[int64])
	require.True(t, ok, "router.http.client.active_connections must be an int64 gauge")

	for _, dp := range gauge.DataPoints {
		subgraph, _ := dp.Attributes.Value(otel.WgSubgraphName)
		conns[subgraph.AsString()] += dp.Value
	}
	return conns
}

// connectionsBySubgraph maps subgraph name to active connections. The empty key
// holds connections dialed through the shared base transport.
type connectionsBySubgraph map[string]int64

// String renders the whole snapshot so failures show more than the one subgraph.
func (c connectionsBySubgraph) String() string {
	names := make([]string, 0, len(c))
	for name := range c {
		names = append(names, name)
	}
	sort.Strings(names)

	parts := make([]string, 0, len(names))
	for _, name := range names {
		// Label separately from the map key, which is "" for the base transport.
		label := name
		if label == "" {
			label = "<base transport>"
		}
		parts = append(parts, fmt.Sprintf("%s=%d", label, c[name]))
	}
	return "{" + strings.Join(parts, " ") + "}"
}

// muxKeysFor returns the mux keys logged with message after the from-th entry.
// The base graph mux uses the empty string as its key.
func muxKeysFor(xEnv *testenv.Environment, from int, message string) []string {
	keys := make([]string, 0)
	for _, e := range xEnv.Observer().All()[from:] {
		if e.Message != message {
			continue
		}
		for _, f := range e.Context {
			if f.Key == "mux" && f.Type == zapcore.StringType {
				keys = append(keys, f.String)
			}
		}
	}
	slices.Sort(keys)
	return keys
}

// reloadConfigPoller serves the config testenv built for the running subgraph
// servers and lets the test emit reloads with hand-picked Changes.
type reloadConfigPoller struct {
	// initialFlags maps feature flag name to execution config version for the
	// config served on startup.
	initialFlags map[string]string

	mu         sync.Mutex
	baseConfig *nodev1.RouterConfig
	handler    func(response *routerconfig.Response) error
}

func newReloadConfigPoller(initialFlags map[string]string) *reloadConfigPoller {
	return &reloadConfigPoller{initialFlags: initialFlags}
}

// setBaseConfig stores the config testenv assembled for the subgraph servers.
func (p *reloadConfigPoller) setBaseConfig(cfg *nodev1.RouterConfig) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.baseConfig = cfg
}

func (p *reloadConfigPoller) GetRouterConfig(_ context.Context) (*routerconfig.Response, error) {
	return &routerconfig.Response{Config: p.configWithFeatureFlags(p.initialFlags)}, nil
}

func (p *reloadConfigPoller) Subscribe(_ context.Context, handler func(response *routerconfig.Response) error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.handler = handler
}

// Emit invokes the Subscribe handler synchronously, so once it returns the
// previous graph server has been fully shut down.
func (p *reloadConfigPoller) Emit(cfg *nodev1.RouterConfig, changes *routerconfig.Changes) error {
	p.mu.Lock()
	h := p.handler
	p.mu.Unlock()

	if h == nil {
		return fmt.Errorf("reloadConfigPoller: Subscribe was never called by the router")
	}
	return h(&routerconfig.Response{Config: cfg, Changes: changes})
}

// configWithFeatureFlags rebuilds the base config with exactly these flags. The
// base graph part is identical across calls, which is what makes it reusable.
func (p *reloadConfigPoller) configWithFeatureFlags(flags map[string]string) *nodev1.RouterConfig {
	p.mu.Lock()
	defer p.mu.Unlock()

	next := proto.Clone(p.baseConfig).(*nodev1.RouterConfig)
	next.FeatureFlagConfigs = &nodev1.FeatureFlagRouterExecutionConfigs{
		ConfigByFeatureFlagName: make(map[string]*nodev1.FeatureFlagRouterExecutionConfig, len(flags)),
	}
	for flag, ffVersion := range flags {
		// Each flag mirrors the base graph so any query works through any mux.
		next.FeatureFlagConfigs.ConfigByFeatureFlagName[flag] = &nodev1.FeatureFlagRouterExecutionConfig{
			Version:      ffVersion,
			EngineConfig: proto.Clone(p.baseConfig.GetEngineConfig()).(*nodev1.EngineConfiguration),
			Subgraphs:    next.GetSubgraphs(),
		}
	}
	return next
}
