package datasource

import (
	"crypto/hkdf"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	streamsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/streams/v1"
	"google.golang.org/protobuf/proto"
)

func testSecret(b byte) []byte {
	secret := make([]byte, cursorMinSecretSize)
	for i := range secret {
		secret[i] = b
	}
	return secret
}

func testCursor() *streamsv1.Cursor {
	return &streamsv1.Cursor{
		ProviderId: "my-kafka",
		Position: &streamsv1.Cursor_Kafka{
			Kafka: &streamsv1.KafkaCursorPosition{
				Topics: map[string]*streamsv1.KafkaPartitionPositions{
					"employees": {
						Partitions: map[int32]*streamsv1.KafkaPartitionOffset{
							0: {Epoch: 3, Offset: 42},
							1: {Epoch: -1, Offset: 7},
						},
					},
				},
			},
		},
	}
}

var (
	testRequestData = []byte("request-data")
	testIdentity    = ClientIdentity{Authenticated: true, Authenticator: "jwt", Issuer: "iss", Subject: "alice"}
)

func mustCodec(t *testing.T, window time.Duration, keys ...CursorKey) *CursorCodec {
	t.Helper()
	codec, err := NewCursorCodec(keys, window)
	require.NoError(t, err)
	return codec
}

func mustIssue(t *testing.T, codec *CursorCodec) string {
	t.Helper()
	wire, err := codec.Issue(testCursor(), testRequestData, testIdentity)
	require.NoError(t, err)
	return wire
}

// signWire builds the wire format of an arbitrary cursor with the given key of the codec,
// which allows crafting cursors Issue() would never produce, e.g. one issued in the past.
func signWire(t *testing.T, codec *CursorCodec, keyID uint8, cur *streamsv1.Cursor) string {
	t.Helper()
	key, ok := codec.key(keyID)
	require.True(t, ok)
	cur.ClientBinding = clientBinding(key, testIdentity)
	payload, err := MarshalCursor(cur)
	require.NoError(t, err)

	return signRaw(t, codec, keyID, cursorVersion, payload)
}

// signRaw wraps an arbitrary payload in a correctly tagged wire format,
// which allows crafting cursors that MarshalCursor would refuse to produce.
func signRaw(t *testing.T, codec *CursorCodec, keyID, version uint8, payload []byte) string {
	t.Helper()
	key, ok := codec.key(keyID)
	require.True(t, ok)

	wire := append([]byte{version, key.id}, payload...)
	wire = append(wire, cursorTag(key, version, payload, testRequestData)...)
	return base64.RawURLEncoding.EncodeToString(wire)
}

func requireDeliveryGuaranteeError(t *testing.T, err error, code string) {
	t.Helper()
	var dgErr *DeliveryGuaranteeError
	require.ErrorAs(t, err, &dgErr)
	assert.Equal(t, code, dgErr.Code)
}

func TestCursorIssuedAt(t *testing.T) {
	t.Parallel()

	t.Run("IssuedAt is actually the time of issuing", func(t *testing.T) {
		t.Parallel()
		codec := mustCodec(t, 0, CursorKey{ID: 1, Secret: testSecret(1)})

		before := time.Now().UnixMilli()
		wire := mustIssue(t, codec)
		after := time.Now().UnixMilli()

		cur, err := codec.Verify(wire, testRequestData, testIdentity)
		require.NoError(t, err)
		assert.GreaterOrEqual(t, cur.GetIssuedAt(), before)
		assert.LessOrEqual(t, cur.GetIssuedAt(), after)
	})

	t.Run("Issue() sets its own time to IssuedAt on the passed cursor", func(t *testing.T) {
		t.Parallel()
		codec := mustCodec(t, 0, CursorKey{ID: 1, Secret: testSecret(1)})

		in := testCursor()
		in.IssuedAt = 1
		before := time.Now().UnixMilli()
		wire, err := codec.Issue(in, testRequestData, testIdentity)
		require.NoError(t, err)

		cur, err := codec.Verify(wire, testRequestData, testIdentity)
		require.NoError(t, err)
		assert.GreaterOrEqual(t, cur.GetIssuedAt(), before)
		assert.Equal(t, int64(1), in.GetIssuedAt(), "the given cursor must not be modified")
	})

	t.Run("cursor within the resume window is accepted", func(t *testing.T) {
		t.Parallel()
		codec := mustCodec(t, time.Hour, CursorKey{ID: 1, Secret: testSecret(1)})

		cur := testCursor()
		cur.IssuedAt = time.Now().Add(-time.Minute).UnixMilli()
		_, err := codec.Verify(signWire(t, codec, 1, cur), testRequestData, testIdentity)
		require.NoError(t, err)
	})

	t.Run("cursor older than the resume window is rejected", func(t *testing.T) {
		t.Parallel()
		codec := mustCodec(t, time.Hour, CursorKey{ID: 1, Secret: testSecret(1)})

		cur := testCursor()
		cur.IssuedAt = time.Now().Add(-2 * time.Hour).UnixMilli()
		_, err := codec.Verify(signWire(t, codec, 1, cur), testRequestData, testIdentity)
		requireDeliveryGuaranteeError(t, err, DeliveryGuaranteeErrorCodeCursorExpired)
	})

	t.Run("old cursor is accepted without a resume window", func(t *testing.T) {
		t.Parallel()
		codec := mustCodec(t, 0, CursorKey{ID: 1, Secret: testSecret(1)})

		cur := testCursor()
		cur.IssuedAt = time.Now().Add(-10 * 365 * 24 * time.Hour).UnixMilli()
		_, err := codec.Verify(signWire(t, codec, 1, cur), testRequestData, testIdentity)
		require.NoError(t, err)
	})
}

func TestCursorWireFormat(t *testing.T) {
	t.Parallel()

	secret := testSecret(7)
	codec := mustCodec(t, 0, CursorKey{ID: 5, Secret: secret})

	t.Run("layout is version, key id, payload, tag", func(t *testing.T) {
		t.Parallel()
		// expected wire format: version (1 byte) | keyID (1 byte) | payload (n bytes) | tag (16 bytes)

		wire := mustIssue(t, codec)

		raw, err := base64.RawURLEncoding.DecodeString(wire)
		require.NoError(t, err, "wire format must be unpadded url-safe base64")
		// 2 header bytes + 16 tag bytes + a non-empty payload
		require.Greater(t, len(raw), 2+16)

		assert.Equal(t, byte(0x01), raw[0], "version")
		assert.Equal(t, byte(5), raw[1], "key id")

		payload := raw[2 : len(raw)-16]
		cur := &streamsv1.Cursor{}
		require.NoError(t, proto.Unmarshal(payload, cur))
		assert.Equal(t, "my-kafka", cur.GetProviderId())
		assert.Len(t, cur.GetClientBinding(), 16)
		assert.Equal(t, int64(42), cur.GetKafka().GetTopics()["employees"].GetPartitions()[0].GetOffset())
		assert.Equal(t, int32(-1), cur.GetKafka().GetTopics()["employees"].GetPartitions()[1].GetEpoch())
	})

	t.Run("tag follows the specification", func(t *testing.T) {
		t.Parallel()

		// The tag is the first 16 bytes of an HMAC-SHA256 keyed with
		// HKDF-SHA256(secret, no salt, info "cosmo/cursor/tag/v1", 32 bytes).
		// The MAC input is, in order:
		//
		//	"cosmo/cursor/v1" (domain, not length-prefixed)
		//	version (1 byte) | keyID (1 byte)
		//	uvarint(len(payload)) | payload
		//	uvarint(len(requestData)) | requestData
		//
		// The payload includes the client binding, so the tag covers the client as well.

		raw, err := base64.RawURLEncoding.DecodeString(mustIssue(t, codec))
		require.NoError(t, err)
		payload := raw[2 : len(raw)-16]

		// Recompute the tag from the primitives, independent of cursorTag.
		tagKey, err := hkdf.Key(sha256.New, secret, nil, "cosmo/cursor/tag/v1", sha256.Size)
		require.NoError(t, err)
		mac := hmac.New(sha256.New, tagKey)
		mac.Write([]byte("cosmo/cursor/v1"))
		mac.Write([]byte{0x01, 5})
		mac.Write(append(binary.AppendUvarint(nil, uint64(len(payload))), payload...))
		mac.Write(append([]byte{byte(len(testRequestData))}, testRequestData...))

		assert.Equal(t, mac.Sum(nil)[:16], raw[len(raw)-16:])
	})

	t.Run("client binding follows the specification", func(t *testing.T) {
		t.Parallel()

		// The client binding is the first 16 bytes of an HMAC-SHA256 keyed with
		// HKDF-SHA256(secret, no salt, info "cosmo/cursor/client/v1", 32 bytes).
		// The MAC input is the canonical client identity:
		//
		//	anonymous (no JWT): 0x01 (version) | 0x00 (kind)
		//	authenticated:      0x01 (version) | 0x01 (kind)
		//	                    uvarint(len(authenticator)) | authenticator
		//	                    uvarint(len(issuer)) | issuer
		//	                    uvarint(number of audiences) | for each audience, sorted byte-wise:
		//	                        uvarint(len(audience)) | audience
		//	                    uvarint(len(subject)) | subject
		//
		// The kind byte keeps an anonymous client apart from an authenticated one with empty claims.
		// The length prefixes keep field boundaries unambiguous.

		raw, err := base64.RawURLEncoding.DecodeString(mustIssue(t, codec))
		require.NoError(t, err)
		cur := &streamsv1.Cursor{}
		require.NoError(t, proto.Unmarshal(raw[2:len(raw)-16], cur))

		clientKey, err := hkdf.Key(sha256.New, secret, nil, "cosmo/cursor/client/v1", sha256.Size)
		require.NoError(t, err)
		mac := hmac.New(sha256.New, clientKey)
		// version, authenticated, authenticator, issuer, no audiences, subject
		mac.Write([]byte{0x01, 0x01})
		mac.Write(append([]byte{3}, "jwt"...))
		mac.Write(append([]byte{3}, "iss"...))
		mac.Write([]byte{0})
		mac.Write(append([]byte{5}, "alice"...))

		assert.Equal(t, mac.Sum(nil)[:16], cur.GetClientBinding())
	})

	t.Run("verifying is stable", func(t *testing.T) {
		t.Parallel()
		wire := mustIssue(t, codec)
		for range 3 {
			_, err := codec.Verify(wire, testRequestData, testIdentity)
			require.NoError(t, err)
		}
	})

	t.Run("marshaling is deterministic", func(t *testing.T) {
		t.Parallel()
		cur := testCursor()
		cur.ClientBinding = make([]byte, cursorClientBindingSize)
		first, err := MarshalCursor(cur)
		require.NoError(t, err)
		for range 20 {
			again, err := MarshalCursor(cur)
			require.NoError(t, err)
			require.Equal(t, first, again)
		}
	})

	t.Run("marshal rejects incomplete cursors", func(t *testing.T) {
		t.Parallel()
		_, err := MarshalCursor(&streamsv1.Cursor{ClientBinding: make([]byte, cursorClientBindingSize)})
		assert.ErrorIs(t, err, errCursorPositionMissing)

		cur := testCursor()
		cur.ClientBinding = []byte{1, 2, 3}
		_, err = MarshalCursor(cur)
		assert.ErrorIs(t, err, errCursorClientBindingMissing)
	})

	t.Run("any modified byte is rejected", func(t *testing.T) {
		t.Parallel()
		raw, err := base64.RawURLEncoding.DecodeString(mustIssue(t, codec))
		require.NoError(t, err)

		for i := range raw {
			tampered := append([]byte(nil), raw...)
			tampered[i] ^= 0x01
			_, err := codec.Verify(base64.RawURLEncoding.EncodeToString(tampered), testRequestData, testIdentity)
			requireDeliveryGuaranteeError(t, err, DeliveryGuaranteeErrorCodeCursorInvalid)
		}
	})

	t.Run("malformed input is rejected", func(t *testing.T) {
		t.Parallel()
		raw, err := base64.RawURLEncoding.DecodeString(mustIssue(t, codec))
		require.NoError(t, err)

		for _, wire := range []string{
			"",
			"!!!",
			base64.RawURLEncoding.EncodeToString(raw[:cursorHeaderSize+cursorTagSize-1]),
			base64.RawURLEncoding.EncodeToString(raw[:len(raw)-1]),
			base64.RawURLEncoding.EncodeToString(raw) + "=",
		} {
			_, err := codec.Verify(wire, testRequestData, testIdentity)
			requireDeliveryGuaranteeError(t, err, DeliveryGuaranteeErrorCodeCursorInvalid)
		}
	})

	t.Run("different request data is rejected", func(t *testing.T) {
		t.Parallel()
		_, err := codec.Verify(mustIssue(t, codec), []byte("other"), testIdentity)
		requireDeliveryGuaranteeError(t, err, DeliveryGuaranteeErrorCodeCursorInvalid)
	})

	t.Run("different client is rejected", func(t *testing.T) {
		t.Parallel()
		wire := mustIssue(t, codec)

		other := testIdentity
		other.Subject = "bob"
		_, err := codec.Verify(wire, testRequestData, other)
		requireDeliveryGuaranteeError(t, err, DeliveryGuaranteeErrorCodeCursorClientMismatch)

		_, err = codec.Verify(wire, testRequestData, ClientIdentity{})
		requireDeliveryGuaranteeError(t, err, DeliveryGuaranteeErrorCodeCursorClientMismatch)
	})

	t.Run("audience order does not matter", func(t *testing.T) {
		t.Parallel()
		a := ClientIdentity{Authenticated: true, Audience: []string{"x", "y"}}
		b := ClientIdentity{Authenticated: true, Audience: []string{"y", "x"}}

		wire, err := codec.Issue(testCursor(), testRequestData, a)
		require.NoError(t, err)
		_, err = codec.Verify(wire, testRequestData, b)
		require.NoError(t, err)
	})
}

func TestCursorKeyRotation(t *testing.T) {
	t.Parallel()

	key1 := CursorKey{ID: 1, Secret: testSecret(1)}
	key2 := CursorKey{ID: 2, Secret: testSecret(2)}

	keyIDOf := func(t *testing.T, wire string) uint8 {
		t.Helper()
		raw, err := base64.RawURLEncoding.DecodeString(wire)
		require.NoError(t, err)
		return raw[1]
	}

	t.Run("signs with the highest key id regardless of config order", func(t *testing.T) {
		t.Parallel()
		for _, keys := range [][]CursorKey{{key1, key2}, {key2, key1}} {
			assert.Equal(t, uint8(2), keyIDOf(t, mustIssue(t, mustCodec(t, 0, keys...))))
		}
	})

	t.Run("cursors of the old key still verify after adding a new key", func(t *testing.T) {
		t.Parallel()
		old := mustIssue(t, mustCodec(t, 0, key1))
		rotated := mustCodec(t, 0, key1, key2)

		_, err := rotated.Verify(old, testRequestData, testIdentity)
		require.NoError(t, err)
		assert.Equal(t, uint8(2), keyIDOf(t, mustIssue(t, rotated)))
	})

	t.Run("cursors of the new key verify with the new key", func(t *testing.T) {
		t.Parallel()
		rotated := mustCodec(t, 0, key1, key2)
		_, err := rotated.Verify(mustIssue(t, rotated), testRequestData, testIdentity)
		require.NoError(t, err)
	})

	t.Run("cursors of a removed key are rejected", func(t *testing.T) {
		t.Parallel()
		old := mustIssue(t, mustCodec(t, 0, key1))
		_, err := mustCodec(t, 0, key2).Verify(old, testRequestData, testIdentity)
		requireDeliveryGuaranteeError(t, err, DeliveryGuaranteeErrorCodeCursorInvalid)
	})

	t.Run("same key id with a different secret is rejected", func(t *testing.T) {
		t.Parallel()
		wire := mustIssue(t, mustCodec(t, 0, key1))
		_, err := mustCodec(t, 0, CursorKey{ID: 1, Secret: testSecret(9)}).Verify(wire, testRequestData, testIdentity)
		requireDeliveryGuaranteeError(t, err, DeliveryGuaranteeErrorCodeCursorInvalid)
	})

	t.Run("expired key stops signing but keeps verifying", func(t *testing.T) {
		t.Parallel()
		expiring := CursorKey{ID: 2, Secret: key2.Secret, ExpiresAt: time.Now().Add(time.Hour)}
		codec := mustCodec(t, 0, key1, expiring)
		wire := mustIssue(t, codec)
		assert.Equal(t, uint8(2), keyIDOf(t, wire))

		expired := CursorKey{ID: 2, Secret: key2.Secret, ExpiresAt: time.Now().Add(-time.Hour)}
		codec = mustCodec(t, 0, key1, expired)
		assert.Equal(t, uint8(1), keyIDOf(t, mustIssue(t, codec)), "falls back to the next key")

		_, err := codec.Verify(wire, testRequestData, testIdentity)
		require.NoError(t, err, "cursors signed by the expired key stay valid")
	})

	t.Run("fails to issue when every key is expired", func(t *testing.T) {
		t.Parallel()
		past := time.Now().Add(-time.Hour)
		codec := mustCodec(t, 0,
			CursorKey{ID: 1, Secret: key1.Secret, ExpiresAt: past},
			CursorKey{ID: 2, Secret: key2.Secret, ExpiresAt: past},
		)
		_, err := codec.Issue(testCursor(), testRequestData, testIdentity)
		assert.Error(t, err)
	})

	t.Run("invalid keyrings are rejected", func(t *testing.T) {
		t.Parallel()
		_, err := NewCursorCodec(nil, 0)
		assert.Error(t, err, "empty keyring")

		_, err = NewCursorCodec([]CursorKey{{ID: 1, Secret: make([]byte, cursorMinSecretSize-1)}}, 0)
		assert.Error(t, err, "short secret")

		_, err = NewCursorCodec([]CursorKey{key1, {ID: 1, Secret: key2.Secret}}, 0)
		assert.Error(t, err, "duplicate id")
	})
}

type testCursorSubscriptionConfig struct {
	providerType ProviderType
	providerID   string
	topics       []string
}

func (c testCursorSubscriptionConfig) ProviderID() string         { return c.providerID }
func (c testCursorSubscriptionConfig) ProviderType() ProviderType { return c.providerType }
func (c testCursorSubscriptionConfig) RootFieldName() string      { return "field" }
func (c testCursorSubscriptionConfig) CursorTopics() []string     { return c.topics }
func (c testCursorSubscriptionConfig) DeliveryGuaranteeMode() DeliveryGuaranteeMode {
	return ""
}

func TestCursorRequestData(t *testing.T) {
	t.Parallel()

	// expected is the specification: uvarint-length-prefixed provider type and provider id,
	// uvarint topic count, then every topic length-prefixed in sorted order.
	lp := func(s string) []byte { return append([]byte{byte(len(s))}, s...) }
	join := func(parts ...[]byte) []byte { return slices.Concat(parts...) }

	t.Run("follows the specification", func(t *testing.T) {
		t.Parallel()
		got, err := cursorRequestData(testCursorSubscriptionConfig{
			providerType: "kafka", providerID: "my-kafka", topics: []string{"b", "a"},
		})
		require.NoError(t, err)
		assert.Equal(t, join(lp("kafka"), lp("my-kafka"), []byte{2}, lp("a"), lp("b")), got)
	})

	t.Run("topic order does not matter and the config is not modified", func(t *testing.T) {
		t.Parallel()
		topics := []string{"b", "a", "c"}
		a, err := cursorRequestData(testCursorSubscriptionConfig{providerType: "kafka", providerID: "p", topics: topics})
		require.NoError(t, err)
		b, err := cursorRequestData(testCursorSubscriptionConfig{providerType: "kafka", providerID: "p", topics: []string{"c", "b", "a"}})
		require.NoError(t, err)
		assert.Equal(t, a, b)
		assert.Equal(t, []string{"b", "a", "c"}, topics)
	})

	t.Run("differs per subscription", func(t *testing.T) {
		t.Parallel()
		base := testCursorSubscriptionConfig{providerType: "kafka", providerID: "p", topics: []string{"a", "b"}}
		baseData, err := cursorRequestData(base)
		require.NoError(t, err)

		for name, conf := range map[string]testCursorSubscriptionConfig{
			"provider type":    {providerType: "nats", providerID: "p", topics: []string{"a", "b"}},
			"provider id":      {providerType: "kafka", providerID: "q", topics: []string{"a", "b"}},
			"extra topic":      {providerType: "kafka", providerID: "p", topics: []string{"a", "b", "c"}},
			"fewer topics":     {providerType: "kafka", providerID: "p", topics: []string{"a"}},
			"different topic":  {providerType: "kafka", providerID: "p", topics: []string{"a", "c"}},
			"topics merged":    {providerType: "kafka", providerID: "p", topics: []string{"ab"}},
			"no topics":        {providerType: "kafka", providerID: "p"},
			"id moved to type": {providerType: "kafkap", providerID: "", topics: []string{"a", "b"}},
		} {
			data, err := cursorRequestData(conf)
			require.NoError(t, err, name)
			assert.NotEqual(t, baseData, data, name)
		}
	})

	t.Run("topic boundaries are unambiguous", func(t *testing.T) {
		t.Parallel()
		a, err := cursorRequestData(testCursorSubscriptionConfig{providerType: "kafka", providerID: "p", topics: []string{"a", "bc"}})
		require.NoError(t, err)
		b, err := cursorRequestData(testCursorSubscriptionConfig{providerType: "kafka", providerID: "p", topics: []string{"ab", "c"}})
		require.NoError(t, err)
		assert.NotEqual(t, a, b)
	})

	t.Run("provider without cursor support is rejected", func(t *testing.T) {
		t.Parallel()
		_, err := cursorRequestData(subscriptionConfigWithoutCursors{})
		assert.Error(t, err)
	})
}

// subscriptionConfigWithoutCursors implements SubscriptionEventConfiguration only.
type subscriptionConfigWithoutCursors struct{}

func (subscriptionConfigWithoutCursors) ProviderID() string         { return "p" }
func (subscriptionConfigWithoutCursors) ProviderType() ProviderType { return "other" }
func (subscriptionConfigWithoutCursors) RootFieldName() string      { return "field" }
func (subscriptionConfigWithoutCursors) DeliveryGuaranteeMode() DeliveryGuaranteeMode {
	return ""
}

func TestCursorClientBinding(t *testing.T) {
	t.Parallel()

	secret := testSecret(7)
	codec := mustCodec(t, 0, CursorKey{ID: 5, Secret: secret})

	lp := func(s string) []byte { return append([]byte{byte(len(s))}, s...) }

	// expectedBinding is the specification: the first 16 bytes of an HMAC-SHA256 over the
	// canonical identity, keyed with HKDF-SHA256(secret, no salt, "cosmo/cursor/client/v1").
	expectedBinding := func(t *testing.T, canonical []byte) []byte {
		t.Helper()
		clientKey, err := hkdf.Key(sha256.New, secret, nil, "cosmo/cursor/client/v1", sha256.Size)
		require.NoError(t, err)
		mac := hmac.New(sha256.New, clientKey)
		mac.Write(canonical)
		return mac.Sum(nil)[:16]
	}

	// issuedBinding returns the client binding inside a cursor issued to the identity.
	issuedBinding := func(t *testing.T, id ClientIdentity) []byte {
		t.Helper()
		wire, err := codec.Issue(testCursor(), testRequestData, id)
		require.NoError(t, err)
		raw, err := base64.RawURLEncoding.DecodeString(wire)
		require.NoError(t, err)
		cur := &streamsv1.Cursor{}
		require.NoError(t, proto.Unmarshal(raw[2:len(raw)-16], cur))
		return cur.GetClientBinding()
	}

	t.Run("anonymous client", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, expectedBinding(t, []byte{0x01, 0x00}), issuedBinding(t, ClientIdentity{}))
	})

	t.Run("anonymous client ignores the other fields", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t,
			issuedBinding(t, ClientIdentity{}),
			issuedBinding(t, ClientIdentity{Authenticator: "jwt", Issuer: "iss", Subject: "alice"}))
	})

	t.Run("authenticated client without claims", func(t *testing.T) {
		t.Parallel()
		canonical := []byte{0x01, 0x01, 0, 0, 0, 0} // empty authenticator, issuer, no audiences, empty subject
		assert.Equal(t, expectedBinding(t, canonical), issuedBinding(t, ClientIdentity{Authenticated: true}))
	})

	t.Run("authenticated client with audiences", func(t *testing.T) {
		t.Parallel()
		canonical := slices.Concat(
			[]byte{0x01, 0x01},
			lp("jwt"), lp("iss"),
			[]byte{2}, lp("aud-a"), lp("aud-b"), // sorted
			lp("alice"),
		)
		got := issuedBinding(t, ClientIdentity{
			Authenticated: true, Authenticator: "jwt", Issuer: "iss",
			Audience: []string{"aud-b", "aud-a"}, Subject: "alice",
		})
		assert.Equal(t, expectedBinding(t, canonical), got)
	})

	t.Run("anonymous and authenticated with empty claims differ", func(t *testing.T) {
		t.Parallel()
		assert.NotEqual(t,
			issuedBinding(t, ClientIdentity{}),
			issuedBinding(t, ClientIdentity{Authenticated: true}))
	})

	t.Run("field boundaries are unambiguous", func(t *testing.T) {
		t.Parallel()
		a := ClientIdentity{Authenticated: true, Authenticator: "auth", Subject: "0123"}
		b := ClientIdentity{Authenticated: true, Authenticator: "auth0", Subject: "123"}
		assert.NotEqual(t, issuedBinding(t, a), issuedBinding(t, b))

		c := ClientIdentity{Authenticated: true, Audience: []string{"a", "bc"}}
		d := ClientIdentity{Authenticated: true, Audience: []string{"ab", "c"}}
		assert.NotEqual(t, issuedBinding(t, c), issuedBinding(t, d))

		// A claim must not be movable between fields.
		e := ClientIdentity{Authenticated: true, Issuer: "x"}
		f := ClientIdentity{Authenticated: true, Authenticator: "x"}
		assert.NotEqual(t, issuedBinding(t, e), issuedBinding(t, f))
	})

	t.Run("the identity does not leak into the binding", func(t *testing.T) {
		t.Parallel()
		binding := issuedBinding(t, testIdentity)
		assert.Len(t, binding, 16)
		assert.NotContains(t, string(binding), "alice")
	})
}

func TestCursorVersionByte(t *testing.T) {
	t.Parallel()

	codec := mustCodec(t, 0, CursorKey{ID: 1, Secret: testSecret(1)})
	cur := testCursor()
	cur.ClientBinding = make([]byte, 16)
	payload, err := MarshalCursor(cur)
	require.NoError(t, err)

	t.Run("known version with a valid tag is accepted", func(t *testing.T) {
		t.Parallel()
		cur := testCursor()
		cur.ClientBinding = clientBinding(codec.keys[0], testIdentity)
		payload, err := MarshalCursor(cur)
		require.NoError(t, err)
		_, err = codec.Verify(signRaw(t, codec, 1, 0x01, payload), testRequestData, testIdentity)
		require.NoError(t, err)
	})

	for _, version := range []uint8{0x00, 0x02, 0xff} {
		t.Run(fmt.Sprintf("unknown version 0x%02x with a valid tag is rejected", version), func(t *testing.T) {
			t.Parallel()
			// The tag is computed over the unknown version, so only the version check can reject it.
			_, err := codec.Verify(signRaw(t, codec, 1, version, payload), testRequestData, testIdentity)
			requireDeliveryGuaranteeError(t, err, DeliveryGuaranteeErrorCodeCursorInvalid)
		})
	}
}

func TestCursorUnmarshal(t *testing.T) {
	t.Parallel()

	binding := make([]byte, 16)
	kafkaPosition := &streamsv1.Cursor_Kafka{Kafka: &streamsv1.KafkaCursorPosition{}}

	t.Run("round trip", func(t *testing.T) {
		t.Parallel()
		in := testCursor()
		in.IssuedAt = 123
		in.ClientBinding = binding
		data, err := MarshalCursor(in)
		require.NoError(t, err)

		out, err := UnmarshalCursor(data)
		require.NoError(t, err)
		assert.True(t, proto.Equal(in, out))
	})

	t.Run("garbage is rejected", func(t *testing.T) {
		t.Parallel()
		_, err := UnmarshalCursor([]byte{0xff, 0xff, 0xff, 0xff, 0xff})
		assert.Error(t, err)
	})

	t.Run("empty payload is rejected", func(t *testing.T) {
		t.Parallel()
		_, err := UnmarshalCursor(nil)
		assert.ErrorIs(t, err, errCursorPositionMissing)
	})

	t.Run("missing position is rejected", func(t *testing.T) {
		t.Parallel()
		data, err := proto.Marshal(&streamsv1.Cursor{ProviderId: "p", ClientBinding: binding})
		require.NoError(t, err)
		_, err = UnmarshalCursor(data)
		assert.ErrorIs(t, err, errCursorPositionMissing)
	})

	t.Run("client binding of the wrong size is rejected", func(t *testing.T) {
		t.Parallel()
		for _, size := range []int{0, 15, 17, 32} {
			data, err := proto.Marshal(&streamsv1.Cursor{ClientBinding: make([]byte, size), Position: kafkaPosition})
			require.NoError(t, err)
			_, err = UnmarshalCursor(data)
			assert.ErrorIs(t, err, errCursorClientBindingMissing, "size %d", size)
		}
	})

	t.Run("a genuinely signed but incomplete cursor is rejected by Verify", func(t *testing.T) {
		t.Parallel()
		codec := mustCodec(t, 0, CursorKey{ID: 1, Secret: testSecret(1)})
		key := codec.keys[0]

		for name, cur := range map[string]*streamsv1.Cursor{
			"no position":   {ClientBinding: clientBinding(key, testIdentity)},
			"short binding": {ClientBinding: clientBinding(key, testIdentity)[:8], Position: kafkaPosition},
		} {
			payload, err := proto.Marshal(cur)
			require.NoError(t, err, name)
			_, err = codec.Verify(signRaw(t, codec, 1, 0x01, payload), testRequestData, testIdentity)
			requireDeliveryGuaranteeError(t, err, DeliveryGuaranteeErrorCodeCursorInvalid)
		}
	})
}
