package kafka

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/wundergraph/cosmo/router/pkg/metric"

	"github.com/twmb/franz-go/pkg/kerr"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/kmsg"
	streamsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/streams/v1"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"
)

var (
	errClientClosed = errors.New("client closed")
)

// Ensure ProviderAdapter implements Adapter and can resume a subscription from a cursor.
var _ datasource.SeekableAdapter = (*ProviderAdapter)(nil)

const (
	kafkaReceive = "receive"
	kafkaProduce = "produce"
)

// ProviderAdapter is a Kafka pubsub implementation.
// It uses the franz-go Kafka client to consume and produce messages.
// The pubsub is stateless and does not store any messages.
// It uses a single write client to produce messages and a client per topic to consume messages.
// Each client polls the Kafka topic for new records and updates the subscriptions with the new data.
type ProviderAdapter struct {
	ctx               context.Context
	opts              []kgo.Opt
	logger            *zap.Logger
	writeClient       *kgo.Client
	closeWg           sync.WaitGroup
	cancel            context.CancelFunc
	streamMetricStore metric.StreamMetricStore
	// skipUnavailable mirrors events.skip_unavailable_providers. When true, Startup probes
	// connectivity (kgo connects lazily otherwise) so an unreachable broker surfaces a
	// distinct "could not connect" error, consistent with the NATS and Redis adapters.
	skipUnavailable bool
}

type PollerOpts struct {
	providerId     string
	trackPositions bool
	resumeFrom     *streamsv1.KafkaCursorPosition
}

// topicPoller polls the Kafka topic for new records and calls the updateTriggers function.
func (p *ProviderAdapter) topicPoller(ctx context.Context, client *kgo.Client, updater datasource.SubscriptionEventUpdater, pollerOpts PollerOpts) error {
	var positions map[string]map[int32]*streamsv1.KafkaPartitionOffset
	if pollerOpts.trackPositions {
		positions = seedPositions(pollerOpts.resumeFrom)
	}

	for {
		select {
		case <-ctx.Done(): // Close the poller if the context was canceled (subscription ended, or router shutdown/hot reload)
			return ctx.Err()

		default:
			// Try to fetch max records from any subscribed topics
			fetches := client.PollRecords(ctx, 10_000)
			if fetches.IsClientClosed() {
				return errClientClosed
			}

			if errs := fetches.Errors(); len(errs) > 0 {

				for _, fetchError := range errs {

					// If the context was canceled, the error is wrapped in a fetch error
					if errors.Is(fetchError.Err, context.Canceled) {
						return fetchError.Err
					}

					// Data loss means the broker no longer holds the offset the consumer asked
					// for: the log was truncated, or the records aged out of retention. franz-go
					// resets the consumer and keeps fetching, which would silently skip records
					// the client was promised, so the subscription is terminated instead.
					if lossErr, ok := errors.AsType[*kgo.ErrDataLoss](fetchError.Err); ok {
						p.logger.Error("data loss on fetch, closing subscription",
							zap.Error(fetchError.Err),
							zap.String("topic", lossErr.Topic),
							zap.Int32("partition", lossErr.Partition),
							zap.Int64("consumed_to", lossErr.ConsumedTo),
							zap.Int64("reset_to", lossErr.ResetTo),
						)
						return fetchError.Err
					}

					if kErr, ok := errors.AsType[*kerr.Error](fetchError.Err); ok {
						if !kErr.Retriable {
							p.logger.Error("unrecoverable fetch error",
								zap.Error(fetchError.Err),
								zap.String("topic", fetchError.Topic),
							)

							// If the error is not recoverable, return it and abort the poller
							return fetchError.Err
						}
					} else {
						p.logger.Error("fetch error", zap.Error(fetchError.Err), zap.String("topic", fetchError.Topic))
					}
				}
			}

			iter := fetches.RecordIter()
			for !iter.Done() {
				r := iter.Next()

				p.logger.Debug("subscription update", zap.String("topic", r.Topic), zap.ByteString("data", r.Value))

				headers := make(map[string][]byte)
				for _, header := range r.Headers {
					headers[header.Key] = header.Value
				}

				p.streamMetricStore.Consume(ctx, metric.StreamsEvent{
					ProviderId:          pollerOpts.providerId,
					StreamOperationName: kafkaReceive,
					ProviderType:        metric.ProviderTypeKafka,
					DestinationName:     r.Topic,
				})

				evt := &MutableEvent{
					Data:    r.Value,
					Headers: headers,
					Key:     r.Key,
				}

				if positions != nil {
					partitions, exists := positions[r.Topic]
					if !exists {
						partitions = make(map[int32]*streamsv1.KafkaPartitionOffset)
						positions[r.Topic] = partitions
					}
					partitions[r.Partition] = &streamsv1.KafkaPartitionOffset{Epoch: r.LeaderEpoch, Offset: r.Offset}
					evt.cursor = snapshotKafkaPosition(pollerOpts.providerId, positions)
				}

				updater.Update([]datasource.StreamEvent{&Event{evt: evt}})
			}
		}
	}
}

// seedPositions returns the tracked positions a resumed subscription starts out with,
// deep-copied from the cursor it resumes from. A nil position seeds an empty tracker,
// which is what a fresh subscription uses.
func seedPositions(from *streamsv1.KafkaCursorPosition) map[string]map[int32]*streamsv1.KafkaPartitionOffset {
	positions := make(map[string]map[int32]*streamsv1.KafkaPartitionOffset, len(from.GetTopics()))
	for topic, partitions := range from.GetTopics() {
		seeded := make(map[int32]*streamsv1.KafkaPartitionOffset, len(partitions.GetPartitions()))
		for partition, offset := range partitions.GetPartitions() {
			seeded[partition] = &streamsv1.KafkaPartitionOffset{Epoch: offset.GetEpoch(), Offset: offset.GetOffset()}
		}
		positions[topic] = seeded
	}
	return positions
}

// snapshotKafkaPosition returns a cursor carrying a deep copy of positions,
// so it stays unchanged while the poller keeps updating positions.
func snapshotKafkaPosition(providerID string, positions map[string]map[int32]*streamsv1.KafkaPartitionOffset) *streamsv1.Cursor {
	topics := make(map[string]*streamsv1.KafkaPartitionPositions, len(positions))
	for topic, partitions := range positions {
		snapshot := make(map[int32]*streamsv1.KafkaPartitionOffset, len(partitions))
		for partition, offset := range partitions {
			snapshot[partition] = &streamsv1.KafkaPartitionOffset{Epoch: offset.Epoch, Offset: offset.Offset}
		}
		topics[topic] = &streamsv1.KafkaPartitionPositions{Partitions: snapshot}
	}
	return &streamsv1.Cursor{
		ProviderId: providerID,
		Position:   &streamsv1.Cursor_Kafka{Kafka: &streamsv1.KafkaCursorPosition{Topics: topics}},
	}
}

// Subscribe subscribes to the given topics and updates the subscription updater.
// The engine already deduplicates subscriptions with the same topics, stream configuration, extensions, headers, etc.
func (p *ProviderAdapter) Subscribe(ctx context.Context, conf datasource.SubscriptionEventConfiguration, guarantee datasource.DeliveryGuarantee, updater datasource.SubscriptionEventUpdater) error {
	subConf, ok := conf.(*SubscriptionEventConfiguration)
	if !ok {
		return datasource.NewError("invalid event type for Kafka adapter", nil)
	}

	return p.subscribe(ctx, subConf, updater, []kgo.Opt{
		kgo.ConsumeTopics(subConf.Topics...),
		// We want to consume the events produced after the first subscription was created
		// Messages are shared among all subscriptions, therefore old events are not redelivered
		// This replicates a stateless publish-subscribe model
		kgo.ConsumeResetOffset(kgo.NewOffset().AfterMilli(time.Now().UnixMilli())),
	}, PollerOpts{
		providerId:     conf.ProviderID(),
		trackPositions: guarantee == datasource.DeliveryGuaranteeCursor,
	})
}

// SubscribeFrom subscribes like Subscribe, but seeks the consumer to the position in cursor,
// so the client receives everything the broker still holds since it was last delivered to.
// A subscription that resumes always tracks positions: it negotiated the cursor guarantee to
// get here, and the cursors it is issued must stay cumulative across reconnects.
func (p *ProviderAdapter) SubscribeFrom(ctx context.Context, conf datasource.SubscriptionEventConfiguration, cursor *streamsv1.Cursor, updater datasource.SubscriptionEventUpdater) error {
	subConf, ok := conf.(*SubscriptionEventConfiguration)
	if !ok {
		return datasource.NewError("invalid event type for Kafka adapter", nil)
	}

	position, ok := cursor.GetPosition().(*streamsv1.Cursor_Kafka)
	if !ok {
		// The cursor's signature covers the provider type, so this is unreachable for a verified
		// cursor. It stays as a guard because the adapter must never seek to a position it did
		// not produce itself.
		return &datasource.DeliveryGuaranteeError{
			Code:    datasource.DeliveryGuaranteeErrorCodeCursorInvalid,
			Message: "The cursor was not issued for a Kafka provider",
		}
	}

	consumeOpts, err := p.buildResumeAssignment(ctx, subConf, cursor.GetIssuedAt(), position.Kafka)
	if err != nil {
		return err
	}

	return p.subscribe(ctx, subConf, updater, consumeOpts, PollerOpts{
		providerId:     conf.ProviderID(),
		trackPositions: true,
		resumeFrom:     position.Kafka,
	})
}

// subscribe creates the consumer client of a single subscription and runs its poller until the
// subscription, the adapter or the application context ends. consumeOpts says what the client
// consumes and where it starts, which is the only thing that differs between a fresh subscribe
// and a resume.
func (p *ProviderAdapter) subscribe(ctx context.Context, subConf *SubscriptionEventConfiguration, updater datasource.SubscriptionEventUpdater, consumeOpts []kgo.Opt, pollerOpts PollerOpts) error {
	log := p.logger.With(
		zap.String("provider_id", subConf.ProviderID()),
		zap.String("method", "subscribe"),
		zap.Strings("topics", subConf.Topics),
	)

	// Create a new client for the topic
	// Copy opts to avoid data race when multiple goroutines call Subscribe concurrently
	opts := make([]kgo.Opt, len(p.opts), len(p.opts)+len(consumeOpts)+1)
	copy(opts, p.opts)
	opts = append(opts, consumeOpts...)
	client, err := kgo.NewClient(append(opts,
		// For observability, we set the client ID to "router"
		kgo.ClientID(fmt.Sprintf("cosmo.router.consumer.%s", strings.Join(subConf.Topics, "-"))),
		// FIXME: the client id should have some unique identifier, like in nats
		// What if we have multiple subscriptions for the same topics?
		// What if we have more router instances?
	)...)
	if err != nil {
		log.Error("failed to create client", zap.Error(err))
		return err
	}

	p.closeWg.Go(func() {
		// The consumer client owns background goroutines, broker connections and buffered
		// fetches, so it must be closed when the poller stops, otherwise every ended
		// subscription leaks a full client for the lifetime of the process.
		defer client.Close()

		// Drive the poller with a context that is cancelled when EITHER the subscription
		// context (ctx) or the adapter/application context (p.ctx) is cancelled. This makes
		// topicPoller return immediately on a trigger close, router shutdown or hot reload,
		// at which point the deferred Close above reclaims the client.
		pollerCtx, cancel := context.WithCancel(ctx)
		defer cancel()
		stop := context.AfterFunc(p.ctx, cancel)
		defer stop()

		err := p.topicPoller(pollerCtx, client, updater, pollerOpts)
		if err != nil {
			if errors.Is(err, errClientClosed) || errors.Is(err, context.Canceled) {
				log.Debug("poller canceled", zap.Error(err))
			} else {
				log.Error(
					"poller error",
					zap.Error(err),
					zap.String("provider_id", subConf.ProviderID()),
					zap.String("provider_type", string(subConf.ProviderType())),
					zap.String("field_name", subConf.RootFieldName()),
				)
			}
			return
		}
	})

	return nil
}

// buildResumeAssignment returns the consume options that start every partition of every
// subscribed topic where the resuming client left off.
func (p *ProviderAdapter) buildResumeAssignment(ctx context.Context, subConf *SubscriptionEventConfiguration, issuedAt int64, position *streamsv1.KafkaCursorPosition) ([]kgo.Opt, error) {
	allPartitions, missingTopics, err := p.fetchTopicPartitions(ctx, subConf.Topics)
	if err != nil {
		return nil, datasource.NewError("failed to enumerate topic partitions to resume subscription", err)
	}
	for _, topic := range missingTopics {
		p.logger.Warn("topic does not exist yet, will resume consuming it once it is created",
			zap.String("provider_id", subConf.ProviderID()),
			zap.String("topic", topic),
		)
	}

	assign := make(map[string]map[int32]kgo.Offset, len(allPartitions))
	for topic, partitions := range allPartitions {
		recorded := position.GetTopics()[topic].GetPartitions()
		partAssign := make(map[int32]kgo.Offset, len(partitions))
		for _, partition := range partitions {
			if offset, ok := recorded[partition]; ok {
				// The recorded offset is the last record delivered to the client, so the resume
				// starts one past it. The epoch is what lets franz-go detect truncation; records
				// written in an old message format report -1, which is franz-go's "no epoch"
				// value and passes through unchanged.
				partAssign[partition] = kgo.NewOffset().At(offset.GetOffset() + 1).WithEpoch(offset.GetEpoch())
			} else {
				// A partition the cursor never saw starts where a fresh subscribe would have
				// started it, so the client gets neither a gap nor an unbounded replay.
				partAssign[partition] = kgo.NewOffset().AfterMilli(issuedAt)
			}
		}
		assign[topic] = partAssign
	}

	opts := []kgo.Opt{kgo.ConsumePartitions(assign)}
	if len(missingTopics) > 0 {
		opts = append(opts,
			kgo.ConsumeTopics(missingTopics...),
			kgo.ConsumeResetOffset(kgo.NewOffset().AfterMilli(issuedAt)),
		)
	}

	return opts, nil
}

// fetchTopicPartitions enumerates every partition of every given topic with a single metadata
// request. A topic that does not exist yet (UNKNOWN_TOPIC_OR_PARTITION) is reported through
// missingTopics instead of failing, so callers can fall back to the tolerant behaviour a fresh subscribe already has.
func (p *ProviderAdapter) fetchTopicPartitions(ctx context.Context, topics []string) (partitions map[string][]int32, missingTopics []string, err error) {
	if p.writeClient == nil {
		return nil, nil, errors.New("kafka client not initialized")
	}

	req := kmsg.NewPtrMetadataRequest()
	for _, topic := range topics {
		rt := kmsg.NewMetadataRequestTopic()
		rt.Topic = new(topic)
		req.Topics = append(req.Topics, rt)
	}

	kresp, err := p.writeClient.Request(ctx, req)
	if err != nil {
		return nil, nil, err
	}
	resp, ok := kresp.(*kmsg.MetadataResponse)
	if !ok {
		return nil, nil, fmt.Errorf("unexpected metadata response type %T", kresp)
	}

	result := make(map[string][]int32, len(resp.Topics))
	for _, t := range resp.Topics {
		var topicName string
		if t.Topic != nil {
			topicName = *t.Topic
		}
		if t.ErrorCode != 0 {
			if errors.Is(kerr.ErrorForCode(t.ErrorCode), kerr.UnknownTopicOrPartition) {
				missingTopics = append(missingTopics, topicName)
				continue
			}
			return nil, nil, fmt.Errorf("metadata error for topic %q: %w", topicName, kerr.ErrorForCode(t.ErrorCode))
		}
		topicPartitions := make([]int32, 0, len(t.Partitions))
		for _, part := range t.Partitions {
			topicPartitions = append(topicPartitions, part.Partition)
		}
		result[topicName] = topicPartitions
	}
	return result, missingTopics, nil
}

// Publish publishes the given events to the Kafka topic in a non-blocking way.
// Publish errors are logged and returned as a pubsub error.
// The events are written with a dedicated write client.
func (p *ProviderAdapter) Publish(ctx context.Context, conf datasource.PublishEventConfiguration, events []datasource.StreamEvent) error {
	pubConf, ok := conf.(*PublishEventConfiguration)
	if !ok {
		return datasource.NewError("invalid event type for Kafka adapter", nil)
	}

	log := p.logger.With(
		zap.String("provider_id", conf.ProviderID()),
		zap.String("method", "publish"),
		zap.String("topic", pubConf.Topic),
	)

	if p.writeClient == nil {
		return datasource.NewError("kafka write client not initialized", nil)
	}

	if len(events) == 0 {
		return nil
	}

	log.Debug("publish", zap.Int("event_count", len(events)))

	var wg sync.WaitGroup
	wg.Add(len(events))

	var errs []error
	var errMutex sync.Mutex

	for _, streamEvent := range events {
		evt, err := castToMutableEvent(streamEvent)
		if err != nil {
			wg.Done()
			errMutex.Lock()
			errs = append(errs, err)
			errMutex.Unlock()
			continue
		}

		headers := make([]kgo.RecordHeader, 0, len(evt.Headers))
		for key, value := range evt.Headers {
			headers = append(headers, kgo.RecordHeader{
				Key:   key,
				Value: value,
			})
		}

		p.writeClient.Produce(ctx, &kgo.Record{
			Key:     evt.Key,
			Topic:   pubConf.Topic,
			Value:   evt.Data,
			Headers: headers,
		}, func(record *kgo.Record, err error) {
			defer wg.Done()
			if err != nil {
				errMutex.Lock()
				errs = append(errs, err)
				errMutex.Unlock()
			}
		})
	}

	wg.Wait()

	// Produce metrics for all failed and successfully published events
	successCount := len(events) - len(errs)
	for range successCount {
		p.streamMetricStore.Produce(ctx, metric.StreamsEvent{
			ProviderId:          pubConf.ProviderID(),
			StreamOperationName: kafkaProduce,
			ProviderType:        metric.ProviderTypeKafka,
			DestinationName:     pubConf.Topic,
		})
	}
	for range len(errs) {
		p.streamMetricStore.Produce(ctx, metric.StreamsEvent{
			ProviderId:          pubConf.ProviderID(),
			StreamOperationName: kafkaProduce,
			ProviderType:        metric.ProviderTypeKafka,
			ErrorType:           "publish_error",
			DestinationName:     pubConf.Topic,
		})
	}

	// Log all errors, if any, as a single entry and return error
	if len(errs) > 0 {
		combinedErr := errors.Join(errs...)
		log.Error("publish errors", zap.Error(combinedErr), zap.Int("failed_count", len(errs)), zap.Int("total_count", len(events)))
		return datasource.NewError(
			fmt.Sprintf("error publishing %d/%d events to Kafka topic %s", len(errs), len(events), pubConf.Topic), combinedErr,
		)
	}

	return nil
}

func (p *ProviderAdapter) Startup(ctx context.Context) (err error) {
	p.writeClient, err = kgo.NewClient(append(p.opts,
		// For observability, we set the client ID to "router"
		kgo.ClientID("cosmo.router.producer"))...,
	)
	if err != nil {
		return err
	}

	// In lenient mode probe connectivity so an unreachable broker surfaces a distinct
	// "could not connect" error at startup, consistent with the NATS and Redis adapters.
	// The client is kept regardless: kgo connects lazily and reconnects on its own, so the
	// provider recovers without a restart once the broker is reachable. The probe is bounded
	// so it completes well within the startup timeout.
	if p.skipUnavailable {
		pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		if pingErr := p.writeClient.Ping(pingCtx); pingErr != nil {
			return datasource.NewError("kafka provider could not connect to the configured brokers; it will keep retrying in the background", pingErr)
		}
	}

	return
}

func (p *ProviderAdapter) Shutdown(ctx context.Context) error {

	if p.writeClient == nil {
		return nil
	}

	err := p.writeClient.Flush(ctx)
	if err != nil {
		p.logger.Error("flushing write client", zap.Error(err))
	}

	p.writeClient.Close()

	// Cancel the context to stop all pollers
	p.cancel()

	// Wait until all pollers are closed
	p.closeWg.Wait()

	if err != nil {
		return fmt.Errorf("kafka pubsub shutdown: %w", err)
	}

	return nil
}

func NewProviderAdapter(ctx context.Context, logger *zap.Logger, opts []kgo.Opt, providerOpts datasource.ProviderOpts) (*ProviderAdapter, error) {
	ctx, cancel := context.WithCancel(ctx)
	if logger == nil {
		logger = zap.NewNop()
	}

	var store metric.StreamMetricStore
	if providerOpts.StreamMetricStore != nil {
		store = providerOpts.StreamMetricStore
	} else {
		store = metric.NewNoopStreamMetricStore()
	}

	return &ProviderAdapter{
		ctx:               ctx,
		logger:            logger.With(zap.String("pubsub", "kafka")),
		opts:              opts,
		closeWg:           sync.WaitGroup{},
		cancel:            cancel,
		streamMetricStore: store,
		skipUnavailable:   providerOpts.SkipUnavailableProviders,
	}, nil
}

func castToMutableEvent(event datasource.StreamEvent) (*MutableEvent, error) {
	switch evt := event.(type) {
	case *Event:
		return evt.evt, nil
	case *MutableEvent:
		return evt, nil
	default:
		return nil, errors.New("invalid event type for Kafka adapter")
	}
}
