package subgraph

import "github.com/wundergraph/cosmo/demo/pkg/subgraphs/products/subgraph/model"

func strPtr(s string) *string {
	return &s
}

var employees = []*model.Employee{
	{
		ID: 1,
		Products: []model.ProductName{
			model.ProductNameConsultancy,
			model.ProductNameCosmo,
			model.ProductNameEngine,
			model.ProductNameMarketing,
			model.ProductNameSdk,
		},
		Notes: strPtr("Jens notes resolved by products"),
	},
	{
		ID: 2,
		Products: []model.ProductName{
			model.ProductNameCosmo,
			model.ProductNameSdk,
		},
		Notes: strPtr("Dustin notes resolved by products"),
	},
	{
		ID: 3,
		Products: []model.ProductName{
			model.ProductNameConsultancy,
			model.ProductNameMarketing,
		},
		Notes: strPtr("Stefan notes resolved by products"),
	},
	{
		ID: 4,
		Products: []model.ProductName{
			model.ProductNameFinance,
			model.ProductNameHumanResources,
			model.ProductNameMarketing,
		},
		Notes: strPtr("Björn notes resolved by products"),
	},
	{
		ID: 5,
		Products: []model.ProductName{
			model.ProductNameEngine,
			model.ProductNameSdk,
		},
		Notes: strPtr("Sergiy notes resolved by products"),
	},
	{
		ID: 7,
		Products: []model.ProductName{
			model.ProductNameCosmo,
			model.ProductNameSdk,
		},
		Notes: strPtr("Suvij notes resolved by products"),
	},
	{
		ID: 8,
		Products: []model.ProductName{
			model.ProductNameCosmo,
			model.ProductNameSdk,
		},
		Notes: strPtr("Nithin notes resolved by products"),
	},
	{
		ID: 10,
		Products: []model.ProductName{
			model.ProductNameConsultancy,
			model.ProductNameCosmo,
			model.ProductNameSdk,
		},
		Notes: strPtr("Eelco notes resolved by products"),
	},
	{
		ID: 11,
		Products: []model.ProductName{
			model.ProductNameFinance,
		},
		Notes: strPtr("Alexandra notes resolved by products"),
	},
	{
		ID: 12,
		Products: []model.ProductName{
			model.ProductNameConsultancy,
			model.ProductNameCosmo,
			model.ProductNameEngine,
			model.ProductNameSdk,
		},
		Notes: strPtr("David notes resolved by products"),
	},
}
