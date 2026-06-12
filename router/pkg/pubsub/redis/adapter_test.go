package redis

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap/zaptest"
)

// noopUpdater satisfies datasource.SubscriptionEventUpdater for tests.
type noopUpdater struct{}

func (noopUpdater) Update(events []datasource.StreamEvent) {}
func (noopUpdater) Complete()                              {}
func (noopUpdater) Done()                                  {}
func (noopUpdater) SetHooks(hooks datasource.Hooks)        {}

func newTestAdapter(t *testing.T) (*ProviderAdapter, *miniredis.Miniredis) {
	t.Helper()

	mr := miniredis.RunT(t)

	adapter := NewProviderAdapter(
		context.Background(),
		zaptest.NewLogger(t),
		[]string{fmt.Sprintf("redis://%s", mr.Addr())},
		false,
		datasource.ProviderOpts{},
	)
	require.NoError(t, adapter.Startup(context.Background()))
	t.Cleanup(func() { _ = adapter.Shutdown(context.Background()) })

	return adapter.(*ProviderAdapter), mr
}

// TestProviderAdapter_Subscribe_ReleasesConnectionOnCancel guards against the
// connection leak where each subscription's dedicated pub/sub connection was
// never closed (only PUnsubscribe was called, with an already-cancelled
// context). After every subscription context is cancelled, the pool's total
// connection count must return to its pre-subscribe baseline.
func TestProviderAdapter_Subscribe_ReleasesConnectionOnCancel(t *testing.T) {
	p, _ := newTestAdapter(t)

	baseline := p.conn.PoolStats().TotalConns

	const subscriptions = 10
	for i := 0; i < subscriptions; i++ {
		subCtx, cancel := context.WithCancel(context.Background())
		err := p.Subscribe(subCtx, &SubscriptionEventConfiguration{
			Provider: "test-provider",
			Channels: []string{fmt.Sprintf("channel-%d", i)},
		}, noopUpdater{})
		require.NoError(t, err)

		// Cancelling the subscription context must tear the subscription down
		// and release its dedicated connection.
		cancel()
	}

	require.Eventually(t, func() bool {
		return p.conn.PoolStats().TotalConns <= baseline
	}, 5*time.Second, 10*time.Millisecond,
		"redis pub/sub connections leaked: have %d, baseline %d",
		p.conn.PoolStats().TotalConns, baseline)
}
