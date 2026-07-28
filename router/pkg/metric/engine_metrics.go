package metric

import (
	"context"
	"errors"
	"fmt"

	"github.com/wundergraph/cosmo/router/pkg/statistics"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
)

const (
	cosmoEngineMeterName    = "cosmo.router.engine"
	cosmoEngineMeterVersion = "0.0.1"

	engineMetricBaseKey             = "router.engine."
	engineConnectionCountKey        = engineMetricBaseKey + "connections"
	engineSubscriptionCountKey      = engineMetricBaseKey + "subscriptions"
	engineTriggerCountKey           = engineMetricBaseKey + "triggers"
	engineMessagesSentKey           = engineMetricBaseKey + "messages.sent"
	engineResolversMaxConcurrentKey = engineMetricBaseKey + "resolvers.max_concurrent"
	engineResolversInflightKey      = engineMetricBaseKey + "resolvers.inflight"
)

type engineInstruments struct {
	connectionCount        otelmetric.Int64ObservableUpDownCounter
	subscriptionCount      otelmetric.Int64ObservableUpDownCounter
	triggerCount           otelmetric.Int64ObservableUpDownCounter
	messagesSent           otelmetric.Int64ObservableCounter
	resolversMaxConcurrent otelmetric.Int64ObservableUpDownCounter
	resolversInflight      otelmetric.Int64ObservableUpDownCounter
}

func (i *engineInstruments) toList() []otelmetric.Observable {
	result := make([]otelmetric.Observable, 0)

	if i.connectionCount != nil {
		result = append(result, i.connectionCount)
	}

	if i.subscriptionCount != nil {
		result = append(result, i.subscriptionCount)
	}

	if i.triggerCount != nil {
		result = append(result, i.triggerCount)
	}

	if i.messagesSent != nil {
		result = append(result, i.messagesSent)
	}

	if i.resolversMaxConcurrent != nil {
		result = append(result, i.resolversMaxConcurrent)
	}

	if i.resolversInflight != nil {
		result = append(result, i.resolversInflight)
	}

	return result
}

// EngineMetrics is a struct that holds the engine metrics.
type EngineMetrics struct {
	instruments             *engineInstruments
	meter                   otelmetric.Meter
	baseAttributes          []attribute.KeyValue
	instrumentRegistrations []otelmetric.Registration
	logger                  *zap.Logger
}

// NewEngineMetrics creates a new EngineMetrics instance.
func NewEngineMetrics(
	logger *zap.Logger,
	baseAttributes []attribute.KeyValue,
	provider *metric.MeterProvider,
	stats statistics.EngineStatistics,
	statConfig *EngineStatsConfig,
	resolverStats bool,
) (*EngineMetrics, error) {
	if !statConfig.Enabled() && !resolverStats {
		return nil, nil
	}

	meter := provider.Meter(cosmoEngineMeterName, otelmetric.WithInstrumentationVersion(cosmoEngineMeterVersion))

	instruments, err := setupInstruments(meter, statConfig, resolverStats)
	if err != nil {
		return nil, err
	}

	em := &EngineMetrics{
		instruments:    instruments,
		meter:          meter,
		baseAttributes: baseAttributes,
		logger:         logger,
	}

	if err := em.registerObservers(stats); err != nil {
		return nil, err
	}

	return em, nil
}

func setupInstruments(m otelmetric.Meter, statConfig *EngineStatsConfig, resolverStats bool) (*engineInstruments, error) {
	var (
		err error

		connectionCount        otelmetric.Int64ObservableUpDownCounter
		subscriptionCount      otelmetric.Int64ObservableUpDownCounter
		triggerCount           otelmetric.Int64ObservableUpDownCounter
		messagesSent           otelmetric.Int64ObservableCounter
		resolversMaxConcurrent otelmetric.Int64ObservableUpDownCounter
		resolversInflight      otelmetric.Int64ObservableUpDownCounter
	)

	if statConfig.Subscription {
		connectionCount, err = m.Int64ObservableUpDownCounter(engineConnectionCountKey,
			otelmetric.WithDescription("Number of connections in the engine. Contains both websocket and http connections"))
		if err != nil {
			return nil, err
		}

		subscriptionCount, err = m.Int64ObservableUpDownCounter(engineSubscriptionCountKey,
			otelmetric.WithDescription("Number of subscriptions in the engine."))

		if err != nil {
			return nil, err
		}

		triggerCount, err = m.Int64ObservableUpDownCounter(engineTriggerCountKey,
			otelmetric.WithDescription("Number of triggers in the engine."))
		if err != nil {
			return nil, err
		}

		messagesSent, err = m.Int64ObservableCounter(engineMessagesSentKey,
			otelmetric.WithDescription("Number of subscription updates in the engine."))
		if err != nil {
			return nil, err
		}
	}

	if resolverStats {
		resolversMaxConcurrent, err = m.Int64ObservableUpDownCounter(engineResolversMaxConcurrentKey,
			otelmetric.WithDescription("Configured maximum number of concurrent GraphQL resolver slots (ENGINE_MAX_CONCURRENT_RESOLVERS)."))
		if err != nil {
			return nil, err
		}

		resolversInflight, err = m.Int64ObservableUpDownCounter(engineResolversInflightKey,
			otelmetric.WithDescription("Number of GraphQL resolver slots currently in use."))
		if err != nil {
			return nil, err
		}
	}

	return &engineInstruments{
		connectionCount:        connectionCount,
		subscriptionCount:      subscriptionCount,
		triggerCount:           triggerCount,
		messagesSent:           messagesSent,
		resolversMaxConcurrent: resolversMaxConcurrent,
		resolversInflight:      resolversInflight,
	}, nil
}

func (e *EngineMetrics) registerObservers(stats statistics.EngineStatistics) error {
	instrumentList := e.instruments.toList()

	// Nothing to register
	if len(instrumentList) == 0 {
		return nil
	}

	rc, err := e.meter.RegisterCallback(func(_ context.Context, o otelmetric.Observer) error {
		e.observeInstruments(o, stats)
		return nil
	}, instrumentList...)

	if err != nil {
		return err
	}

	e.instrumentRegistrations = append(e.instrumentRegistrations, rc)

	return nil
}

func (e *EngineMetrics) observeInstruments(o otelmetric.Observer, stats statistics.EngineStatistics) {
	report := stats.GetReport()

	if e.instruments.connectionCount != nil {
		o.ObserveInt64(e.instruments.connectionCount, int64(report.Connections), otelmetric.WithAttributes(e.baseAttributes...))
		o.ObserveInt64(e.instruments.subscriptionCount, int64(report.Subscriptions), otelmetric.WithAttributes(e.baseAttributes...))
		o.ObserveInt64(e.instruments.triggerCount, int64(report.Triggers), otelmetric.WithAttributes(e.baseAttributes...))
		o.ObserveInt64(e.instruments.messagesSent, int64(report.MessagesSent), otelmetric.WithAttributes(e.baseAttributes...))
	}

	if e.instruments.resolversMaxConcurrent != nil {
		o.ObserveInt64(e.instruments.resolversMaxConcurrent, int64(report.ResolverMaxConcurrent), otelmetric.WithAttributes(e.baseAttributes...))
		o.ObserveInt64(e.instruments.resolversInflight, int64(report.ResolverInflight), otelmetric.WithAttributes(e.baseAttributes...))
	}
}

func (e *EngineMetrics) Shutdown() error {
	var err error

	for _, reg := range e.instrumentRegistrations {
		if regErr := reg.Unregister(); regErr != nil {
			err = errors.Join(err, regErr)
		}
	}

	if err != nil {
		return fmt.Errorf("shutdown engine metrics: %w", err)
	}

	return nil
}
