package redis

import (
	"context"
	"fmt"
	"sync"
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

type recordingUpdater struct {
	noopUpdater
	mu       sync.Mutex
	payloads []string
}

func (r *recordingUpdater) Update(events []datasource.StreamEvent) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, event := range events {
		r.payloads = append(r.payloads, string(event.GetData()))
	}
}

func (r *recordingUpdater) received() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.payloads...)
}

func TestProviderAdapter_SubscribeUsesChannelsForLiteralNamesAndPatternsForGlobs(t *testing.T) {
	t.Parallel()

	redis := miniredis.RunT(t)

	ctx := context.Background()
	adapter := NewProviderAdapter(ctx, zaptest.NewLogger(t), []string{fmt.Sprintf("redis://%s", redis.Addr())}, false, datasource.ProviderOpts{})
	require.NoError(t, adapter.Startup(ctx))
	t.Cleanup(func() {
		_ = adapter.Shutdown(ctx)
	})

	updater := &recordingUpdater{}
	conf := &SubscriptionEventConfiguration{
		Provider:  "test-provider",
		Channels:  []string{"orders:org-1", "invoices:*"},
		FieldName: "testField",
	}
	require.NoError(t, adapter.Subscribe(ctx, conf, updater))

	require.Eventually(t, func() bool {
		return redis.PubSubNumSub("orders:org-1")["orders:org-1"] == 1 && redis.PubSubNumPat() == 1
	}, 2*time.Second, 10*time.Millisecond, "expected one channel and one pattern subscription")

	redis.Publish("orders:org-2", "other-org")
	redis.Publish("orders:org-1", "literal")
	redis.Publish("invoices:org-1", "glob")

	require.Eventually(t, func() bool {
		return len(updater.received()) == 2
	}, 2*time.Second, 10*time.Millisecond, "expected the literal and glob messages")
	require.ElementsMatch(t, []string{"literal", "glob"}, updater.received())
}

func newStartedAdapter(t *testing.T, redis *miniredis.Miniredis) datasource.Adapter {
	t.Helper()

	ctx := context.Background()
	adapter := NewProviderAdapter(ctx, zaptest.NewLogger(t), []string{fmt.Sprintf("redis://%s", redis.Addr())}, false, datasource.ProviderOpts{})
	require.NoError(t, adapter.Startup(ctx))
	t.Cleanup(func() {
		_ = adapter.Shutdown(ctx)
	})
	return adapter
}

func TestProviderAdapter_SubscribeWithOnlyPatterns(t *testing.T) {
	t.Parallel()

	redis := miniredis.RunT(t)
	adapter := newStartedAdapter(t, redis)

	updater := &recordingUpdater{}
	conf := &SubscriptionEventConfiguration{
		Provider:  "test-provider",
		Channels:  []string{"invoices:*", `orders:\*`},
		FieldName: "testField",
	}
	require.NoError(t, adapter.Subscribe(context.Background(), conf, updater))

	require.Eventually(t, func() bool {
		return redis.PubSubNumPat() == 2 && len(redis.PubSubChannels("")) == 0
	}, 2*time.Second, 10*time.Millisecond, "expected two pattern subscriptions and no channel subscription")

	redis.Publish("orders:org-1", "escaped-glob-must-not-match")
	redis.Publish("orders:*", "escaped-glob")
	redis.Publish("invoices:org-1", "glob")

	require.Eventually(t, func() bool {
		return len(updater.received()) == 2
	}, 2*time.Second, 10*time.Millisecond, "expected the glob and escaped-glob messages")
	require.ElementsMatch(t, []string{"glob", "escaped-glob"}, updater.received())
}

func TestProviderAdapter_SubscribeWhileRedisIsDownRecoversAfterRestart(t *testing.T) {
	t.Parallel()

	redis := miniredis.RunT(t)
	adapter := newStartedAdapter(t, redis)

	redis.Close()

	updater := &recordingUpdater{}
	conf := &SubscriptionEventConfiguration{
		Provider:  "test-provider",
		Channels:  []string{"orders:org-1", "invoices:*"},
		FieldName: "testField",
	}
	// go-redis keeps the channels and patterns of a failed subscribe and sends them again on
	// reconnect, so a short outage must not fail the subscription.
	require.NoError(t, adapter.Subscribe(context.Background(), conf, updater))

	require.NoError(t, redis.Restart())

	require.Eventually(t, func() bool {
		return redis.PubSubNumSub("orders:org-1")["orders:org-1"] == 1 && redis.PubSubNumPat() == 1
	}, 10*time.Second, 50*time.Millisecond, "expected the subscriptions to be restored after the restart")

	redis.Publish("orders:org-1", "literal")
	redis.Publish("invoices:org-1", "glob")

	require.Eventually(t, func() bool {
		return len(updater.received()) == 2
	}, 2*time.Second, 10*time.Millisecond, "expected the literal and glob messages after the restart")
	require.ElementsMatch(t, []string{"literal", "glob"}, updater.received())
}
