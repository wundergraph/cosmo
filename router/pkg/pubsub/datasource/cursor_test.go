package datasource

import (
	"encoding/base64"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	streamsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/streams/v1"
)

func kafkaCursor(topics map[string]*streamsv1.KafkaPartitionPositions) *streamsv1.Cursor {
	return &streamsv1.Cursor{
		ProviderId:    "my-kafka",
		IssuedAt:      1760000000000,
		ClientBinding: make([]byte, cursorClientBindingSize),
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

func TestMarshalCursor_RejectsInvalidClientBinding(t *testing.T) {
	t.Parallel()

	cursor := kafkaCursor(nil)

	cursor.ClientBinding = nil
	_, err := MarshalCursor(cursor)
	require.ErrorIs(t, err, errCursorClientBindingMissing)

	cursor.ClientBinding = make([]byte, cursorClientBindingSize+1)
	_, err = MarshalCursor(cursor)
	require.ErrorIs(t, err, errCursorClientBindingMissing)
}

func TestUnmarshalCursor_Errors(t *testing.T) {
	t.Parallel()

	withoutPosition, err := proto.Marshal(&streamsv1.Cursor{ProviderId: "my-kafka", IssuedAt: 1})
	require.NoError(t, err)

	withoutBinding := kafkaCursor(nil)
	withoutBinding.ClientBinding = nil
	withoutBindingData, err := proto.Marshal(withoutBinding)
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
			name:    "without client binding",
			data:    withoutBindingData,
			wantErr: errCursorClientBindingMissing.Error(),
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

var (
	testCursorSecret1 = []byte("cursor-secret-one-0123456789abcdef")
	testCursorSecret2 = []byte("cursor-secret-two-0123456789abcdef")
	testRequestData   = []byte("subscription { employeeUpdated { id } }")
	testIdentity      = ClientIdentity{
		Authenticated: true,
		Authenticator: "jwks",
		Issuer:        "https://issuer.example.com",
		Audience:      []string{"router", "api"},
		Subject:       "user-1",
	}
)

func newTestCursorCodec(t *testing.T, now time.Time, keys ...CursorKey) *CursorCodec {
	t.Helper()
	if len(keys) == 0 {
		keys = []CursorKey{{ID: 1, Secret: testCursorSecret1}}
	}
	codec, err := NewCursorCodec(keys)
	require.NoError(t, err)
	codec.now = func() time.Time { return now }
	return codec
}

func positionCursor() *streamsv1.Cursor {
	return &streamsv1.Cursor{
		ProviderId: "my-kafka",
		Position: &streamsv1.Cursor_Kafka{Kafka: &streamsv1.KafkaCursorPosition{
			Topics: map[string]*streamsv1.KafkaPartitionPositions{
				"employeeUpdated": {Partitions: map[int32]*streamsv1.KafkaPartitionOffset{
					0: {Epoch: 3, Offset: 42},
					1: {Epoch: 3, Offset: 7},
				}},
			},
		}},
	}
}

func requireCursorErrorCode(t *testing.T, err error, code string) {
	t.Helper()
	var guaranteeErr *DeliveryGuaranteeError
	require.ErrorAs(t, err, &guaranteeErr)
	require.Equal(t, code, guaranteeErr.Code)
}

func TestCursorCodec_RoundTrip(t *testing.T) {
	t.Parallel()

	now := time.UnixMilli(1760000000000)
	codec := newTestCursorCodec(t, now)

	for _, id := range []ClientIdentity{testIdentity, {}} {
		wire, err := codec.Issue(positionCursor(), testRequestData, id)
		require.NoError(t, err)

		cursor, err := codec.Verify(wire, testRequestData, id)
		require.NoError(t, err)
		require.Equal(t, "my-kafka", cursor.GetProviderId())
		require.Equal(t, now.UnixMilli(), cursor.GetIssuedAt())
		require.Len(t, cursor.GetClientBinding(), cursorClientBindingSize)
		require.True(t, proto.Equal(positionCursor().GetKafka(), cursor.GetKafka()))
	}
}

func TestCursorCodec_Issue_DoesNotModifyCursor(t *testing.T) {
	t.Parallel()

	codec := newTestCursorCodec(t, time.UnixMilli(1760000000000))
	position := positionCursor()

	_, err := codec.Issue(position, testRequestData, testIdentity)
	require.NoError(t, err)
	require.True(t, proto.Equal(positionCursor(), position))
}

func TestCursorCodec_Verify_ClientMismatch(t *testing.T) {
	t.Parallel()

	codec := newTestCursorCodec(t, time.UnixMilli(1760000000000))

	modified := func(fn func(id *ClientIdentity)) ClientIdentity {
		id := testIdentity
		id.Audience = slices.Clone(testIdentity.Audience)
		fn(&id)
		return id
	}

	tests := []struct {
		name     string
		issuedTo ClientIdentity
		resumeAs ClientIdentity
	}{
		{"different subject", testIdentity, modified(func(id *ClientIdentity) { id.Subject = "user-2" })},
		{"different issuer", testIdentity, modified(func(id *ClientIdentity) { id.Issuer = "https://other.example.com" })},
		{"different audience", testIdentity, modified(func(id *ClientIdentity) { id.Audience = []string{"router"} })},
		{"different authenticator", testIdentity, modified(func(id *ClientIdentity) { id.Authenticator = "other" })},
		{"anonymous cursor resumed authenticated", ClientIdentity{}, testIdentity},
		{"authenticated cursor resumed anonymously", testIdentity, ClientIdentity{}},
		{"anonymous cursor resumed by authenticated client with empty claims", ClientIdentity{}, ClientIdentity{Authenticated: true}},
		{"length prefixes prevent collisions",
			ClientIdentity{Authenticated: true, Authenticator: "auth", Subject: "0123"},
			ClientIdentity{Authenticated: true, Authenticator: "auth0", Subject: "123"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			wire, err := codec.Issue(positionCursor(), testRequestData, tt.issuedTo)
			require.NoError(t, err)

			cursor, err := codec.Verify(wire, testRequestData, tt.resumeAs)
			requireCursorErrorCode(t, err, DeliveryGuaranteeErrorCodeCursorClientMismatch)
			require.Nil(t, cursor)
		})
	}
}

func TestCursorCodec_Verify_Invalid(t *testing.T) {
	t.Parallel()

	codec := newTestCursorCodec(t, time.UnixMilli(1760000000000))
	wire, err := codec.Issue(positionCursor(), testRequestData, testIdentity)
	require.NoError(t, err)
	raw, err := base64.RawURLEncoding.DecodeString(wire)
	require.NoError(t, err)

	flipped := func(i int) string {
		b := slices.Clone(raw)
		b[i] ^= 0x01
		return base64.RawURLEncoding.EncodeToString(b)
	}

	otherCodec := newTestCursorCodec(t, time.UnixMilli(1760000000000), CursorKey{ID: 2, Secret: testCursorSecret1})
	otherKeyWire, err := otherCodec.Issue(positionCursor(), testRequestData, testIdentity)
	require.NoError(t, err)

	tests := []struct {
		name        string
		wire        string
		requestData []byte
	}{
		{"not base64", "not base64!", testRequestData},
		{"too short", base64.RawURLEncoding.EncodeToString(raw[:cursorHeaderSize+cursorTagSize-1]), testRequestData},
		{"flipped version byte", flipped(0), testRequestData},
		{"flipped payload byte", flipped(cursorHeaderSize + 1), testRequestData},
		{"flipped tag byte", flipped(len(raw) - 1), testRequestData},
		{"unknown key id", otherKeyWire, testRequestData},
		{"different request data", wire, []byte("subscription { employeeUpdated { id details { forename } } }")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			cursor, err := codec.Verify(tt.wire, tt.requestData, testIdentity)
			requireCursorErrorCode(t, err, DeliveryGuaranteeErrorCodeCursorInvalid)
			require.Nil(t, cursor)
		})
	}
}

func TestCursorCodec_KeyRotation(t *testing.T) {
	t.Parallel()

	now := time.UnixMilli(1760000000000)
	keys := []CursorKey{
		{ID: 1, Secret: testCursorSecret1},
		{ID: 2, Secret: testCursorSecret2, ExpiresAt: now.Add(time.Hour)},
	}
	codec := newTestCursorCodec(t, now, keys...)

	// Before key 2 expires it signs, as it has the highest id.
	before, err := codec.Issue(positionCursor(), testRequestData, testIdentity)
	require.NoError(t, err)
	require.Equal(t, uint8(2), wireKeyID(t, before))

	// Past its expiry key 1 takes over signing, but key 2 still verifies.
	codec.now = func() time.Time { return now.Add(2 * time.Hour) }
	after, err := codec.Issue(positionCursor(), testRequestData, testIdentity)
	require.NoError(t, err)
	require.Equal(t, uint8(1), wireKeyID(t, after))

	_, err = codec.Verify(before, testRequestData, testIdentity)
	require.NoError(t, err)

	// Removing key 2 from the keyring revokes its cursors.
	withoutKey2 := newTestCursorCodec(t, now, keys[0])
	_, err = withoutKey2.Verify(before, testRequestData, testIdentity)
	requireCursorErrorCode(t, err, DeliveryGuaranteeErrorCodeCursorInvalid)
	_, err = withoutKey2.Verify(after, testRequestData, testIdentity)
	require.NoError(t, err)
}

func TestCursorCodec_Issue_NoSigningKey(t *testing.T) {
	t.Parallel()

	now := time.UnixMilli(1760000000000)
	codec := newTestCursorCodec(t, now, CursorKey{ID: 1, Secret: testCursorSecret1, ExpiresAt: now})

	_, err := codec.Issue(positionCursor(), testRequestData, testIdentity)
	require.ErrorContains(t, err, "no cursor key is valid for signing")
}

func TestCursorCodec_Issue_Deterministic(t *testing.T) {
	t.Parallel()

	codec := newTestCursorCodec(t, time.UnixMilli(1760000000000))

	first, err := codec.Issue(positionCursor(), testRequestData, testIdentity)
	require.NoError(t, err)
	for range 10 {
		next, err := codec.Issue(positionCursor(), testRequestData, testIdentity)
		require.NoError(t, err)
		require.Equal(t, first, next)
	}
}

func TestCursorCodec_AudienceOrderDoesNotMatter(t *testing.T) {
	t.Parallel()

	codec := newTestCursorCodec(t, time.UnixMilli(1760000000000))

	wire, err := codec.Issue(positionCursor(), testRequestData, testIdentity)
	require.NoError(t, err)

	reordered := testIdentity
	reordered.Audience = []string{"api", "router"}
	_, err = codec.Verify(wire, testRequestData, reordered)
	require.NoError(t, err)
}

func TestNewCursorCodec_Errors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		keys    []CursorKey
		wantErr string
	}{
		{"empty keyring", nil, "cursor keyring is empty"},
		{"short secret", []CursorKey{{ID: 1, Secret: []byte("too short")}}, "secret must be at least 32 bytes"},
		{"duplicate id", []CursorKey{{ID: 1, Secret: testCursorSecret1}, {ID: 1, Secret: testCursorSecret2}}, "duplicate id"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			codec, err := NewCursorCodec(tt.keys)
			require.ErrorContains(t, err, tt.wantErr)
			require.Nil(t, codec)
		})
	}
}

func TestCursorRequestData(t *testing.T) {
	t.Parallel()

	conf := func(topics ...string) SubscriptionEventConfiguration {
		return &cursorTestConfig{guaranteeTestConfig: guaranteeTestConfig{Mode: DeliveryGuaranteeModeCursor}, topics: topics}
	}

	ab, err := cursorRequestData(conf("a", "b"))
	require.NoError(t, err)
	ba, err := cursorRequestData(conf("b", "a"))
	require.NoError(t, err)
	require.Equal(t, ab, ba, "topic order must not matter")

	// Without length prefixes these two would serialize to the same bytes.
	joined, err := cursorRequestData(conf("ab"))
	require.NoError(t, err)
	require.NotEqual(t, ab, joined)

	_, err = cursorRequestData(&guaranteeTestConfig{})
	require.ErrorContains(t, err, "does not support cursors")
}

func wireKeyID(t *testing.T, wire string) uint8 {
	t.Helper()
	raw, err := base64.RawURLEncoding.DecodeString(wire)
	require.NoError(t, err)
	return raw[1]
}
