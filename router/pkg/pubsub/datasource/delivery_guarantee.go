package datasource

import (
	"slices"
	"strings"

	"github.com/buger/jsonparser"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

// DeliveryGuaranteeMode is the delivery guarantee a subscription field declares in the schema
// via the deliveryGuarantees argument of its EDFS subscribe directive.
type DeliveryGuaranteeMode string

const (
	DeliveryGuaranteeModeOff    DeliveryGuaranteeMode = "off"
	DeliveryGuaranteeModeCursor DeliveryGuaranteeMode = "cursor"
)

func NewDeliveryGuaranteeMode(cfg *nodev1.EngineEventConfiguration) DeliveryGuaranteeMode {
	switch cfg.GetDeliveryGuarantees().GetMode() {
	case nodev1.DeliveryGuaranteeMode_DELIVERY_GUARANTEE_MODE_CURSOR:
		return DeliveryGuaranteeModeCursor
	default:
		return DeliveryGuaranteeModeOff
	}
}

// DeliveryGuarantee is the guarantee negotiated for a single client subscription.
type DeliveryGuarantee string

const (
	DeliveryGuaranteeAtMostOnce DeliveryGuarantee = "at-most-once"
	DeliveryGuaranteeCursor     DeliveryGuarantee = "cursor"
)

const (
	DeliveryGuaranteeErrorCodeInvalid     = "DELIVERY_GUARANTEE_INVALID"
	DeliveryGuaranteeErrorCodeUnsupported = "DELIVERY_GUARANTEE_UNSUPPORTED"
	// DeliveryGuaranteeErrorCodeUnsatisfiable means the router would serve the guarantee but can't for this client.
	DeliveryGuaranteeErrorCodeUnsatisfiable = "DELIVERY_GUARANTEE_UNSATISFIABLE"
	// DeliveryGuaranteeErrorCodeCursorInvalid means a cursor is malformed, tampered with,
	// signed with an unknown key or presented for a different request.
	DeliveryGuaranteeErrorCodeCursorInvalid = "CURSOR_INVALID"
	// DeliveryGuaranteeErrorCodeCursorClientMismatch means a cursor was issued to a different client identity.
	DeliveryGuaranteeErrorCodeCursorClientMismatch = "CURSOR_CLIENT_MISMATCH"
	// DeliveryGuaranteeErrorCodeCursorExpired means a cursor is older than the configured
	// max_resume_window. The client is past the point where the router promises a resume.
	DeliveryGuaranteeErrorCodeCursorExpired = "CURSOR_EXPIRED"
)

// deliveryGuaranteeExtensionKey is the key in the request extensions a client uses to ask for a guarantee.
const deliveryGuaranteeExtensionKey = "cosmoDeliveryGuarantee"

// cursorExtensionKey is the key in the request extensions a client presents a cursor under to
// resume a subscription. It is the same key the router issues cursors under in the response
// extensions, so a client can hand back what it received unchanged.
const cursorExtensionKey = "streamsCursor"

// DeliveryGuaranteeError is returned when a client's requested delivery guarantee
// can't be served.
type DeliveryGuaranteeError struct {
	Code      string
	Supported []DeliveryGuarantee
	Message   string
}

func (e *DeliveryGuaranteeError) Error() string {
	return e.Message
}

// SupportedDeliveryGuarantees returns the guarantees a field with the given mode can serve.
func SupportedDeliveryGuarantees(mode DeliveryGuaranteeMode) []DeliveryGuarantee {
	if mode == DeliveryGuaranteeModeCursor {
		return []DeliveryGuarantee{DeliveryGuaranteeCursor, DeliveryGuaranteeAtMostOnce}
	}
	return []DeliveryGuarantee{DeliveryGuaranteeAtMostOnce}
}

// NegotiateDeliveryGuarantee picks the guarantee for a subscription from the field's schema mode
// and the client's body.extensions.cosmoDeliveryGuarantee value in the subscription input.
func NegotiateDeliveryGuarantee(mode DeliveryGuaranteeMode, input []byte) (DeliveryGuarantee, error) {
	supportedGuarantees := SupportedDeliveryGuarantees(mode)

	requestedGuarantee, dataType, _, err := jsonparser.Get(input, "body", "extensions", deliveryGuaranteeExtensionKey)
	if err != nil || dataType == jsonparser.Null {
		// Missing key (or missing body/extensions) and null both mean at-most-once.
		return DeliveryGuaranteeAtMostOnce, nil
	}

	invalid := &DeliveryGuaranteeError{
		Code:      DeliveryGuaranteeErrorCodeInvalid,
		Supported: supportedGuarantees,
		Message:   "The requested delivery guarantee is invalid: " + deliveryGuaranteeExtensionKey + " must be a non-empty string",
	}
	if dataType != jsonparser.String {
		return "", invalid
	}
	parsedRequestedGuarantee, err := jsonparser.ParseString(requestedGuarantee)
	if err != nil || strings.TrimSpace(parsedRequestedGuarantee) == "" {
		return "", invalid
	}

	for token := range strings.SplitSeq(parsedRequestedGuarantee, ",") {
		candidate := DeliveryGuarantee(strings.TrimSpace(token))
		if slices.Contains(supportedGuarantees, candidate) {
			return candidate, nil
		}
	}

	return "", &DeliveryGuaranteeError{
		Code:      DeliveryGuaranteeErrorCodeUnsupported,
		Supported: supportedGuarantees,
		Message:   "None of the requested delivery guarantees is supported by this subscription",
	}
}
