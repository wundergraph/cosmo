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

type noopUpdater struct{}

func (n *noopUpdater) Update(_ []datasource.StreamEvent) {}
func (n *noopUpdater) Complete()                         {}
func (n *noopUpdater) Done()                             {}
func (n *noopUpdater) SetHooks(_ datasource.Hooks)       {}

func TestProviderAdapter_SubscribeWithoutStartupReturnsError(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	// The adapter is created but Startup is never called, so p.conn stays nil. This
	// mirrors the state of a provider that failed to connect under skip_unavailable_providers.
	adapter := NewProviderAdapter(ctx, zaptest.NewLogger(t), []string{"redis://localhost:6379"}, false, datasource.ProviderOpts{})

	conf := &SubscriptionEventConfiguration{
		Provider:  "test-provider",
		Channels:  []string{"test-channel"},
		FieldName: "testField",
	}

	require.NotPanics(t, func() {
		err := adapter.Subscribe(ctx, conf, &noopUpdater{})
		require.Error(t, err)
	})
}

func TestProviderAdapter_ConnectionCleanupOnUnsubscribe(t *testing.T) {
	t.Parallel()

	redis := miniredis.RunT(t)

	ctx := context.Background()
	adapter := NewProviderAdapter(ctx, zaptest.NewLogger(t), []string{fmt.Sprintf("redis://%s", redis.Addr())}, false, datasource.ProviderOpts{})

	require.NoError(t, adapter.Startup(ctx))
	t.Cleanup(func() {
		_ = adapter.Shutdown(ctx)
	})

	baselineCount := redis.CurrentConnectionCount()

	subCtx, cancelSub := context.WithCancel(ctx)
	defer cancelSub()

	conf := &SubscriptionEventConfiguration{
		Provider:  "test-provider",
		Channels:  []string{"test-channel"},
		FieldName: "testField",
	}

	require.NoError(t, adapter.Subscribe(subCtx, conf, &noopUpdater{}))

	// Wait for the PSubscribe connection to be established on the Redis server.
	require.Eventually(t, func() bool {
		return redis.CurrentConnectionCount() > baselineCount
	}, 2*time.Second, 10*time.Millisecond, "expected connection count to increase after subscribe")

	// Cancelling the subscription context should cause the subscription goroutine to
	// exit and close its dedicated pubsub connection via the cleanup function.
	cancelSub()

	require.Eventually(t, func() bool {
		return redis.CurrentConnectionCount() <= baselineCount
	}, 2*time.Second, 10*time.Millisecond, "expected connection count to return to baseline after unsubscribe")
}
