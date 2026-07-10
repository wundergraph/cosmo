package subgraph

import (
	"fmt"
)

var prices = map[string]float64{
	"1": 199.0,
	"2": 299.0,
	"3": 499.0,
}

func priceByProductID(id string) (float64, error) {
	price, ok := prices[id]
	if !ok {
		return 0, fmt.Errorf("no price for product %q", id)
	}
	return price, nil
}
