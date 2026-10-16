package datasource

import nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"

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
