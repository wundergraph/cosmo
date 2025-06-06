package data

import projects "github.com/wundergraph/cosmo/demo/pkg/subgraphs/projects/generated"

var Employees = []*projects.Employee{
	{
		Id:       1,
		Projects: []*projects.Project{ServiceProjects[0], ServiceProjects[3]},
	},
	{
		Id:       2,
		Projects: []*projects.Project{ServiceProjects[0], ServiceProjects[1], ServiceProjects[4]},
	},
	{
		Id:       3,
		Projects: []*projects.Project{ServiceProjects[0], ServiceProjects[5]},
	},
	{
		Id:       4,
		Projects: []*projects.Project{ServiceProjects[3]},
	},
	{
		Id:       5,
		Projects: []*projects.Project{ServiceProjects[2], ServiceProjects[6]},
	},
	{
		Id:       7,
		Projects: []*projects.Project{ServiceProjects[2], ServiceProjects[1]},
	},
	{
		Id:       8,
		Projects: []*projects.Project{ServiceProjects[1]},
	},
	{
		Id:       10,
		Projects: []*projects.Project{ServiceProjects[4]},
	},
	{
		Id:       11,
		Projects: []*projects.Project{ServiceProjects[5]},
	},
	{
		Id:       12,
		Projects: []*projects.Project{ServiceProjects[6]},
	},
}
