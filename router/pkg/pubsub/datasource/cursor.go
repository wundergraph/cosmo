package datasource

import (
	"context"
	"crypto/hkdf"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"slices"
	"time"

	"google.golang.org/protobuf/proto"

	streamsv1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/streams/v1"
)

const (
	// cursorVersion is the version byte in front of every cursor on the wire.
	cursorVersion byte = 0x01
	// cursorTagSize is the length of the truncated HMAC at the end of a cursor on the wire.
	cursorTagSize = 16
	// cursorClientBindingSize is the length of Cursor.ClientBinding.
	cursorClientBindingSize = 16
	// cursorHeaderSize is the length of version and keyID in front of the payload.
	cursorHeaderSize = 2
	// cursorMinSecretSize is the minimum length of a cursor key secret.
	cursorMinSecretSize = 32

	cursorTagDomain      = "cosmo/cursor/v1"
	cursorTagKeyLabel    = "cosmo/cursor/tag/v1"
	cursorClientKeyLabel = "cosmo/cursor/client/v1"

	// clientBindingVersion is the first byte of the canonical clientData.
	clientBindingVersion byte = 0x01
	clientKindAnonymous  byte = 0x00
	clientKindAuthed     byte = 0x01
)

var (
	errCursorPositionMissing      = errors.New("cursor has no position")
	errCursorClientBindingMissing = errors.New("cursor has no valid client binding")
)

// MarshalCursor serializes a cursor into the payload of the cursor wire format.
// The same cursor always produces the same bytes.
func MarshalCursor(c *streamsv1.Cursor) ([]byte, error) {
	if c.GetPosition() == nil {
		return nil, errCursorPositionMissing
	}
	if len(c.GetClientBinding()) != cursorClientBindingSize {
		return nil, errCursorClientBindingMissing
	}
	// Deterministic sorts map keys, which protobuf otherwise writes in random order.
	return proto.MarshalOptions{Deterministic: true}.Marshal(c)
}

// UnmarshalCursor deserializes the payload of the cursor wire format.
// A cursor without a position, e.g. one carrying a position of a provider type
// unknown to this router, is rejected.
func UnmarshalCursor(data []byte) (*streamsv1.Cursor, error) {
	c := &streamsv1.Cursor{}
	if err := proto.Unmarshal(data, c); err != nil {
		return nil, fmt.Errorf("unmarshaling cursor: %w", err)
	}
	if c.GetPosition() == nil {
		return nil, errCursorPositionMissing
	}
	if len(c.GetClientBinding()) != cursorClientBindingSize {
		return nil, errCursorClientBindingMissing
	}
	return c, nil
}

// ClientIdentity is the part of an authenticated request a cursor is bound to.
// The zero value is the anonymous client.
type ClientIdentity struct {
	Authenticated bool
	Authenticator string
	Issuer        string
	// Audience is sorted byte-wise before encoding, so its order does not matter.
	Audience []string
	// Subject is the value of the configured identity claim.
	Subject string
}

// canonical returns the clientData of the identity: a version byte, a kind byte and,
// for authenticated clients, every field length-prefixed. The kind byte keeps an anonymous
// client apart from an authenticated client with empty claims; the length prefixes keep
// authenticator "auth" with subject "0123" apart from authenticator "auth0" with subject "123".
func (c ClientIdentity) canonical() []byte {
	if !c.Authenticated {
		return []byte{clientBindingVersion, clientKindAnonymous}
	}

	audience := slices.Clone(c.Audience)
	slices.Sort(audience)

	b := []byte{clientBindingVersion, clientKindAuthed}
	b = appendLengthPrefixed(b, []byte(c.Authenticator))
	b = appendLengthPrefixed(b, []byte(c.Issuer))
	b = binary.AppendUvarint(b, uint64(len(audience)))
	for _, aud := range audience {
		b = appendLengthPrefixed(b, []byte(aud))
	}
	b = appendLengthPrefixed(b, []byte(c.Subject))
	return b
}

func appendLengthPrefixed(b, data []byte) []byte {
	b = binary.AppendUvarint(b, uint64(len(data)))
	return append(b, data...)
}

// SubscriberBindingFunc extracts the client identity a subscriber's cursors are bound to from its context.
// It returns a *DeliveryGuaranteeError if the subscriber can't be issued cursors.
type SubscriberBindingFunc func(ctx context.Context) (ClientIdentity, error)

// Cursors bundles what a data source needs to issue cursors.
// A zero value means cursors can't be issued.
type Cursors struct {
	Codec             *CursorCodec
	SubscriberBinding SubscriberBindingFunc
}

func (c Cursors) Enabled() bool {
	return c.Codec != nil && c.SubscriberBinding != nil
}

// CursorTopicsProvider is implemented by subscription configurations of providers that support cursors.
// The topics are part of requestData, so a cursor can't be resumed on different topics.
type CursorTopicsProvider interface {
	CursorTopics() []string
}

// cursorRequestData returns the requestData a cursor is signed over: the provider type and id,
// and the sorted topics of the subscription, each length-prefixed.
func cursorRequestData(conf SubscriptionEventConfiguration) ([]byte, error) {
	topicsProvider, ok := conf.(CursorTopicsProvider)
	if !ok {
		return nil, fmt.Errorf("provider type %s does not support cursors", conf.ProviderType())
	}
	topics := slices.Clone(topicsProvider.CursorTopics())
	slices.Sort(topics)

	b := appendLengthPrefixed(nil, []byte(conf.ProviderType()))
	b = appendLengthPrefixed(b, []byte(conf.ProviderID()))
	b = binary.AppendUvarint(b, uint64(len(topics)))
	for _, topic := range topics {
		b = appendLengthPrefixed(b, []byte(topic))
	}
	return b, nil
}

// cursorBinding is what the cursors of a single subscriber are bound to.
type cursorBinding struct {
	identity    ClientIdentity
	requestData []byte
}

func newCursorBinding(ctx context.Context, subscriberBinding SubscriberBindingFunc, conf SubscriptionEventConfiguration) (cursorBinding, error) {
	identity, err := subscriberBinding(ctx)
	if err != nil {
		return cursorBinding{}, err
	}
	requestData, err := cursorRequestData(conf)
	if err != nil {
		return cursorBinding{}, err
	}
	return cursorBinding{identity: identity, requestData: requestData}, nil
}

// CursorKey is a key of the cursor keyring.
type CursorKey struct {
	ID     uint8
	Secret []byte
	// ExpiresAt is a signing cutoff: past it the key no longer signs new cursors,
	// but it keeps verifying cursors for as long as it is configured.
	// The zero value never expires.
	ExpiresAt time.Time
}

type derivedCursorKey struct {
	id        uint8
	tagKey    []byte // signs the whole cursor
	clientKey []byte // fingerprints client identity
	expiresAt time.Time
}

// CursorCodec issues and verifies signed cursors.
type CursorCodec struct {
	// keys are sorted by id, highest first.
	keys []derivedCursorKey
	now  func() time.Time
}

// NewCursorCodec derives the tag and client binding keys of every key of the keyring.
func NewCursorCodec(keys []CursorKey) (*CursorCodec, error) {
	if len(keys) == 0 {
		return nil, errors.New("cursor keyring is empty")
	}

	derived := make([]derivedCursorKey, 0, len(keys))
	for _, k := range keys {
		if len(k.Secret) < cursorMinSecretSize {
			return nil, fmt.Errorf("cursor key %d: secret must be at least %d bytes", k.ID, cursorMinSecretSize)
		}
		if slices.ContainsFunc(derived, func(d derivedCursorKey) bool { return d.id == k.ID }) {
			return nil, fmt.Errorf("cursor key %d: duplicate id", k.ID)
		}
		tagKey, err := hkdf.Key(sha256.New, k.Secret, nil, cursorTagKeyLabel, sha256.Size)
		if err != nil {
			return nil, fmt.Errorf("cursor key %d: deriving tag key: %w", k.ID, err)
		}
		clientKey, err := hkdf.Key(sha256.New, k.Secret, nil, cursorClientKeyLabel, sha256.Size)
		if err != nil {
			return nil, fmt.Errorf("cursor key %d: deriving client key: %w", k.ID, err)
		}
		derived = append(derived, derivedCursorKey{
			id:        k.ID,
			tagKey:    tagKey,
			clientKey: clientKey,
			expiresAt: k.ExpiresAt,
		})
	}

	slices.SortFunc(derived, func(a, b derivedCursorKey) int { return int(b.id) - int(a.id) })

	return &CursorCodec{keys: derived, now: time.Now}, nil
}

// signingKey returns the key with the highest id that has not expired yet.
func (c *CursorCodec) signingKey() (derivedCursorKey, bool) {
	now := c.now()
	for _, k := range c.keys {
		if k.expiresAt.IsZero() || now.Before(k.expiresAt) {
			return k, true
		}
	}
	return derivedCursorKey{}, false
}

func (c *CursorCodec) key(id uint8) (derivedCursorKey, bool) {
	for _, k := range c.keys {
		if k.id == id {
			return k, true
		}
	}
	return derivedCursorKey{}, false
}

// Issue binds the cursor to the client, signs it over requestData and returns its wire format.
// The given cursor is not modified, it only has to carry the provider id and position.
func (c *CursorCodec) Issue(cur *streamsv1.Cursor, requestData []byte, id ClientIdentity) (string, error) {
	key, ok := c.signingKey()
	if !ok {
		return "", errors.New("no cursor key is valid for signing")
	}

	// A shallow copy, as the position is shared by all subscribers of a trigger.
	payload, err := MarshalCursor(&streamsv1.Cursor{
		ProviderId:    cur.GetProviderId(),
		IssuedAt:      c.now().UnixMilli(),
		ClientBinding: clientBinding(key, id),
		Position:      cur.GetPosition(),
	})
	if err != nil {
		return "", err
	}

	wire := make([]byte, 0, cursorHeaderSize+len(payload)+cursorTagSize)
	wire = append(wire, cursorVersion, key.id)
	wire = append(wire, payload...)
	wire = append(wire, cursorTag(key, cursorVersion, payload, requestData)...)
	return base64.RawURLEncoding.EncodeToString(wire), nil
}

// Verify checks a cursor in wire format against the incoming request and returns the decoded cursor.
// It verifies before it decodes, and it verifies over the received bytes.
// It returns a *DeliveryGuaranteeError if the cursor is rejected.
func (c *CursorCodec) Verify(wire string, requestData []byte, id ClientIdentity) (*streamsv1.Cursor, error) {
	raw, err := base64.RawURLEncoding.DecodeString(wire)
	if err != nil || len(raw) < cursorHeaderSize+cursorTagSize {
		return nil, errCursorInvalid()
	}

	version, keyID := raw[0], raw[1]
	if version != cursorVersion {
		return nil, errCursorInvalid()
	}
	key, ok := c.key(keyID)
	if !ok {
		return nil, errCursorInvalid()
	}

	payload := raw[cursorHeaderSize : len(raw)-cursorTagSize]
	tag := raw[len(raw)-cursorTagSize:]
	if !hmac.Equal(tag, cursorTag(key, version, payload, requestData)) {
		return nil, errCursorInvalid()
	}

	cur, err := UnmarshalCursor(payload)
	if err != nil {
		return nil, errCursorInvalid()
	}

	// The expected binding always comes from the incoming request, never from the cursor,
	// so an anonymous cursor can't be resumed by an authenticated client and vice versa.
	if !hmac.Equal(cur.GetClientBinding(), clientBinding(key, id)) {
		return nil, &DeliveryGuaranteeError{
			Code:    DeliveryGuaranteeErrorCodeCursorClientMismatch,
			Message: "The cursor was issued to a different client",
		}
	}

	return cur, nil
}

func errCursorInvalid() *DeliveryGuaranteeError {
	return &DeliveryGuaranteeError{
		Code:    DeliveryGuaranteeErrorCodeCursorInvalid,
		Message: "The cursor is invalid",
	}
}

// clientBinding returns the keyed fingerprint of the client identity.
func clientBinding(key derivedCursorKey, id ClientIdentity) []byte {
	mac := hmac.New(sha256.New, key.clientKey)
	mac.Write(id.canonical())
	return mac.Sum(nil)[:cursorClientBindingSize]
}

// cursorTag returns the truncated HMAC over the domain, version, keyID, payload and requestData.
// The client binding is covered as part of the payload.
func cursorTag(key derivedCursorKey, version byte, payload, requestData []byte) []byte {
	mac := hmac.New(sha256.New, key.tagKey)
	mac.Write([]byte(cursorTagDomain))
	mac.Write([]byte{version, key.id})
	mac.Write(appendLengthPrefixed(nil, payload))
	mac.Write(appendLengthPrefixed(nil, requestData))
	return mac.Sum(nil)[:cursorTagSize]
}
