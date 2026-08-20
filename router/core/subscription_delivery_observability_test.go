package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/gobwas/ws"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/wsproto"
	"github.com/wundergraph/cosmo/router/pkg/statistics"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	zapobserver "go.uber.org/zap/zaptest/observer"
)

type failingSubscriptionProtocol struct {
	writeErr error
}

func (p *failingSubscriptionProtocol) Subprotocol() string { return wsproto.GraphQLWSSubprotocol }
func (p *failingSubscriptionProtocol) Initialize() (json.RawMessage, error) {
	return nil, nil
}
func (p *failingSubscriptionProtocol) ReadMessage() (*wsproto.Message, error) { return nil, nil }
func (p *failingSubscriptionProtocol) Pong(*wsproto.Message) error            { return nil }
func (p *failingSubscriptionProtocol) WriteGraphQLData(string, json.RawMessage, json.RawMessage) error {
	return p.writeErr
}
func (p *failingSubscriptionProtocol) WriteGraphQLErrors(string, json.RawMessage, json.RawMessage) error {
	return p.writeErr
}
func (p *failingSubscriptionProtocol) Complete(string) error { return p.writeErr }

func TestSubscriptionDeliveryTrackerRecordsFailureWithoutPayload(t *testing.T) {
	logCore, logs := zapobserver.New(zapcore.DebugLevel)
	stats := statistics.NewEngineStats(t.Context(), zap.NewNop(), false)
	telemetry := subscriptionTelemetryContext{
		transport:     subscriptionTransportSSE,
		requestID:     "request-1",
		operationName: "ProductUpdated",
	}

	payload := []byte(`{"data":{"productUpdated":{"id":"1"}}}`)
	tracker := newSubscriptionDeliveryTracker(stats, zap.New(logCore), "subscription-7")
	tracker.observe(telemetry, payload, 25*time.Millisecond, wrapSubscriptionWriteError("flush", context.DeadlineExceeded))

	report := stats.GetReport()
	require.Len(t, report.SubscriptionObservations, 2)
	observations := make(map[statistics.SubscriptionObservationKind]statistics.SubscriptionObservationCount, 2)
	for _, observation := range report.SubscriptionObservations {
		observations[observation.Observation.Kind] = observation
	}
	require.Equal(t, uint64(1), observations[statistics.SubscriptionObservationDeliveryAttempt].Count)
	require.Equal(t, uint64(1), observations[statistics.SubscriptionObservationDeliveryFailure].Count)
	require.Equal(t, "flush", observations[statistics.SubscriptionObservationDeliveryFailure].Observation.FailureStage)
	require.Equal(t, "timeout", observations[statistics.SubscriptionObservationDeliveryFailure].Observation.FailureReason)
	require.Equal(t, 1, logs.Len())
	fields := logs.All()[0].ContextMap()
	payloadHash := sha256.Sum256(payload)
	require.Equal(t, "subscription-7", fields["subscription_id"])
	require.Equal(t, uint64(1), fields["delivery_sequence"])
	require.Equal(t, hex.EncodeToString(payloadHash[:]), fields["payload_sha256"])
	require.Equal(t, int64(len(payload)), fields["payload_bytes"])
	require.Equal(t, 25.0, fields["write_duration_ms"])
	require.Equal(t, "flush", fields["failure_stage"])
	require.Equal(t, "timeout", fields["failure_reason"])
	require.NotContains(t, fields, "payload")
	require.NotContains(t, fields, "event_source_id")
	require.NotContains(t, fields, "client_name")
	require.NotContains(t, fields, "client_version")
}

func TestSubscriptionDisconnectTrackerRecordsOnce(t *testing.T) {
	logCore, logs := zapobserver.New(zapcore.DebugLevel)
	stats := statistics.NewEngineStats(t.Context(), zap.NewNop(), false)
	tracker := newSubscriptionDisconnectTracker(stats, zap.New(logCore), subscriptionTelemetryContext{
		transport:    subscriptionTransportWebSocket,
		subprotocol:  wsproto.GraphQLWSSubprotocol,
		connectionID: 41,
	})

	tracker.disconnect("client", "client_closed", nil)
	tracker.disconnect("network", "network_error", errors.New("late error"))

	require.Equal(t, 1, logs.Len())
	report := stats.GetReport()
	require.Len(t, report.SubscriptionObservations, 1)
	require.Equal(t, statistics.SubscriptionObservationDisconnect, report.SubscriptionObservations[0].Observation.Kind)
	require.Equal(t, "client_closed", report.SubscriptionObservations[0].Observation.DisconnectReason)
}

func TestWebsocketResponseWriterObservesFailedEventAtTransport(t *testing.T) {
	logCore, logs := zapobserver.New(zapcore.DebugLevel)
	stats := statistics.NewEngineStats(t.Context(), zap.NewNop(), false)
	payload := []byte(`{"data":{"productUpdated":{"id":"1"}}}`)
	rw := newWebsocketResponseWriter(
		"subscription-1",
		&failingSubscriptionProtocol{writeErr: context.DeadlineExceeded},
		false,
		zap.New(logCore),
		stats,
		nil,
		subscriptionTelemetryContext{
			transport:     subscriptionTransportWebSocket,
			subprotocol:   wsproto.GraphQLWSSubprotocol,
			requestID:     "request-1",
			operationName: "ProductUpdated",
		},
	)

	_, err := rw.Write(payload)
	require.NoError(t, err)
	require.ErrorIs(t, rw.Flush(), context.DeadlineExceeded)

	report := stats.GetReport()
	require.Len(t, report.SubscriptionObservations, 2)
	require.Equal(t, 1, logs.Len())
	fields := logs.All()[0].ContextMap()
	require.Equal(t, "websocket", fields["transport"])
	require.Equal(t, "subscription-1", fields["subscription_id"])
	require.Equal(t, uint64(1), fields["delivery_sequence"])
	require.Equal(t, "write", fields["failure_stage"])
	require.Equal(t, "timeout", fields["failure_reason"])
}

func TestWebsocketDisconnectReasonUsesOriginalError(t *testing.T) {
	initiator, reason := websocketDisconnectReason(context.DeadlineExceeded, wsproto.CloseKindNormal)
	require.Equal(t, "network", initiator)
	require.Equal(t, "timeout", reason)

	initiator, reason = websocketDisconnectReason(errClientTerminatedConnection, wsproto.CloseKindNormal)
	require.Equal(t, "client", initiator)
	require.Equal(t, "client_closed", reason)

	initiator, reason = websocketDisconnectReason(&wsproto.CloseError{
		Kind: wsproto.CloseKind{Code: ws.StatusProtocolError, Reason: "bad frame"},
	}, wsproto.CloseKindNormal)
	require.Equal(t, "client", initiator)
	require.Equal(t, "protocol_error", reason)
}

func TestHttpFlushWriterMarksContextFailuresAsDeliveryErrors(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	writer := &HttpFlushWriter{ctx: ctx}

	_, err := writer.Write([]byte(`{"data":{}}`))
	stage, reason := classifySubscriptionWriteFailure(err)
	require.Equal(t, "buffer", stage)
	require.Equal(t, "context_canceled", reason)
}
