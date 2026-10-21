package datasource

import (
	"context"
	"testing"

	"github.com/cespare/xxhash/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

type guaranteeTestConfig struct {
	Mode DeliveryGuaranteeMode `json:"deliveryGuaranteeMode"`
}

func (c *guaranteeTestConfig) ProviderID() string                           { return "p" }
func (c *guaranteeTestConfig) ProviderType() ProviderType                   { return ProviderTypeKafka }
func (c *guaranteeTestConfig) RootFieldName() string                        { return "f" }
func (c *guaranteeTestConfig) DeliveryGuaranteeMode() DeliveryGuaranteeMode { return c.Mode }

func newGuaranteeDataSource() *PubSubSubscriptionDataSource[*guaranteeTestConfig] {
	return NewPubSubSubscriptionDataSource[*guaranteeTestConfig](nil, func(input []byte, xxh *xxhash.Digest) error {
		_, err := xxh.Write([]byte("same"))
		return err
	}, nil, nil)
}

const (
	cursorInput      = `{"deliveryGuaranteeMode":"cursor","body":{"extensions":{"cosmoDeliveryGuarantee":"cursor"}}}`
	atMostOnceInput  = `{"deliveryGuaranteeMode":"cursor"}`
	unsupportedInput = `{"deliveryGuaranteeMode":"off","body":{"extensions":{"cosmoDeliveryGuarantee":"cursor"}}}`
	invalidInput     = `{"deliveryGuaranteeMode":"cursor","body":{"extensions":{"cosmoDeliveryGuarantee":42}}}`
)

func TestPubSubSubscriptionDataSource_ValidateTriggerInput(t *testing.T) {
	// Cursor and at-most-once requests are accepted. A cursor request on a field with
	// guarantees disabled is rejected as unsupported, a malformed value as invalid.
	ds := newGuaranteeDataSource()

	assert.NoError(t, ds.ValidateTriggerInput(&resolve.Context{}, []byte(cursorInput)))
	assert.NoError(t, ds.ValidateTriggerInput(&resolve.Context{}, []byte(atMostOnceInput)))

	var gErr *DeliveryGuaranteeError
	require.ErrorAs(t, ds.ValidateTriggerInput(&resolve.Context{}, []byte(unsupportedInput)), &gErr)
	assert.Equal(t, DeliveryGuaranteeErrorCodeUnsupported, gErr.Code)

	require.ErrorAs(t, ds.ValidateTriggerInput(&resolve.Context{}, []byte(invalidInput)), &gErr)
	assert.Equal(t, DeliveryGuaranteeErrorCodeInvalid, gErr.Code)
}

func TestPubSubSubscriptionDataSource_HashTriggerInput_IncludesGuarantee(t *testing.T) {
	// Cursor and at-most-once subscribers must not share a trigger, while subscribers with
	// the same guarantee still do. The provider hash is constant, so any difference must
	// come from the delivery guarantee.
	ds := newGuaranteeDataSource()

	hash := func(input string) uint64 {
		xxh := xxhash.New()
		require.NoError(t, ds.HashTriggerInput([]byte(input), xxh))
		return xxh.Sum64()
	}

	assert.NotEqual(t, hash(cursorInput), hash(atMostOnceInput))
	assert.Equal(t, hash(cursorInput), hash(cursorInput))
}

func TestPubSubSubscriptionDataSource_Start_PassesGuaranteeToAdapter(t *testing.T) {
	// The guarantee requested by the client is handed to the adapter, defaulting to
	// at-most-once when the client requests none. A rejected request never reaches it.
	tests := []struct {
		name     string
		input    string
		expected DeliveryGuarantee
	}{
		{"cursor", cursorInput, DeliveryGuaranteeCursor},
		{"at-most-once default", atMostOnceInput, DeliveryGuaranteeAtMostOnce},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adapter := NewMockProvider(t)
			adapter.EXPECT().
				Subscribe(mock.Anything, mock.Anything, tt.expected, mock.Anything).
				Return(nil).Once()
			ds := NewPubSubSubscriptionDataSource[*guaranteeTestConfig](adapter, nil, zap.NewNop(), nil)

			require.NoError(t, ds.Start(resolve.NewContext(context.Background()), nil, []byte(tt.input), nil))
		})
	}

	t.Run("unsupported request is rejected", func(t *testing.T) {
		adapter := NewMockProvider(t)
		ds := NewPubSubSubscriptionDataSource[*guaranteeTestConfig](adapter, nil, zap.NewNop(), nil)

		err := ds.Start(resolve.NewContext(context.Background()), nil, []byte(unsupportedInput), nil)
		var gErr *DeliveryGuaranteeError
		require.ErrorAs(t, err, &gErr)
	})
}
