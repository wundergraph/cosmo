package subgraph

import "github.com/wundergraph/cosmo/demo/pkg/subgraphs/employees/subgraph/model"

var cosmo = &model.Cosmo{
	Upc:       "cosmo",
	Engineers: engineers,
	Lead:      Employees[1],
}

var sdk = &model.Sdk{
	Upc:       "sdk",
	Engineers: engineers,
	Owner:     Employees[0],
	Unicode:   "\U0001F600\u2665\u0021\u0015\u0010\U0001F765",
}

var consultancy = &model.Consultancy{
	Upc:  "consultancy",
	Lead: Employees[0],
}

var products = []model.Products{
	consultancy, cosmo, sdk,
}
