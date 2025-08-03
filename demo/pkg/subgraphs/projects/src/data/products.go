package data

import (
	projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"
)

var ServiceProducts = []*projects.Product{
	{
		Upc:      "cosmo",
		Projects: &projects.ListOfProject{List: &projects.ListOfProject_List{Items: []*projects.Project{ServiceProjects[0], ServiceProjects[1], ServiceProjects[3]}}},
		// New nested nullable list field
		FeatureMatrix: &projects.ListOfListOfString{
			List: &projects.ListOfListOfString_List{
				Items: []*projects.ListOfString{
					{List: &projects.ListOfString_List{Items: []string{"federation", "routing", "composition"}}},
					{List: &projects.ListOfString_List{Items: []string{"monitoring", "analytics", "tracing"}}},
					{List: &projects.ListOfString_List{}},                    // Empty list element for testing
					{List: &projects.ListOfString_List{Items: []string{""}}}, // empty string element for testing
					nil, // nullable list element for testing
				},
			},
		},
	},
	{
		Upc:      "sdk",
		Projects: &projects.ListOfProject{List: &projects.ListOfProject_List{Items: []*projects.Project{ServiceProjects[2], ServiceProjects[6]}}},
		// Nullable nested list example
		FeatureMatrix: nil,
	},
	{
		Upc:      "consultancy",
		Projects: &projects.ListOfProject{List: &projects.ListOfProject_List{Items: []*projects.Project{ServiceProjects[4], ServiceProjects[5]}}},
		// Another example with nested lists
		FeatureMatrix: &projects.ListOfListOfString{
			List: &projects.ListOfListOfString_List{
				Items: []*projects.ListOfString{
					{List: &projects.ListOfString_List{Items: []string{"architecture", "best-practices"}}},
					{List: &projects.ListOfString_List{Items: []string{"training", "mentoring"}}},
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
