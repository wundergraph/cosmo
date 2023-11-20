package subgraph

import "github.com/wundergraph/cosmo/demo/pkg/subgraphs/products/subgraph/model"

var cosmo = &model.Cosmo{
	Upc:  "cosmo",
	Name: model.ProductNameCosmo,
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
	case model.ProductNameCosmo:
		return "https://cosmo-docs.wundergraph.com/"
	case model.ProductNameEngine:
		return "https://github.com/wundergraph/graphql-go-tools/blob/master/README.md"
	case model.ProductNameHumanResources:
		fallthrough
	case model.ProductNameFinance:
		return "N/A"
	case model.ProductNameMarketing:
		return "https://wundergraph.com/pricing"
	case model.ProductNameConsultancy:
		return "https://cal.com/stefan-avram-wundergraph/wundergraph-introduction"
	default:
		return "https://docs.wundergraph.com/"
	}
}
