package cursors

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"

	streamsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/streams/v1"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
)

const kafkaTestSeed = "localhost:9092"

// recordingUpdater is a SubscriptionEventUpdater that hands every event to a channel.
// With blockAfterFirst it stalls the poller inside the first Update until the context ends, which
// freezes the subscription in the state where one partition delivered a record and the others,
// although their records already exist in the broker, did not.
type recordingUpdater struct {
	ctx             context.Context
	blockAfterFirst bool
	events          chan datasource.StreamEvent
	blocked         bool
}

func (u *recordingUpdater) Update(events []datasource.StreamEvent) {
	for _, evt := range events {
		u.events <- evt
		if u.blockAfterFirst && !u.blocked {
			u.blocked = true
			<-u.ctx.Done()
			return
		}
	}
}

func (u *recordingUpdater) Complete()                   {}
func (u *recordingUpdater) Done()                       {}
func (u *recordingUpdater) SetHooks(_ datasource.Hooks) {}

func newRecordingUpdater(ctx context.Context, blockAfterFirst bool) *recordingUpdater {
	return &recordingUpdater{ctx: ctx, blockAfterFirst: blockAfterFirst, events: make(chan datasource.StreamEvent, 16)}
}

func nextEvent(t *testing.T, u *recordingUpdater) datasource.StreamEvent {
	t.Helper()
	return nextEventWithin(t, u, EventWaitTimeout)
}

func nextEventWithin(t *testing.T, u *recordingUpdater, timeout time.Duration) datasource.StreamEvent {
	t.Helper()
	select {
	case evt := <-u.events:
		return evt
	case <-time.After(timeout):
		require.FailNow(t, "timed out waiting for an event")
		return nil
	}
}

// TestCursors_KafkaPartitions checks cursors of a topic with more than one partition against the
// adapter directly. The test controls when the poller delivers, which an end to end test can't.
func TestCursors_KafkaPartitions(t *testing.T) {
	t.Parallel()

	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	const partitions = 2

	for _, olderRecords := range []int{0, 2} {
		t.Run(fmt.Sprintf("a partition that did not deliver yet is not skipped on resume, %d older records per partition", olderRecords), func(t *testing.T) {
			t.Parallel()

			ctx, cancel := context.WithTimeout(context.Background(), 2*EventWaitTimeout)
			t.Cleanup(cancel)

			topic := fmt.Sprintf("cursors_partitions_%d_%d", olderRecords, time.Now().UnixNano())

			producer, err := kgo.NewClient(
				kgo.SeedBrokers(kafkaTestSeed),
				kgo.RecordPartitioner(kgo.ManualPartitioner()),
			)
			require.NoError(t, err)
			t.Cleanup(producer.Close)

			admin := kadm.NewClient(producer)
			_, err = admin.CreateTopics(ctx, partitions, 1, nil, topic)
			require.NoError(t, err)
			t.Cleanup(func() { _, _ = admin.DeleteTopics(context.Background(), topic) })

			produce := func(partition int32, value string) {
				t.Helper()
				require.NoError(t, producer.ProduceSync(ctx, &kgo.Record{Topic: topic, Partition: partition, Value: []byte(value)}).FirstErr())
			}

			// records that exist before the subscription starts are not part of it
			for i := range olderRecords {
				for partition := range int32(partitions) {
					produce(partition, fmt.Sprintf("older-%d-%d", partition, i))
				}
			}
			time.Sleep(20 * time.Millisecond)

			adapter, err := kafka.NewProviderAdapter(ctx, nil, []kgo.Opt{kgo.SeedBrokers(kafkaTestSeed)}, datasource.ProviderOpts{})
			require.NoError(t, err)
			require.NoError(t, adapter.Startup(ctx))
			t.Cleanup(func() { require.NoError(t, adapter.Shutdown(context.Background())) })

			conf := &kafka.SubscriptionEventConfiguration{
				Provider:      "my-kafka",
				Topics:        []string{topic},
				FieldName:     "employeeUpdated",
				GuaranteeMode: datasource.DeliveryGuaranteeModeCursor,
			}

			subCtx, cancelSub := context.WithCancel(ctx)
			t.Cleanup(cancelSub)
			first := newRecordingUpdater(subCtx, true)
			require.NoError(t, adapter.Subscribe(subCtx, conf, datasource.DeliveryGuaranteeCursor, first))

			// Both records exist before the first one is delivered, which is when the cursor is
			// issued. The poller stalls in the first delivery, so the other record stays undelivered.
			produce(0, "record-0")
			produce(1, "record-1")

			delivered := nextEvent(t, first)
			deliveredBy, undelivered := string(delivered.GetData()), "record-0"
			if deliveredBy == "record-0" {
				undelivered = "record-1"
			}
			deliveredPartition := int32(0)
			if deliveredBy == "record-1" {
				deliveredPartition = 1
			}

			// the cursor reports every partition, also the one that has not delivered anything
			cursorPartitions := delivered.Cursor().GetKafka().GetTopics()[topic].GetPartitions()
			require.Len(t, cursorPartitions, partitions)
			for partition, offset := range cursorPartitions {
				if partition == deliveredPartition {
					require.EqualValues(t, olderRecords, offset.GetOffset(), "offset of the delivered record")
				} else {
					require.EqualValues(t, olderRecords-1, offset.GetOffset(), "offset right before the start of the subscription")
				}
			}

			// the router issues the cursor after the records were produced
			time.Sleep(20 * time.Millisecond)
			cursor := &streamsv1.Cursor{
				ProviderId: delivered.Cursor().GetProviderId(),
				IssuedAt:   time.Now().UnixMilli(),
				Position:   delivered.Cursor().GetPosition(),
			}
			cancelSub()

			resumeCtx, cancelResume := context.WithCancel(ctx)
			t.Cleanup(cancelResume)
			resumed := newRecordingUpdater(resumeCtx, false)
			require.NoError(t, adapter.SubscribeFrom(resumeCtx, conf, cursor, resumed))

			require.Equal(t, undelivered, string(nextEvent(t, resumed).GetData()))
		})
	}
}

// TestCursors_KafkaResumeNewPartition checks against the adapter directly that a resumed
// subscription consumes a partition that is created while it is running.
func TestCursors_KafkaResumeNewPartition(t *testing.T) {
	t.Parallel()

	const (
		partitionRefreshInterval = 200 * time.Millisecond
		newPartitionWait         = 10 * time.Second
	)

	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*newPartitionWait)
	t.Cleanup(cancel)

	topic := fmt.Sprintf("cursors_new_partition_%d", time.Now().UnixNano())

	newProducer := func() *kgo.Client {
		t.Helper()
		producer, err := kgo.NewClient(
			kgo.SeedBrokers(kafkaTestSeed),
			kgo.RecordPartitioner(kgo.ManualPartitioner()),
		)
		require.NoError(t, err)
		t.Cleanup(producer.Close)
		return producer
	}
	produce := func(producer *kgo.Client, partition int32, value string) {
		t.Helper()
		require.NoError(t, producer.ProduceSync(ctx, &kgo.Record{Topic: topic, Partition: partition, Value: []byte(value)}).FirstErr())
	}

	producer := newProducer()
	admin := kadm.NewClient(producer)
	_, err := admin.CreateTopics(ctx, 1, 1, nil, topic)
	require.NoError(t, err)
	t.Cleanup(func() { _, _ = admin.DeleteTopics(context.Background(), topic) })

	adapter, err := kafka.NewProviderAdapter(ctx, nil, []kgo.Opt{kgo.SeedBrokers(kafkaTestSeed)}, datasource.ProviderOpts{})
	require.NoError(t, err)
	// the default interval would make the test wait for it
	adapter.SetPartitionRefreshInterval(partitionRefreshInterval)
	require.NoError(t, adapter.Startup(ctx))
	t.Cleanup(func() { require.NoError(t, adapter.Shutdown(context.Background())) })

	conf := &kafka.SubscriptionEventConfiguration{
		Provider:      "my-kafka",
		Topics:        []string{topic},
		FieldName:     "employeeUpdated",
		GuaranteeMode: datasource.DeliveryGuaranteeModeCursor,
	}

	// a cursor from before the first record of the only partition
	cursor := &streamsv1.Cursor{
		ProviderId: "my-kafka",
		IssuedAt:   time.Now().UnixMilli(),
		Position: &streamsv1.Cursor_Kafka{Kafka: &streamsv1.KafkaCursorPosition{
			Topics: map[string]*streamsv1.KafkaPartitionPositions{
				topic: {Partitions: map[int32]*streamsv1.KafkaPartitionOffset{0: {Offset: -1}}},
			},
		}},
	}

	subCtx, cancelSub := context.WithCancel(ctx)
	t.Cleanup(cancelSub)
	updater := newRecordingUpdater(subCtx, false)
	require.NoError(t, adapter.SubscribeFrom(subCtx, conf, cursor, updater))

	// the subscription runs on the partition it was resumed with
	produce(producer, 0, "record-0")
	require.Equal(t, "record-0", string(nextEventWithin(t, updater, newPartitionWait).GetData()))

	// a partition is created while the subscription runs, and a record lands on it
	_, err = admin.UpdatePartitions(ctx, 2, topic)
	require.NoError(t, err)
	// a new producer, since a running one only learns about the partition with its next metadata refresh
	produce(newProducer(), 1, "record-1")

	// the watcher notices the partition within a few refreshes, so a record that has not arrived by
	// then means it was not detected
	require.Equal(t, "record-1", string(nextEventWithin(t, updater, newPartitionWait).GetData()))
}
