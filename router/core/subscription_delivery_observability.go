package core

import (
	"context"
	"errors"
	"net"
	"sync"
	"syscall"
	"time"

	"github.com/wundergraph/cosmo/router/pkg/statistics"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

const (
	subscriptionTransportSSE       = "sse"
	subscriptionTransportWebSocket = "websocket"
)

type subscriptionTelemetryContext struct {
	transport     string
	subprotocol   string
	requestID     string
	operationName string
	clientName    string
	clientVersion string
	connectionID  resolve.ConnectionID
	writeTimeout  time.Duration
}

type subscriptionWriteError struct {
	stage string
	err   error
}

type subscriptionDisconnectTracker struct {
	once      sync.Once
	stats     statistics.EngineStatistics
	logger    *zap.Logger
	telemetry subscriptionTelemetryContext
}

func newSubscriptionDisconnectTracker(stats statistics.EngineStatistics, logger *zap.Logger, telemetry subscriptionTelemetryContext) *subscriptionDisconnectTracker {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &subscriptionDisconnectTracker{stats: stats, logger: logger, telemetry: telemetry}
}

func (t *subscriptionDisconnectTracker) disconnect(initiator, reason string, err error) {
	if t == nil {
		return
	}
	t.once.Do(func() {
		observeSubscription(t.stats, statistics.SubscriptionObservation{
			Kind:             statistics.SubscriptionObservationDisconnect,
			Transport:        t.telemetry.transport,
			Initiator:        initiator,
			DisconnectReason: reason,
			Subprotocol:      t.telemetry.subprotocol,
		})
		fields := []zap.Field{
			zap.String("transport", t.telemetry.transport),
			zap.String("websocket_subprotocol", t.telemetry.subprotocol),
			zap.String("request_id", t.telemetry.requestID),
			zap.String("client_name", t.telemetry.clientName),
			zap.String("client_version", t.telemetry.clientVersion),
			zap.Int64("connection_id", int64(t.telemetry.connectionID)),
			zap.String("disconnect_initiator", initiator),
			zap.String("disconnect_reason", reason),
		}
		if err != nil {
			fields = append(fields, zap.Error(err))
		}
		if reason == "normal_completion" || reason == "client_closed" || reason == "context_canceled" {
			t.logger.Debug("Subscription client disconnected", fields...)
			return
		}
		t.logger.Info("Subscription client disconnected", fields...)
	})
}

func disconnectReasonFromWriteError(err error) (initiator, reason string) {
	_, failureReason := classifySubscriptionWriteFailure(err)
	switch failureReason {
	case "timeout":
		return "router", "write_timeout"
	case "client_disconnected":
		return "client", "client_closed"
	case "context_canceled":
		return "client", "context_canceled"
	default:
		return "network", "network_error"
	}
}

func (e *subscriptionWriteError) Error() string                { return e.err.Error() }
func (e *subscriptionWriteError) Unwrap() error                { return e.err }
func (e *subscriptionWriteError) IsSubscriptionDeliveryError() {}

func wrapSubscriptionWriteError(stage string, err error) error {
	if err == nil {
		return nil
	}
	return &subscriptionWriteError{stage: stage, err: err}
}

func observeSubscriptionDelivery(stats statistics.EngineStatistics, logger *zap.Logger, telemetry subscriptionTelemetryContext, report resolve.SubscriptionDeliveryReport) {
	observeSubscription(stats, statistics.SubscriptionObservation{
		Kind:        statistics.SubscriptionObservationDeliveryAttempt,
		Transport:   telemetry.transport,
		FrameType:   "next",
		Subprotocol: telemetry.subprotocol,
	})
	if report.Err == nil {
		return
	}
	if logger == nil {
		logger = zap.NewNop()
	}

	stage, reason := classifySubscriptionWriteFailure(report.Err)
	observeSubscription(stats, statistics.SubscriptionObservation{
		Kind:          statistics.SubscriptionObservationDeliveryFailure,
		Transport:     telemetry.transport,
		FrameType:     "next",
		FailureStage:  stage,
		FailureReason: reason,
		Subprotocol:   telemetry.subprotocol,
	})
	logger.Warn("Subscription event delivery failed",
		zap.String("transport", telemetry.transport),
		zap.String("websocket_subprotocol", telemetry.subprotocol),
		zap.String("request_id", telemetry.requestID),
		zap.String("operation_name", telemetry.operationName),
		zap.String("client_name", telemetry.clientName),
		zap.String("client_version", telemetry.clientVersion),
		zap.Int64("connection_id", int64(report.ConnectionID)),
		zap.Int64("subscription_id", report.SubscriptionID),
		zap.Uint64("trigger_id", report.TriggerID),
		zap.String("event_id", report.EventID),
		zap.String("event_hash", report.EventHash),
		zap.Int("event_bytes", report.EventBytes),
		zap.String("event_source_type", report.SourceType),
		zap.String("event_source_name", report.SourceName),
		zap.String("event_source_id", report.SourceID),
		zap.String("frame_type", "next"),
		zap.String("failure_stage", stage),
		zap.String("failure_reason", reason),
		zap.Int64("configured_write_timeout_ms", telemetry.writeTimeout.Milliseconds()),
		zap.Error(report.Err),
	)
}

func observeSubscriptionFrame(stats statistics.EngineStatistics, logger *zap.Logger, telemetry subscriptionTelemetryContext, frameType string, err error) {
	observeSubscription(stats, statistics.SubscriptionObservation{
		Kind:        statistics.SubscriptionObservationDeliveryAttempt,
		Transport:   telemetry.transport,
		FrameType:   frameType,
		Subprotocol: telemetry.subprotocol,
	})
	if err == nil {
		return
	}
	if logger == nil {
		logger = zap.NewNop()
	}
	stage, reason := classifySubscriptionWriteFailure(err)
	observeSubscription(stats, statistics.SubscriptionObservation{
		Kind:          statistics.SubscriptionObservationDeliveryFailure,
		Transport:     telemetry.transport,
		FrameType:     frameType,
		FailureStage:  stage,
		FailureReason: reason,
		Subprotocol:   telemetry.subprotocol,
	})
	logger.Warn("Subscription frame delivery failed",
		zap.String("transport", telemetry.transport),
		zap.String("websocket_subprotocol", telemetry.subprotocol),
		zap.String("request_id", telemetry.requestID),
		zap.String("operation_name", telemetry.operationName),
		zap.String("client_name", telemetry.clientName),
		zap.String("client_version", telemetry.clientVersion),
		zap.Int64("connection_id", int64(telemetry.connectionID)),
		zap.String("frame_type", frameType),
		zap.String("failure_stage", stage),
		zap.String("failure_reason", reason),
		zap.Int64("configured_write_timeout_ms", telemetry.writeTimeout.Milliseconds()),
		zap.Error(err),
	)
}

func observeSubscription(stats statistics.EngineStatistics, observation statistics.SubscriptionObservation) {
	observer, ok := stats.(statistics.SubscriptionObserver)
	if !ok {
		return
	}
	observer.ObserveSubscription(observation)
}

func classifySubscriptionWriteFailure(err error) (stage, reason string) {
	stage = "write"
	var writeErr *subscriptionWriteError
	if errors.As(err, &writeErr) {
		stage = writeErr.stage
	}

	var netErr net.Error
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return stage, "timeout"
	case errors.As(err, &netErr) && netErr.Timeout():
		return stage, "timeout"
	case errors.Is(err, context.Canceled):
		return stage, "context_canceled"
	case errors.Is(err, net.ErrClosed), errors.Is(err, syscall.EPIPE), errors.Is(err, syscall.ECONNRESET):
		return stage, "client_disconnected"
	case errors.Is(err, errors.ErrUnsupported):
		return stage, "unsupported"
	case stage == "serialize":
		return stage, "serialization_error"
	default:
		return stage, "network_error"
	}
}
