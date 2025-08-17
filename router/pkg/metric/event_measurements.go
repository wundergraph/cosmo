package metric

import (
	"fmt"

	otelmetric "go.opentelemetry.io/otel/metric"
)

// Event (Kafka/Redis/NATS) metric constants
const (
	// unified counters across providers per messaging semantic conventions
	messagingClientSentMessages     = "messaging.client.sent.messages"
	messagingClientConsumedMessages = "messaging.client.consumed.messages"
)

var (
	messagingClientSentMessagesOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of messaging client sent messages"),
	}
	messagingClientConsumedMessagesOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of messaging client consumed messages"),
	}
)

type eventInstruments struct {
	// instruments following messaging semantic conventions
	sentMessages     otelmetric.Int64Counter
	consumedMessages otelmetric.Int64Counter
}

func newEventInstruments(meter otelmetric.Meter) (*eventInstruments, error) {
	sentCounter, err := meter.Int64Counter(
		messagingClientSentMessages,
		messagingClientSentMessagesOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create sent messages counter: %w", err)
	}

	consumedCounter, err := meter.Int64Counter(
		messagingClientConsumedMessages,
		messagingClientConsumedMessagesOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create consumed messages counter: %w", err)
	}

	return &eventInstruments{
		sentMessages:     sentCounter,
		consumedMessages: consumedCounter,
	}, nil
}
