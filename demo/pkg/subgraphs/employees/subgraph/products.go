package subgraph

import "github.com/wundergraph/cosmo/demo/pkg/subgraphs/employees/subgraph/model"

var cosmo = &model.Cosmo{
	Upc:       "cosmo",
	Engineers: engineers,
	Lead:      employees[1],
}

var sdk = &model.Sdk{
	Upc:       "sdk",
	Engineers: engineers,
	Owner:     employees[0],
}

var consultancy = &model.Consultancy{
	Upc:  "consultancy",
	Lead: employees[0],
}

var products = []model.Products{
	consultancy, cosmo, sdk,
}
