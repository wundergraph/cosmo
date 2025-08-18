package metric

import (
	"fmt"

	otelmetric "go.opentelemetry.io/otel/metric"
)

const (
	messagingSentMessages     = "messaging.event.sent.messages"
	messagingConsumedMessages = "messaging.event.received.messages"
)

var (
	messagingSentMessagesOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of messaging event sent messages"),
	}
	messagingConsumedMessagesOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of messaging event consumed messages"),
	}
)

type eventInstruments struct {
	producedMessages otelmetric.Int64Counter
	consumedMessages otelmetric.Int64Counter
}

func newMessagingEventInstruments(meter otelmetric.Meter) (*eventInstruments, error) {
	producedCounter, err := meter.Int64Counter(
		messagingSentMessages,
		messagingSentMessagesOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create sent messages counter: %w", err)
	}

	consumedCounter, err := meter.Int64Counter(
		messagingConsumedMessages,
		messagingConsumedMessagesOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create received messages counter: %w", err)
	}

	return &eventInstruments{
		producedMessages: producedCounter,
		consumedMessages: consumedCounter,
	}, nil
}
