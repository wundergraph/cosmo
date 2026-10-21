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
)

// deliveryGuaranteeExtensionKey is the key in the request extensions a client uses to ask for a guarantee.
const deliveryGuaranteeExtensionKey = "cosmoDeliveryGuarantee"

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
	supported := SupportedDeliveryGuarantees(mode)

	value, dataType, _, err := jsonparser.Get(input, "body", "extensions", deliveryGuaranteeExtensionKey)
	if err != nil || dataType == jsonparser.Null {
		// Missing key (or missing body/extensions) and null both mean at-most-once.
		return DeliveryGuaranteeAtMostOnce, nil
	}

	invalid := &DeliveryGuaranteeError{
		Code:      DeliveryGuaranteeErrorCodeInvalid,
		Supported: supported,
		Message:   "The requested delivery guarantee is invalid: " + deliveryGuaranteeExtensionKey + " must be a non-empty string",
	}
	if dataType != jsonparser.String {
		return "", invalid
	}
	raw, err := jsonparser.ParseString(value)
	if err != nil || strings.TrimSpace(raw) == "" {
		return "", invalid
	}

	for _, token := range strings.Split(raw, ",") {
		candidate := DeliveryGuarantee(strings.TrimSpace(token))
		if slices.Contains(supported, candidate) {
			return candidate, nil
		}
	}

	return "", &DeliveryGuaranteeError{
		Code:      DeliveryGuaranteeErrorCodeUnsupported,
		Supported: supported,
		Message:   "None of the requested delivery guarantees is supported by this subscription",
	}
}
