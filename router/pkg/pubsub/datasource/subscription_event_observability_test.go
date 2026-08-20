package datasource

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

type metadataTestEvent struct {
	data     []byte
	metadata EventMetadata
}

func (e *metadataTestEvent) GetData() []byte                    { return e.data }
func (e *metadataTestEvent) Clone() MutableStreamEvent          { return nil }
func (e *metadataTestEvent) StreamEventMetadata() EventMetadata { return e.metadata }

type enrichedUpdaterRecorder struct {
	events []resolve.SubscriptionEvent
}

func (u *enrichedUpdaterRecorder) Update([]byte)                                             {}
func (u *enrichedUpdaterRecorder) UpdateSubscription(resolve.SubscriptionIdentifier, []byte) {}
func (u *enrichedUpdaterRecorder) UpdateEvent(event resolve.SubscriptionEvent) {
	u.events = append(u.events, event)
}
func (u *enrichedUpdaterRecorder) UpdateSubscriptionEvent(resolve.SubscriptionIdentifier, resolve.SubscriptionEvent) {
}
func (u *enrichedUpdaterRecorder) Complete()                                        {}
func (u *enrichedUpdaterRecorder) Error([]byte)                                     {}
func (u *enrichedUpdaterRecorder) Done()                                            {}
func (u *enrichedUpdaterRecorder) CloseSubscription(resolve.SubscriptionIdentifier) {}
func (u *enrichedUpdaterRecorder) Subscriptions() map[context.Context]resolve.SubscriptionIdentifier {
	return nil
}

func TestSubscriptionEventUpdaterPreservesSourceMetadata(t *testing.T) {
	recorder := &enrichedUpdaterRecorder{}
	updater := NewSubscriptionEventUpdater(nil, Hooks{}, recorder, zap.NewNop(), nil)

	updater.Update([]StreamEvent{&metadataTestEvent{
		data: []byte(`{"id":1}`),
		metadata: EventMetadata{
			ID:         "orders/2/19",
			SourceType: "kafka",
			SourceName: "orders",
			SourceID:   "orders/2/19",
		},
	}})

	require.Equal(t, []resolve.SubscriptionEvent{{
		Data:       []byte(`{"id":1}`),
		ID:         "orders/2/19",
		SourceType: "kafka",
		SourceName: "orders",
		SourceID:   "orders/2/19",
	}}, recorder.events)
}
