package kafka

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/wundergraph/cosmo/router/pkg/metric"

	"github.com/twmb/franz-go/pkg/kerr"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/kmsg"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"
)

var (
	errClientClosed = errors.New("client closed")
)

// Ensure ProviderAdapter implements Adapter
var _ datasource.Adapter = (*ProviderAdapter)(nil)

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
	providerId  string
	emitCursors bool
	tracker     *positionTracker
}

// topicPoller polls the Kafka topic for new records and calls the updateTriggers function.
func (p *ProviderAdapter) topicPoller(ctx context.Context, client *kgo.Client, updater datasource.SubscriptionEventUpdater, pollerOpts PollerOpts) error {
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

					var kErr *kerr.Error
					if errors.As(fetchError.Err, &kErr) {
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

				var cursor string
				if pollerOpts.emitCursors {
					pollerOpts.tracker.advance(r.Topic, r.Partition, r.Offset, r.LeaderEpoch)
					pos, err := pollerOpts.tracker.snapshot()
					if err != nil {
						p.logger.Error("failed to snapshot cursor position, delivering event without a cursor", zap.Error(err))
					} else {
						cursor, err = datasource.EncodeCursor(datasource.Cursor{
							ProviderType: datasource.ProviderTypeKafka,
							ProviderID:   pollerOpts.providerId,
							IssuedAt:     time.Now().UnixMilli(),
							Position:     pos,
						})
						if err != nil {
							p.logger.Error("failed to encode cursor, delivering event without a cursor", zap.Error(err))
							cursor = ""
						}
					}
				}

				updater.Update([]datasource.StreamEvent{
					&Event{
						evt: &MutableEvent{
							Data:    r.Value,
							Headers: headers,
							Key:     r.Key,
							Cursor:  cursor,
						},
					},
				})
			}
		}
	}
}

// Subscribe subscribes to the given topics and updates the subscription updater.
// The engine already deduplicates subscriptions with the same topics, stream configuration, extensions, headers, etc.
func (p *ProviderAdapter) Subscribe(ctx context.Context, conf datasource.SubscriptionEventConfiguration, updater datasource.SubscriptionEventUpdater) error {
	subConf, ok := conf.(*SubscriptionEventConfiguration)
	if !ok {
		return datasource.NewError("invalid event type for Kafka adapter", nil)
	}

	log := p.logger.With(
		zap.String("provider_id", conf.ProviderID()),
		zap.String("method", "subscribe"),
		zap.Strings("topics", subConf.Topics),
	)

	tracker := newPositionTracker()

	// Create a new client for the topic
	// Copy opts to avoid data race when multiple goroutines call Subscribe concurrently
	opts := make([]kgo.Opt, len(p.opts), len(p.opts)+3)
	copy(opts, p.opts)
	opts = append(opts,
		// For observability, we set the client ID to "router"
		kgo.ClientID(fmt.Sprintf("cosmo.router.consumer.%s", strings.Join(subConf.Topics, "-"))),
		// FIXME: the client id should have some unique identifier, like in nats
		// What if we have multiple subscriptions for the same topics?
		// What if we have more router instances?
	)

	if resumeCursor := subConf.ResumeCursor(); resumeCursor != "" {
		assignOpts, err := p.buildResumeAssignment(ctx, resumeCursor, subConf, tracker)
		if err != nil {
			log.Error("failed to resume subscription from cursor", zap.Error(err))
			return err
		}
		opts = append(opts, assignOpts...)
	} else {
		opts = append(opts,
			kgo.ConsumeTopics(subConf.Topics...),
			// We want to consume the events produced after the first subscription was created
			// Messages are shared among all subscriptions, therefore old events are not redelivered
			// This replicates a stateless publish-subscribe model
			kgo.ConsumeResetOffset(kgo.NewOffset().AfterMilli(time.Now().UnixMilli())),
		)
	}

	client, err := kgo.NewClient(opts...)
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

		err := p.topicPoller(pollerCtx, client, updater, PollerOpts{
			providerId:  conf.ProviderID(),
			emitCursors: subConf.WantsCursors(),
			tracker:     tracker,
		})
		if err != nil {
			if errors.Is(err, errClientClosed) || errors.Is(err, context.Canceled) {
				log.Debug("poller canceled", zap.Error(err))
			} else {
				log.Error(
					"poller error",
					zap.Error(err),
					zap.String("provider_id", conf.ProviderID()),
					zap.String("provider_type", string(conf.ProviderType())),
					zap.String("field_name", conf.RootFieldName()),
				)
			}
			return
		}
	})

	return nil
}

// buildResumeAssignment decodes and validates a client-presented resume cursor, enumerates
// every partition of every subscribed topic, and returns kgo options that resume each known
// partition right after its cursor offset and start any newly-seen partition at the cursor's
// issue time. It also seeds tracker so cursors emitted after resume stay complete. franz-go's
// direct consumer treats a topic named in ConsumePartitions as exactly those partitions -- any
// partition left out would be silently dropped for the life of the resumed subscription, hence
// the metadata enumeration.
//
// A topic that does not exist yet on the broker is not a fatal error here: a fresh (non-resume)
// subscribe via ConsumeTopics tolerates this the same way, relying on franz-go's metadata
// refresh loop to pick the topic up once it exists. To match that, such topics are logged as a
// warning and consumed via ConsumeTopics instead of being assigned explicit partitions, with
// ConsumeResetOffset set to the cursor's issue time so they start where a known partition
// without a recorded position would.
func (p *ProviderAdapter) buildResumeAssignment(ctx context.Context, resumeCursor string, subConf *SubscriptionEventConfiguration, tracker *positionTracker) ([]kgo.Opt, error) {
	cur, err := datasource.DecodeCursor(resumeCursor)
	if err != nil {
		return nil, datasource.NewError("invalid resume cursor", err)
	}
	if cur.ProviderType != datasource.ProviderTypeKafka {
		return nil, datasource.NewError("resume cursor was not issued for a Kafka provider", nil)
	}
	if cur.ProviderID != subConf.Provider {
		return nil, datasource.NewError("resume cursor was issued for a different provider", nil)
	}

	var pos cursorPosition
	if err := json.Unmarshal(cur.Position, &pos); err != nil {
		return nil, datasource.NewError("invalid resume cursor position", err)
	}
	for topic := range pos {
		if !slices.Contains(subConf.Topics, topic) {
			return nil, datasource.NewError(fmt.Sprintf("resume cursor names topic %q which is not part of this subscription", topic), nil)
		}
	}

	allPartitions, missingTopics, err := p.fetchTopicPartitions(ctx, subConf.Topics)
	if err != nil {
		return nil, datasource.NewError("failed to enumerate topic partitions to resume subscription", err)
	}
	for _, topic := range missingTopics {
		p.logger.Warn("topic does not exist yet, will resume consuming it once it is created",
			zap.String("provider_id", subConf.Provider),
			zap.String("topic", topic),
		)
	}

	assign := make(map[string]map[int32]kgo.Offset, len(allPartitions))
	for topic, partitions := range allPartitions {
		partAssign := make(map[int32]kgo.Offset, len(partitions))
		for _, partition := range partitions {
			if po, ok := pos[topic][partition]; ok {
				// Records written with an old message format report LeaderEpoch == -1,
				// which is exactly franz-go's "no epoch" value, so it passes through
				// unchanged here.
				partAssign[partition] = kgo.NewOffset().At(po.Offset + 1).WithEpoch(po.Epoch)
			} else {
				partAssign[partition] = kgo.NewOffset().AfterMilli(cur.IssuedAt)
			}
		}
		assign[topic] = partAssign
	}

	tracker.seed(pos)

	opts := []kgo.Opt{kgo.ConsumePartitions(assign)}
	if len(missingTopics) > 0 {
		opts = append(opts,
			kgo.ConsumeTopics(missingTopics...),
			kgo.ConsumeResetOffset(kgo.NewOffset().AfterMilli(cur.IssuedAt)),
		)
	}

	return opts, nil
}

// fetchTopicPartitions enumerates every partition of every given topic via a single Kafka
// metadata request issued over the adapter's producer client. A topic that does not exist yet
// (UNKNOWN_TOPIC_OR_PARTITION) is not treated as an error -- it is reported back via
// missingTopics instead, so callers can fall back to the same tolerant behavior a fresh
// ConsumeTopics-based subscribe already has.
func (p *ProviderAdapter) fetchTopicPartitions(ctx context.Context, topics []string) (partitions map[string][]int32, missingTopics []string, err error) {
	req := kmsg.NewPtrMetadataRequest()
	for _, topic := range topics {
		rt := kmsg.NewMetadataRequestTopic()
		rt.Topic = kmsg.StringPtr(topic)
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
		partitions := make([]int32, 0, len(t.Partitions))
		for _, part := range t.Partitions {
			partitions = append(partitions, part.Partition)
		}
		result[topicName] = partitions
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
