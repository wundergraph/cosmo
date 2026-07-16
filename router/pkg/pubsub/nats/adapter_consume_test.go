package nats

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"
)

// The durable consumer is shared across subscriptions to the same subjects, so
// a cancelled subscription must Nak a message it has already fetched, leaving it
// pending for the next subscriber, rather than Ack it.
func TestProviderAdapterStreamSubscribe(t *testing.T) {
	t.Parallel()

	subConf := &SubscriptionEventConfiguration{
		Provider:            "default",
		Subjects:            []string{"employeeUpdated.12"},
		StreamConfiguration: &StreamConfiguration{Consumer: "consumer", StreamName: "stream"},
	}

	t.Run("delivers and acks a message while the subscription is active", func(t *testing.T) {
		t.Parallel()

		ctx, cancel := context.WithCancel(context.Background())

		msg := NewMockMsg(t)
		msg.EXPECT().Subject().Return("employeeUpdated.12")
		msg.EXPECT().Data().Return([]byte(`{"id":13}`))
		msg.EXPECT().Headers().Return(nil)
		msg.EXPECT().Ack().RunAndReturn(func() error { cancel(); return nil }).Once()

		batch := NewMockMessageBatch(t)
		batch.EXPECT().Messages().Return(msgChan(msg))

		consumer := NewMockConsumer(t)
		consumer.EXPECT().FetchNoWait(mock.Anything).Return(batch, nil).Once()

		var delivered [][]byte
		updater := datasource.NewMockSubscriptionEventUpdater(t)
		updater.EXPECT().Update(mock.Anything).Run(func(events []datasource.StreamEvent) {
			for _, e := range events {
				delivered = append(delivered, e.GetData())
			}
		}).Once()

		p := newTestAdapter(t, consumer)
		require.NoError(t, p.Subscribe(ctx, subConf, updater))
		waitForGoroutine(t, &p.closeWg)

		require.Equal(t, [][]byte{[]byte(`{"id":13}`)}, delivered)
	})

	t.Run("naks without acking when the subscription is cancelled mid-batch", func(t *testing.T) {
		t.Parallel()

		ctx, cancel := context.WithCancel(context.Background())

		msg := NewMockMsg(t)
		msg.EXPECT().Nak().Return(nil).Once()

		batch := NewMockMessageBatch(t)
		batch.EXPECT().Messages().Return(msgChan(msg))

		consumer := NewMockConsumer(t)
		// Cancel while the message is in the fetched batch, before it is processed.
		consumer.EXPECT().FetchNoWait(mock.Anything).RunAndReturn(func(int) (jetstream.MessageBatch, error) {
			cancel()
			return batch, nil
		}).Once()

		updater := datasource.NewMockSubscriptionEventUpdater(t)

		p := newTestAdapter(t, consumer)
		require.NoError(t, p.Subscribe(ctx, subConf, updater))
		waitForGoroutine(t, &p.closeWg)
	})
}

func newTestAdapter(t *testing.T, consumer jetstream.Consumer) *ProviderAdapter {
	t.Helper()
	js := NewMockJetStream(t)
	js.EXPECT().CreateOrUpdateConsumer(mock.Anything, mock.Anything, mock.Anything).Return(consumer, nil).Once()
	return &ProviderAdapter{
		ctx:               context.Background(),
		client:            &nats.Conn{}, // only nil-checked; never dereferenced on the stream path
		js:                js,
		logger:            zap.NewNop(),
		streamMetricStore: metric.NewNoopStreamMetricStore(),
	}
}

func msgChan(msgs ...jetstream.Msg) <-chan jetstream.Msg {
	ch := make(chan jetstream.Msg, len(msgs))
	for _, m := range msgs {
		ch <- m
	}
	close(ch)
	return ch
}

func waitForGoroutine(t *testing.T, wg *sync.WaitGroup) {
	t.Helper()
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for the subscribe goroutine to exit")
	}
}
