package core

import (
	"context"
	"errors"
	"testing"

	"github.com/gobwas/ws"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/wsproto"
	"github.com/wundergraph/cosmo/router/pkg/statistics"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	zapobserver "go.uber.org/zap/zaptest/observer"
)

func TestObserveSubscriptionDeliveryRecordsFailureWithoutPayload(t *testing.T) {
	logCore, logs := zapobserver.New(zapcore.DebugLevel)
	stats := statistics.NewEngineStats(t.Context(), zap.NewNop(), false)
	telemetry := subscriptionTelemetryContext{
		transport:     subscriptionTransportSSE,
		requestID:     "request-1",
		operationName: "ProductUpdated",
		clientName:    "storefront",
		clientVersion: "1.2.3",
	}

	observeSubscriptionDelivery(stats, zap.New(logCore), telemetry, resolve.SubscriptionDeliveryReport{
		TriggerID:      3,
		ConnectionID:   5,
		SubscriptionID: 7,
		EventID:        "orders/2/19",
		EventHash:      "abc123",
		EventBytes:     17,
		SourceType:     "kafka",
		SourceName:     "orders",
		SourceID:       "orders/2/19",
		Err:            wrapSubscriptionWriteError("flush", context.DeadlineExceeded),
	})

	report := stats.GetReport()
	require.Len(t, report.SubscriptionObservations, 2)
	require.Equal(t, 1, logs.Len())
	fields := logs.All()[0].ContextMap()
	require.Equal(t, "orders/2/19", fields["event_id"])
	require.Equal(t, "abc123", fields["event_hash"])
	require.Equal(t, "flush", fields["failure_stage"])
	require.Equal(t, "timeout", fields["failure_reason"])
	require.NotContains(t, fields, "payload")
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

func TestWebsocketDisconnectReasonUsesOriginalError(t *testing.T) {
	initiator, reason := websocketDisconnectReason(context.DeadlineExceeded, wsproto.CloseKindNormal)
	require.Equal(t, "network", initiator)
	require.Equal(t, "read_timeout", reason)

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
	var deliveryErr resolve.SubscriptionDeliveryError
	require.ErrorAs(t, err, &deliveryErr)
	stage, reason := classifySubscriptionWriteFailure(err)
	require.Equal(t, "buffer", stage)
	require.Equal(t, "context_canceled", reason)
}
