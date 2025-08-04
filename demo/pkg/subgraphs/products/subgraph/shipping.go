package subgraph

import "github.com/wundergraph/cosmo/demo/pkg/subgraphs/products/subgraph/model"

var shippingData = []*model.Shipping{
	{
		ID:             "1",
		TrackingNumber: "UPS-1234567890",
		Carrier:        "UPS",
	},
	{
		ID:             "2",
		TrackingNumber: "FEDEX-1234567891",
		Carrier:        "FedEx",
	},
	{
		ID:             "3",
		TrackingNumber: "DHL-1234567892",
		Carrier:        "DHL",
	},
	{
		ID:             "4",
		TrackingNumber: "USPS-1234567893",
		Carrier:        "USPS",
	},
	{
		ID:             "5",
		TrackingNumber: "ONTRAC-1234567894",
		Carrier:        "ONTRAC",
	},
	{
		ID:             "6",
		TrackingNumber: "CANPOST-1234567895",
		Carrier:        "CANPOST",
	},
}
