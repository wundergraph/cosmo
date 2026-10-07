package subgraph

import "github.com/wundergraph/cosmo/demo/pkg/subgraphs/products/subgraph/model"

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
		Notes: new("Jens notes resolved by products"),
	},
	{
		ID: 2,
		Products: []model.ProductName{
			model.ProductNameCosmo,
			model.ProductNameSdk,
		},
		Notes: new("Dustin notes resolved by products"),
	},
	{
		ID: 3,
		Products: []model.ProductName{
			model.ProductNameConsultancy,
			model.ProductNameMarketing,
		},
		Notes: new("Stefan notes resolved by products"),
	},
	{
		ID: 4,
		Products: []model.ProductName{
			model.ProductNameFinance,
			model.ProductNameHumanResources,
			model.ProductNameMarketing,
		},
		Notes: new("Björn notes resolved by products"),
	},
	{
		ID: 5,
		Products: []model.ProductName{
			model.ProductNameEngine,
			model.ProductNameSdk,
		},
		Notes: new("Sergiy notes resolved by products"),
	},
	{
		ID: 7,
		Products: []model.ProductName{
			model.ProductNameCosmo,
			model.ProductNameSdk,
		},
		Notes: new("Suvij notes resolved by products"),
	},
	{
		ID: 8,
		Products: []model.ProductName{
			model.ProductNameCosmo,
			model.ProductNameSdk,
		},
		Notes: new("Nithin notes resolved by products"),
	},
	{
		ID: 10,
		Products: []model.ProductName{
			model.ProductNameConsultancy,
			model.ProductNameCosmo,
			model.ProductNameSdk,
		},
		Notes: new("Eelco notes resolved by products"),
	},
	{
		ID: 11,
		Products: []model.ProductName{
			model.ProductNameFinance,
		},
		Notes: new("Alexandra notes resolved by products"),
	},
	{
		ID: 12,
		Products: []model.ProductName{
			model.ProductNameConsultancy,
			model.ProductNameCosmo,
			model.ProductNameEngine,
			model.ProductNameSdk,
		},
		Notes: new("David notes resolved by products"),
	},
}
