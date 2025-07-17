package data

import projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"

var ServiceProjects = []*projects.Project{
	{
		Id:          "1",
		Name:        "Cloud Migration Overhaul",
		Description: "Migrate legacy systems to cloud-native architecture",
		Status:      projects.ProjectStatus_PROJECT_STATUS_ACTIVE,
		StartDate:   "2021-01-01",
		EndDate:     "2025-08-20",
		TeamMembers: []*projects.Employee{
			{Id: 1},
			{Id: 2},
			{Id: 3},
		},
		MilestoneIds: []string{"1", "2", "3"},
	},
	{
		Id:          "2",
		Name:        "Microservices Revolution",
		Description: "Break down monolith into microservices",
		Status:      projects.ProjectStatus_PROJECT_STATUS_ACTIVE,
		StartDate:   "2021-01-01",
		EndDate:     "2025-08-20",
		TeamMembers: []*projects.Employee{
			{Id: 7},
			{Id: 8},
		},
		MilestoneIds: []string{"4", "5", "6"},
	},
	{
		Id:          "3",
		Name:        "AI-Powered Analytics",
		Description: "Implement machine learning for business intelligence",
		Status:      projects.ProjectStatus_PROJECT_STATUS_ACTIVE,
		StartDate:   "2021-01-01",
		EndDate:     "2025-08-20",
		TeamMembers: []*projects.Employee{
			{Id: 5},
			{Id: 7},
		},
	},
	{
		Id:          "4",
		Name:        "DevOps Transformation",
		Description: "Implement CI/CD and infrastructure as code",
		Status:      projects.ProjectStatus_PROJECT_STATUS_PLANNING,
		StartDate:   "2023-03-01",
		EndDate:     "2024-12-31",
		TeamMembers: []*projects.Employee{
			{Id: 1},
			{Id: 4},
		},
		MilestoneIds: []string{},
	},
	{
		Id:          "5",
		Name:        "Security Overhaul",
		Description: "Implement zero-trust security architecture",
		Status:      projects.ProjectStatus_PROJECT_STATUS_ON_HOLD,
		StartDate:   "2023-06-01",
		EndDate:     "2024-06-30",
		TeamMembers: []*projects.Employee{
			{Id: 2},
			{Id: 10},
		},
		MilestoneIds: []string{},
	},
	{
		Id:          "6",
		Name:        "Mobile App Redesign",
		Description: "Modernize mobile applications with Flutter",
		Status:      projects.ProjectStatus_PROJECT_STATUS_COMPLETED,
		StartDate:   "2022-01-01",
		EndDate:     "2023-01-31",
		TeamMembers: []*projects.Employee{
			{Id: 3},
			{Id: 11},
		},
		MilestoneIds: []string{"1", "4", "5", "6"},
	},
	{
		Id:          "7",
		Name:        "Data Lake Implementation",
		Description: "Build enterprise data lake for analytics",
		Status:      projects.ProjectStatus_PROJECT_STATUS_ACTIVE,
		StartDate:   "2023-01-01",
		EndDate:     "2024-12-31",
		TeamMembers: []*projects.Employee{
			{Id: 5},
			{Id: 12},
		},
		MilestoneIds: []string{"1", "2", "3", "4", "5", "6"},
	},
}
