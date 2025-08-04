package data

import (
	projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
)

var ServiceShipping = []*projects.Shipping{
	{
		Id:     "1",
		Weight: 2.5,
	},
	{
		Id:     "2",
		Weight: 1.8,
	},
	{
		Id:     "3",
		Weight: 4.2,
	},
	{
		Id:     "4",
		Weight: 0.9,
	},
	{
		Id:     "5",
		Weight: 3.7,
	},
	{
		Id:     "6",
		Weight: 2.1,
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
