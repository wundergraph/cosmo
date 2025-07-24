package data

import (
	projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
)

var ServiceProducts = []*projects.Product{
	{
		Upc:      "cosmo",
		Projects: &projects.ListOfProject{Items: []*projects.Project{ServiceProjects[0], ServiceProjects[1], ServiceProjects[3]}},
		// New nested nullable list field
		FeatureMatrix: &projects.ListOfListOfString{
			List: &projects.ListOfListOfString_List{
				Items: []*projects.ListOfString{
					{Items: []string{"federation", "routing", "composition"}},
					{Items: []string{"monitoring", "analytics", "tracing"}},
					nil,                   // nullable list element for testing
					{Items: []string{""}}, // nullable string element for testing
				},
			},
		},
	},
	{
		Upc:      "sdk",
		Projects: &projects.ListOfProject{Items: []*projects.Project{ServiceProjects[2], ServiceProjects[6]}},
		// Nullable nested list example
		FeatureMatrix: nil,
	},
	{
		Upc:      "consultancy",
		Projects: &projects.ListOfProject{Items: []*projects.Project{ServiceProjects[4], ServiceProjects[5]}},
		// Another example with nested lists
		FeatureMatrix: &projects.ListOfListOfString{
			List: &projects.ListOfListOfString_List{
				Items: []*projects.ListOfString{
					{Items: []string{"architecture", "best-practices"}},
					{Items: []string{"training", "mentoring"}},
				},
			},
		},
	},
}

func GetProductByUpc(upc string) *projects.Product {
	for _, product := range ServiceProducts {
		if product.Upc == upc {
			return product
		}
	}
	return nil
}
