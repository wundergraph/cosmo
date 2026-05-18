package entity_caching

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	cacheeventsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/cacheevents/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/cacheevents/v1/cacheeventsv1connect"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type capturingCacheEventsHandler struct {
	cacheeventsv1connect.UnimplementedCacheEventsServiceHandler

	mu     sync.Mutex
	auth   []string
	events []*cacheeventsv1.CacheEvent
}

func (h *capturingCacheEventsHandler) PublishEntityCacheEvents(
	_ context.Context,
	req *connect.Request[cacheeventsv1.PublishEntityCacheEventsRequest],
) (*connect.Response[cacheeventsv1.PublishEntityCacheEventsResponse], error) {
	h.mu.Lock()
	h.auth = append(h.auth, req.Header().Get("Authorization"))
	h.events = append(h.events, req.Msg.GetEvents()...)
	h.mu.Unlock()
	return connect.NewResponse(&cacheeventsv1.PublishEntityCacheEventsResponse{}), nil
}

func (h *capturingCacheEventsHandler) snapshot() (auths []string, events []*cacheeventsv1.CacheEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	auths = append([]string(nil), h.auth...)
	events = append([]*cacheeventsv1.CacheEvent(nil), h.events...)
	return auths, events
}

// TestCacheEventsExport_DeliversBatchesWithBearerAuth is the end-to-end
// "before/after" guarantee for the auth refactor: with EventsExport enabled,
// the router must (a) actually deliver cache events to the configured
// endpoint, and (b) carry an `Authorization: Bearer <token>` header on every
// request. Auth is now contributed by exporter.WithBearerAuth at the Connect
// client layer, replacing the per-call header injection that previously lived
// in the cacheevents.Sink.
func TestCacheEventsExport_DeliversBatchesWithBearerAuth(t *testing.T) {
	t.Parallel()

	handler := &capturingCacheEventsHandler{}
	mux := http.NewServeMux()
	path, h := cacheeventsv1connect.NewCacheEventsServiceHandler(handler)
	mux.Handle(path, h)
	fakeServer := httptest.NewServer(mux)
	t.Cleanup(fakeServer.Close)

	servers, _ := startSubgraphServers(t)
	configJSON := buildConfigJSON(servers)
	cache := newMemoryCache(t)

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: configJSON,
		RouterOptions: []core.Option{
			core.WithEntityCaching(config.EntityCachingConfiguration{
				Enabled: true,
				L1: config.EntityCachingL1Configuration{
					Enabled: true,
				},
				L2: config.EntityCachingL2Configuration{
					Enabled: false,
				},
				EventsExport: config.EntityCacheEventsExportConfig{
					Enabled:   true,
					Endpoint:  fakeServer.URL,
					BatchSize: 1,
					QueueSize: 64,
					Interval:  100 * time.Millisecond,
				},
			}),
			core.WithEntityCacheInstances(map[string]resolve.LoaderCache{
				"default": cache,
			}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		// First request populates the cache; second hits the cache. Both
		// emit cache events that the exporter ships to the fake endpoint.
		req := testenv.GraphQLRequest{
			Query: `{ item(id: "1") { id name description } }`,
		}
		xEnv.MakeGraphQLRequestOK(req)
		xEnv.MakeGraphQLRequestOK(req)

		// Wait for the periodic flush to deliver events from both requests.
		const expectedMinEvents = 2
		require.Eventually(t, func() bool {
			_, events := handler.snapshot()
			return len(events) >= expectedMinEvents
		}, 10*time.Second, 50*time.Millisecond, "expected cache events to be exported")
	})

	auths, events := handler.snapshot()
	require.NotEmpty(t, events, "expected at least one cache event")
	require.NotEmpty(t, auths, "expected at least one request to the cache events endpoint")
	for i, got := range auths {
		require.Truef(t, strings.HasPrefix(got, "Bearer "),
			"request[%d]: expected Bearer auth header, got %q", i, got)
		require.Greaterf(t, len(got), len("Bearer "),
			"request[%d]: expected non-empty token in Authorization header", i)
	}
}

// TestCacheEventsExport_EmitsAccessorRows is the end-to-end guarantee that
// when events export is enabled, the router produces FIELD_SELECTION events
// for nested Object/Array accessors alongside the existing FIELD_HASH leaf
// events. Emission rides on EventsExport.Enabled — there is no separate
// sub-flag; downstream consumers either read both event types or filter to
// just field_hash via the EventType column.
//
// The query exercises Warehouse.location (an Object accessor) so the walker
// enters the nested accessor inside an entity scope, which is the
// precondition for emission.
func TestCacheEventsExport_EmitsAccessorRows(t *testing.T) {
	t.Parallel()

	handler := &capturingCacheEventsHandler{}
	mux := http.NewServeMux()
	path, h := cacheeventsv1connect.NewCacheEventsServiceHandler(handler)
	mux.Handle(path, h)
	fakeServer := httptest.NewServer(mux)
	t.Cleanup(fakeServer.Close)

	servers, _ := startSubgraphServers(t)
	configJSON := buildConfigJSON(servers)
	cache := newMemoryCache(t)

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: configJSON,
		RouterOptions: []core.Option{
			core.WithEntityCaching(config.EntityCachingConfiguration{
				Enabled: true,
				L1: config.EntityCachingL1Configuration{
					Enabled: true,
				},
				L2: config.EntityCachingL2Configuration{
					Enabled: false,
				},
				EventsExport: config.EntityCacheEventsExportConfig{
					Enabled:   true,
					Endpoint:  fakeServer.URL,
					BatchSize: 1,
					QueueSize: 64,
					Interval:  100 * time.Millisecond,
				},
			}),
			core.WithEntityCacheInstances(map[string]resolve.LoaderCache{
				"default": cache,
			}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		// warehouse selects Warehouse.location (Object accessor) →
		// triggers FIELD_SELECTION emission inside the entity scope.
		req := testenv.GraphQLRequest{
			Query: `{ warehouse(locationId: "w1") { location { id } name capacity } }`,
		}
		xEnv.MakeGraphQLRequestOK(req)

		// Wait for at least one FIELD_SELECTION event before asserting —
		// the periodic exporter may not have flushed yet immediately after
		// the request returns.
		require.Eventually(t, func() bool {
			_, events := handler.snapshot()
			for _, ev := range events {
				if ev.EventType == cacheeventsv1.EventType_FIELD_SELECTION {
					return true
				}
			}
			return false
		}, 10*time.Second, 50*time.Millisecond, "expected at least one FIELD_SELECTION event")
	})

	_, events := handler.snapshot()

	var selections []*cacheeventsv1.CacheEvent
	for _, ev := range events {
		if ev.EventType == cacheeventsv1.EventType_FIELD_SELECTION {
			selections = append(selections, ev)
		}
	}
	require.NotEmpty(t, selections, "FIELD_SELECTION must emit when the query selects an accessor inside an entity scope")

	// One of the emitted selection rows must correspond to
	// Warehouse.location with ChildTypeName=Location, a non-zero KeyHash
	// (PII guard passed), and zero FieldHash (accessors carry no scalar
	// value).
	var found bool
	for _, ev := range selections {
		if ev.EntityType == "Warehouse" && ev.FieldName == "location" {
			require.Equal(t, "Location", ev.ChildTypeName, "ChildTypeName must be the accessor's unwrapped return type")
			require.NotZero(t, ev.KeyHash, "FIELD_SELECTION rows must carry a hashed entity key (PII guard)")
			require.Zero(t, ev.FieldHash, "FIELD_SELECTION rows must not carry a value hash")
			found = true
			break
		}
	}
	require.True(t, found, "expected a FIELD_SELECTION for Warehouse.location among %d emitted selection rows", len(selections))
}
