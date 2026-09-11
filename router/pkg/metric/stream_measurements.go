package metric

import (
	"fmt"

	otelmetric "go.opentelemetry.io/otel/metric"
)

const (
	messagingSentMessages      = "router.streams.sent.messages"
	messagingConsumedMessages  = "router.streams.received.messages"
	messagingProcessedMessages = "router.streams.processed.messages"
	messagingDispatchInFlight  = "router.streams.dispatch.in_flight"
	messagingDispatchDuration  = "router.streams.dispatch.duration"
)

var (
	messagingSentMessagesOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of stream sent messages"),
	}
	messagingConsumedMessagesOptions = []otelmetric.Int64CounterOption{
		otelmetric.WithDescription("Number of stream consumed messages"),
	}
	messagingProcessedMessagesOptions = []otelmetric.Int64CounterOption{otelmetric.WithDescription("Number of stream messages whose subscription dispatch completed")}
	messagingDispatchInFlightOptions  = []otelmetric.Int64UpDownCounterOption{otelmetric.WithDescription("Number of stream messages currently dispatching to subscriptions")}
	messagingDispatchDurationOptions  = []otelmetric.Float64HistogramOption{otelmetric.WithUnit("ms"), otelmetric.WithDescription("Duration of stream message dispatch to subscriptions")}
)

type eventInstruments struct {
	producedMessages  otelmetric.Int64Counter
	consumedMessages  otelmetric.Int64Counter
	processedMessages otelmetric.Int64Counter
	dispatchInFlight  otelmetric.Int64UpDownCounter
	dispatchDuration  otelmetric.Float64Histogram
}

func newStreamEventInstruments(meter otelmetric.Meter) (*eventInstruments, error) {
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
	processedCounter, err := meter.Int64Counter(messagingProcessedMessages, messagingProcessedMessagesOptions...)
	if err != nil {
		return nil, fmt.Errorf("failed to create processed messages counter: %w", err)
	}
	dispatchInFlight, err := meter.Int64UpDownCounter(messagingDispatchInFlight, messagingDispatchInFlightOptions...)
	if err != nil {
		return nil, fmt.Errorf("failed to create dispatch in flight counter: %w", err)
	}
	dispatchDuration, err := meter.Float64Histogram(messagingDispatchDuration, messagingDispatchDurationOptions...)
	if err != nil {
		return nil, fmt.Errorf("failed to create dispatch duration histogram: %w", err)
	}

	return &eventInstruments{
		producedMessages:  producedCounter,
		consumedMessages:  consumedCounter,
		processedMessages: processedCounter,
		dispatchInFlight:  dispatchInFlight,
		dispatchDuration:  dispatchDuration,
	}, nil
}
