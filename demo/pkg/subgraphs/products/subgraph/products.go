package subgraph

import "github.com/wundergraph/cosmo/demo/pkg/subgraphs/products/subgraph/model"

var cosmo = &model.Cosmo{
	Upc:           "cosmo",
	Name:          model.ProductNameCosmo,
	RepositoryURL: "https://github.com/wundergraph/cosmo",
}

var consultancy = &model.Consultancy{
	Upc:  "cosmo",
	Name: model.ProductNameConsultancy,
}

var documentation = &model.Documentation{
	URL:  "",
	Urls: nil,
}

var products = []model.Products{
	cosmo, consultancy, documentation,
}

func documentationURL(productName model.ProductName) string {
	switch productName {
	case model.ProductNameConsultancy:
		return "https://cal.com/stefan-avram-wundergraph/wundergraph-introduction"
	case model.ProductNameCosmo:
		return "https://cosmo-docs.wundergraph.com/"
	case model.ProductNameEngine:
		return "https://github.com/wundergraph/graphql-go-tools/blob/master/README.md"
	case model.ProductNameMarketing:
		return "https://wundergraph.com/pricing"
	case model.ProductNameSdk:
		return "https://docs.wundergraph.com/"
	default:
		return "N/A"
	}
}
