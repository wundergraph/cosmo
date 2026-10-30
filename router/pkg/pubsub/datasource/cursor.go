package datasource

import (
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
	// maxCursorPayloadSize is the upper bound for the payload of an issued cursor, about 22 KB base64 encoded on the wire.
	// A Kafka position needs roughly 20 bytes per partition, so this is a backstop that realistic
	// subscriptions (up to about 800 partitions in total) never hit.
	maxCursorPayloadSize = 16 << 10

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
	errCursorTooLarge             = errors.New("cursor payload exceeds the maximum size")
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
	// maxResumeWindow is how long after it was issued a cursor may still be resumed.
	// The zero value means cursors never age out.
	maxResumeWindow time.Duration
}

// NewCursorCodec derives the tag and client binding keys of every key of the keyring.
// maxResumeWindow is how long after it was issued a cursor may still be resumed;
// zero disables the check.
func NewCursorCodec(keys []CursorKey, maxResumeWindow time.Duration) (*CursorCodec, error) {
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

	return &CursorCodec{keys: derived, maxResumeWindow: maxResumeWindow}, nil
}

// signingKey returns the key with the highest id that has not expired yet.
func (c *CursorCodec) signingKey() (derivedCursorKey, bool) {
	for _, k := range c.keys {
		if k.expiresAt.IsZero() || time.Now().Before(k.expiresAt) {
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
// The wire format is 'version (1 byte) | keyID (1 byte) | payload (n bytes) | tag (16 bytes)'
func (c *CursorCodec) Issue(cur *streamsv1.Cursor, requestData []byte, id ClientIdentity) (string, error) {
	key, ok := c.signingKey()
	if !ok {
		return "", errors.New("no cursor key is valid for signing")
	}

	// A shallow copy, as the position is shared by all subscribers of a trigger.
	payload, err := MarshalCursor(&streamsv1.Cursor{
		ProviderId:    cur.GetProviderId(),
		IssuedAt:      time.Now().UnixMilli(),
		ClientBinding: clientBinding(key, id),
		Position:      cur.GetPosition(),
	})
	if err != nil {
		return "", err
	}
	if len(payload) > maxCursorPayloadSize {
		return "", fmt.Errorf("%w: %d > %d bytes", errCursorTooLarge, len(payload), maxCursorPayloadSize)
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

	// IssuedAt is inside the signed payload, so it can't be moved forward by a client.
	// The age check is the last step: it only runs on a cursor that is otherwise genuine
	// and belongs to this client, so an attacker learns nothing from reaching it.
	if c.maxResumeWindow > 0 {
		age := time.Since(time.UnixMilli(cur.GetIssuedAt()))
		if age > c.maxResumeWindow {
			return nil, &DeliveryGuaranteeError{
				Code:    DeliveryGuaranteeErrorCodeCursorExpired,
				Message: "The cursor is older than the maximum resume window",
			}
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
