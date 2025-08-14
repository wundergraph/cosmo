package metric

import (
	"fmt"

	otelmetric "go.opentelemetry.io/otel/metric"
)

// Event (Kafka/Redis/NATS) metric constants
const (
	kafkaPublishMessages  = "router.kafka.publish.messages"
	kafkaPublishFailures  = "router.kafka.publish.fail"
	kafkaMessagesReceived = "router.kafka.messages.received"

	redisPublishMessages  = "router.redis.publish.messages"
	redisPublishFailures  = "router.redis.publish.fail"
	redisMessagesReceived = "router.redis.messages.received"

	natsPublishMessages  = "router.nats.publish.messages"
	natsPublishFailures  = "router.nats.publish.fail"
	natsMessagesReceived = "router.nats.messages.received"
	natsRequests         = "router.nats.request"
	natsRequestFailures  = "router.nats.request.fail"
)

var (
	kafkaPublishMessagesOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of Kafka messages published"),
	}
	kafkaPublishFailuresOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of Kafka publish failures"),
	}
	kafkaMessagesReceivedOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of Kafka messages received"),
	}

	redisPublishMessagesOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of Redis messages published"),
	}
	redisPublishFailuresOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of Redis publish failures"),
	}
	redisMessagesReceivedOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of Redis messages received"),
	}

	natsPublishMessagesOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of NATS messages published"),
	}
	natsPublishFailuresOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of NATS publish failures"),
	}
	natsMessagesReceivedOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of NATS messages received"),
	}

	// New NATS request counter options
	natsRequestsOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of NATS requests"),
	}
	natsRequestFailuresOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of NATS request failures"),
	}
)

type eventInstruments struct {
	kafkaPublishMessages  otelmetric.Int64Counter
	kafkaPublishFailures  otelmetric.Int64Counter
	kafkaMessagesReceived otelmetric.Int64Counter

	redisPublishMessages  otelmetric.Int64Counter
	redisPublishFailures  otelmetric.Int64Counter
	redisMessagesReceived otelmetric.Int64Counter

	natsPublishMessages  otelmetric.Int64Counter
	natsPublishFailures  otelmetric.Int64Counter
	natsMessagesReceived otelmetric.Int64Counter

	// New NATS request instruments
	natsRequests        otelmetric.Int64Counter
	natsRequestFailures otelmetric.Int64Counter
}

func newEventInstruments(meter otelmetric.Meter) (*eventInstruments, error) {
	kafkaPublishMessagesCounter, err := meter.Int64Counter(
		kafkaPublishMessages,
		kafkaPublishMessagesOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create kafka publish messages counter: %w", err)
	}

	kafkaPublishFailuresCounter, err := meter.Int64Counter(
		kafkaPublishFailures,
		kafkaPublishFailuresOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create kafka publish failures counter: %w", err)
	}

	kafkaMessagesReceivedCounter, err := meter.Int64Counter(
		kafkaMessagesReceived,
		kafkaMessagesReceivedOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create kafka messages received counter: %w", err)
	}

	redisPublishMessagesCounter, err := meter.Int64Counter(
		redisPublishMessages,
		redisPublishMessagesOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create redis publish messages counter: %w", err)
	}

	redisPublishFailuresCounter, err := meter.Int64Counter(
		redisPublishFailures,
		redisPublishFailuresOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create redis publish failures counter: %w", err)
	}

	redisMessagesReceivedCounter, err := meter.Int64Counter(
		redisMessagesReceived,
		redisMessagesReceivedOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create redis messages received counter: %w", err)
	}

	natsPublishMessagesCounter, err := meter.Int64Counter(
		natsPublishMessages,
		natsPublishMessagesOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create nats publish messages counter: %w", err)
	}

	natsPublishFailuresCounter, err := meter.Int64Counter(
		natsPublishFailures,
		natsPublishFailuresOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create nats publish failures counter: %w", err)
	}

	natsMessagesReceivedCounter, err := meter.Int64Counter(
		natsMessagesReceived,
		natsMessagesReceivedOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create nats messages received counter: %w", err)
	}

	// New NATS request counters
	natsRequestsCounter, err := meter.Int64Counter(
		natsRequests,
		natsRequestsOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create nats requests counter: %w", err)
	}

	natsRequestFailuresCounter, err := meter.Int64Counter(
		natsRequestFailures,
		natsRequestFailuresOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create nats request failures counter: %w", err)
	}

	return &eventInstruments{
		kafkaPublishMessages:  kafkaPublishMessagesCounter,
		kafkaPublishFailures:  kafkaPublishFailuresCounter,
		kafkaMessagesReceived: kafkaMessagesReceivedCounter,

		redisPublishMessages:  redisPublishMessagesCounter,
		redisPublishFailures:  redisPublishFailuresCounter,
		redisMessagesReceived: redisMessagesReceivedCounter,

		natsPublishMessages:  natsPublishMessagesCounter,
		natsPublishFailures:  natsPublishFailuresCounter,
		natsMessagesReceived: natsMessagesReceivedCounter,

		// NATS request instruments
		natsRequests:        natsRequestsCounter,
		natsRequestFailures: natsRequestFailuresCounter,
	}, nil
}
