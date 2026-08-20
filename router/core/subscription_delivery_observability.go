package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net"
	"sync"
	"sync/atomic"
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

type subscriptionDeliveryTracker struct {
	sequence      atomic.Uint64
	failureLogged atomic.Bool
	stats         statistics.EngineStatistics
	logger        *zap.Logger
	subscription  string
}

func newSubscriptionDisconnectTracker(stats statistics.EngineStatistics, logger *zap.Logger, telemetry subscriptionTelemetryContext) *subscriptionDisconnectTracker {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &subscriptionDisconnectTracker{stats: stats, logger: logger, telemetry: telemetry}
}

func newSubscriptionDeliveryTracker(stats statistics.EngineStatistics, logger *zap.Logger, subscription string) *subscriptionDeliveryTracker {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &subscriptionDeliveryTracker{stats: stats, logger: logger, subscription: subscription}
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
	case "connection_closed":
		return "router", "connection_closed"
	case "context_canceled":
		return "client", "context_canceled"
	default:
		return "network", "network_error"
	}
}

func (e *subscriptionWriteError) Error() string { return e.err.Error() }
func (e *subscriptionWriteError) Unwrap() error { return e.err }

func wrapSubscriptionWriteError(stage string, err error) error {
	if err == nil {
		return nil
	}
	return &subscriptionWriteError{stage: stage, err: err}
}

func (t *subscriptionDeliveryTracker) observe(telemetry subscriptionTelemetryContext, payload []byte, duration time.Duration, err error) {
	if t == nil {
		return
	}
	deliverySequence := t.sequence.Add(1)
	observeSubscription(t.stats, statistics.SubscriptionObservation{
		Kind:        statistics.SubscriptionObservationDeliveryAttempt,
		Transport:   telemetry.transport,
		FrameType:   "next",
		Subprotocol: telemetry.subprotocol,
	})
	if err == nil {
		return
	}

	stage, reason := classifySubscriptionWriteFailure(err)
	observeSubscription(t.stats, statistics.SubscriptionObservation{
		Kind:          statistics.SubscriptionObservationDeliveryFailure,
		Transport:     telemetry.transport,
		FrameType:     "next",
		FailureStage:  stage,
		FailureReason: reason,
		Subprotocol:   telemetry.subprotocol,
	})
	payloadHash := sha256.Sum256(payload)
	fields := []zap.Field{
		zap.String("transport", telemetry.transport),
		zap.String("websocket_subprotocol", telemetry.subprotocol),
		zap.String("request_id", telemetry.requestID),
		zap.String("operation_name", telemetry.operationName),
		zap.Int64("connection_id", int64(telemetry.connectionID)),
		zap.String("subscription_id", t.subscription),
		zap.Uint64("delivery_sequence", deliverySequence),
		zap.String("payload_sha256", hex.EncodeToString(payloadHash[:])),
		zap.Int("payload_bytes", len(payload)),
		zap.String("frame_type", "next"),
		zap.String("failure_stage", stage),
		zap.String("failure_reason", reason),
		zap.Int64("configured_write_timeout_ms", telemetry.writeTimeout.Milliseconds()),
		zap.Float64("write_duration_ms", float64(duration)/float64(time.Millisecond)),
		zap.Error(err),
	}
	if t.failureLogged.CompareAndSwap(false, true) {
		t.logger.Warn("Subscription event delivery failed", fields...)
		return
	}
	t.logger.Debug("Subscription event delivery failed", fields...)
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
	case errors.Is(err, net.ErrClosed):
		return stage, "connection_closed"
	case errors.Is(err, syscall.EPIPE), errors.Is(err, syscall.ECONNRESET):
		return stage, "client_disconnected"
	case errors.Is(err, errors.ErrUnsupported):
		return stage, "unsupported"
	case stage == "serialize":
		return stage, "serialization_error"
	default:
		return stage, "network_error"
	}
}
