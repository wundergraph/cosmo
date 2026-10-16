package datasource

import (
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	streamsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/streams/v1"
)

func kafkaCursor(topics map[string]*streamsv1.KafkaPartitionPositions) *streamsv1.Cursor {
	return &streamsv1.Cursor{
		ProviderId: "my-kafka",
		IssuedAt:   1760000000000,
		Position: &streamsv1.Cursor_Kafka{
			Kafka: &streamsv1.KafkaCursorPosition{Topics: topics},
		},
	}
}

func TestCursor_RoundTrip(t *testing.T) {
	t.Parallel()

	cursor := kafkaCursor(map[string]*streamsv1.KafkaPartitionPositions{
		"orders": {Partitions: map[int32]*streamsv1.KafkaPartitionOffset{
			0: {Epoch: 1, Offset: 42},
			1: {Epoch: -1, Offset: 0},
		}},
		"employees": {Partitions: map[int32]*streamsv1.KafkaPartitionOffset{
			2: {Epoch: 5, Offset: 13},
		}},
	})

	data, err := MarshalCursor(cursor)
	require.NoError(t, err)

	decoded, err := UnmarshalCursor(data)
	require.NoError(t, err)
	require.True(t, proto.Equal(cursor, decoded), "decoded cursor differs: %v", decoded)
}

func TestMarshalCursor_RejectsMissingPosition(t *testing.T) {
	t.Parallel()

	_, err := MarshalCursor(&streamsv1.Cursor{ProviderId: "my-kafka", IssuedAt: 1})
	require.ErrorIs(t, err, errCursorPositionMissing)

	_, err = MarshalCursor(nil)
	require.ErrorIs(t, err, errCursorPositionMissing)
}

func TestUnmarshalCursor_Errors(t *testing.T) {
	t.Parallel()

	withoutPosition, err := proto.Marshal(&streamsv1.Cursor{ProviderId: "my-kafka", IssuedAt: 1})
	require.NoError(t, err)

	tests := []struct {
		name    string
		data    []byte
		wantErr string
	}{
		{
			name:    "empty",
			data:    nil,
			wantErr: errCursorPositionMissing.Error(),
		},
		{
			name:    "without position",
			data:    withoutPosition,
			wantErr: errCursorPositionMissing.Error(),
		},
		{
			name:    "unknown position type",
			data:    append(withoutPosition, 0x9a, 0x06, 0x00), // field 99 stands in for the position of a provider type this router does not know
			wantErr: errCursorPositionMissing.Error(),
		},
		{
			name:    "malformed",
			data:    []byte{0x0a, 0x05, 'a'},
			wantErr: "unmarshaling cursor",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			c, err := UnmarshalCursor(tt.data)
			require.ErrorContains(t, err, tt.wantErr)
			require.Nil(t, c)
		})
	}
}
