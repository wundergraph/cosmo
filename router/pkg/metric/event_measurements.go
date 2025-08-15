package metric

import (
	"fmt"

	otelmetric "go.opentelemetry.io/otel/metric"
)

// Event (Kafka/Redis/NATS) metric constants
const (
	// unified counters across providers; provider type captured via attributes
	eventsPublishMessages  = "router.events.publish.messages"
	eventsPublishFailures  = "router.events.publish.fail"
	eventsMessagesReceived = "router.events.messages.received"

	// keep nats request metrics separate as they are not generic publish/receive
	natsRequests        = "router.nats.request"
	natsRequestFailures = "router.nats.request.fail"
)

var (
	eventsPublishMessagesOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of event messages published"),
	}
	eventsPublishFailuresOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of event publish failures"),
	}
	eventsMessagesReceivedOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of event messages received"),
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
	// unified instruments
	publishMessages  otelmetric.Int64Counter
	publishFailures  otelmetric.Int64Counter
	messagesReceived otelmetric.Int64Counter

	// NATS request instruments
	natsRequests        otelmetric.Int64Counter
	natsRequestFailures otelmetric.Int64Counter
}

func newEventInstruments(meter otelmetric.Meter) (*eventInstruments, error) {
	publishMessagesCounter, err := meter.Int64Counter(
		eventsPublishMessages,
		eventsPublishMessagesOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create publish messages counter: %w", err)
	}

	publishFailuresCounter, err := meter.Int64Counter(
		eventsPublishFailures,
		eventsPublishFailuresOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create publish failures counter: %w", err)
	}

	messagesReceivedCounter, err := meter.Int64Counter(
		eventsMessagesReceived,
		eventsMessagesReceivedOptions...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create messages received counter: %w", err)
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
		publishMessages:  publishMessagesCounter,
		publishFailures:  publishFailuresCounter,
		messagesReceived: messagesReceivedCounter,

		// NATS request instruments
		natsRequests:        natsRequestsCounter,
		natsRequestFailures: natsRequestFailuresCounter,
	}, nil
}
