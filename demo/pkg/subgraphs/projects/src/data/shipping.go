package data

import (
	projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
)

var ServiceShipping = []*projects.Shipping{
	{
		Id:             "1",
		TrackingNumber: "UPS-1234567890",
		Weight:         2.5,
	},
	{
		Id:             "2",
		TrackingNumber: "FEDEX-1234567891",
		Weight:         1.8,
	},
	{
		Id:             "3",
		TrackingNumber: "DHL-1234567892",
		Weight:         4.2,
	},
	{
		Id:             "4",
		TrackingNumber: "USPS-1234567893",
		Weight:         0.9,
	},
	{
		Id:             "5",
		TrackingNumber: "ONTRAC-1234567894",
		Weight:         3.7,
	},
	{
		Id:             "6",
		TrackingNumber: "CANPOST-1234567895",
		Weight:         2.1,
	},
}

// Helper function to get shipping by ID
func GetShippingByID(id string) *projects.Shipping {
	for _, shipping := range ServiceShipping {
		if shipping.Id == id {
			return shipping
		}
	}
	return nil
}
