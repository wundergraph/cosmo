package data

import projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"

// Products that are related to projects
var ServiceProducts = []*projects.Product{
	{
		Upc: "cosmo",
		Projects: []*projects.Project{
			ServiceProjects[0], // Cloud Migration Overhaul
			ServiceProjects[1], // Microservices Revolution
			ServiceProjects[3], // DevOps Transformation
		},
	},
	{
		Upc: "sdk",
		Projects: []*projects.Project{
			ServiceProjects[2], // AI-Powered Analytics
			ServiceProjects[6], // Data Lake Implementation
		},
	},
	{
		Upc: "consultancy",
		Projects: []*projects.Project{
			ServiceProjects[4], // Security Overhaul
			ServiceProjects[5], // Mobile App Redesign
		},
	},
}

// Helper function to get product by UPC
func GetProductByUpc(upc string) *projects.Product {
	for _, product := range ServiceProducts {
		if product.Upc == upc {
			return product
		}
	}
	return nil
}

// Helper function to get projects by product UPC
func GetProjectsByProductUpc(upc string) []*projects.Project {
	product := GetProductByUpc(upc)
	if product != nil {
		return product.Projects
	}
	return nil
}
