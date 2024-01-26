package subgraph

import (
	"slices"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/employees/subgraph/model"
)

func strPtr(s string) *string {
	return &s
}

var employees = []*model.Employee{
	{
		Details: &model.Details{
			Forename: "Jens",
			Location: model.CountryGermany,
			Surname:  "Neuse",
		},
		ID: 1,
		Role: model.Engineer{
			Departments:  []model.Department{model.DepartmentEngineering, model.DepartmentMarketing},
			EngineerType: model.EngineerTypeBackend,
			Title:        []string{"Founder", "CEO"},
		},
		Notes:     strPtr("Jens notes resolved by employees"),
		StartDate: "January 2020",
	},
	{
		Details: &model.Details{
			Forename: "Dustin",
			Location: model.CountryGermany,
			Surname:  "Deus",
		},
		ID: 2,
		Role: model.Engineer{
			Departments:  []model.Department{model.DepartmentEngineering},
			EngineerType: model.EngineerTypeFullstack,
			Title:        []string{"Co-founder", "Tech Lead"},
		},
		Notes:     strPtr("Dustin notes resolved by employees"),
		StartDate: "July 2022",
	},
	{
		Details: &model.Details{
			Forename: "Stefan",
			Location: model.CountryAmerica,
			Surname:  "Avram",
		},
		ID: 3,
		Role: model.Marketer{
			Departments: []model.Department{model.DepartmentMarketing},
			Title:       []string{"Co-founder", "Head of Growth"},
		},
		Notes:     strPtr("Stefan notes resolved by employees"),
		StartDate: "June 2021",
	},
	{
		Details: &model.Details{
			Forename: "Björn",
			Location: model.CountryGermany,
			Surname:  "Schwenzer",
		},
		ID: 4,
		Role: model.Operator{
			Departments: []model.Department{model.DepartmentOperations, model.DepartmentMarketing},
			OperatorType: []model.OperationType{
				model.OperationTypeHumanResources, model.OperationTypeFinance,
			},
			Title: []string{"Co-founder", "COO"},
		},
		Notes:     strPtr("Björn notes resolved by employees"),
		StartDate: "July 2022",
	},
	{
		ID: 5,
		Details: &model.Details{
			Forename: "Sergiy",
			Location: model.CountryUkraine,
			Surname:  "Petrunin",
		},
		Role: model.Engineer{
			Departments:  []model.Department{model.DepartmentEngineering},
			EngineerType: model.EngineerTypeBackend,
			Title:        []string{"Senior GO Engineer"},
		},
		Notes:     strPtr("Serigy notes resolved by employees"),
		StartDate: "July 2022",
	},
	{
		Details: &model.Details{
			Forename: "Suvij",
			Location: model.CountryIndia,
			Surname:  "Surya",
		},
		ID: 7,
		Role: model.Engineer{
			Departments:  []model.Department{model.DepartmentEngineering},
			EngineerType: model.EngineerTypeFullstack,
			Title:        []string{"Software Engineer"},
		},
		Notes:     strPtr("Suvij notes resolved by employees"),
		StartDate: "September 2022",
	},
	{
		Details: &model.Details{
			Forename: "Nithin",
			Location: model.CountryIndia,
			Surname:  "Kumar",
		},
		ID: 8,
		Role: model.Engineer{
			Departments:  []model.Department{model.DepartmentEngineering},
			EngineerType: model.EngineerTypeFullstack,
			Title:        []string{"Software Engineer"},
		},
		Notes:     strPtr("Nithin notes resolved by employees"),
		StartDate: "September 2022",
	},
	{
		Details: &model.Details{
			Forename: "Eelco",
			Location: model.CountryNetherlands,
			Surname:  "Wiersma",
		},
		ID: 10,
		Role: model.Engineer{
			Departments:  []model.Department{model.DepartmentEngineering},
			EngineerType: model.EngineerTypeFrontend,
			Title:        []string{"Senior Frontend Engineer"},
		},
		Notes:     strPtr("Eelco notes resolved by employees"),
		StartDate: "November 2022",
	},
	{
		Details: &model.Details{
			Forename: "Alexandra",
			Location: model.CountryGermany,
			Surname:  "Neuse",
		},
		ID: 11,
		Role: model.Operator{
			Departments: []model.Department{model.DepartmentOperations},
			OperatorType: []model.OperationType{
				model.OperationTypeFinance,
			},
			Title: []string{"Accounting & Finance"},
		},
		Notes:     strPtr("Alexandra notes resolved by employees"),
		StartDate: "November 2022",
	},
	{
		Details: &model.Details{
			Forename: "David",
			Location: model.CountryEngland,
			Surname:  "Stutt",
		},
		ID: 12,
		Role: model.Engineer{
			Departments:  []model.Department{model.DepartmentEngineering},
			EngineerType: model.EngineerTypeFullstack,
			Title:        []string{"Software Engineer"},
		},
		Notes:     strPtr("David notes resolved by employees"),
		StartDate: "December 2022",
	},
}

func filterEmployees(predicate func(employee *model.Employee) bool) (filtered []*model.Employee) {
	for _, employee := range employees {
		if predicate(employee) {
			filtered = append(filtered, employee)
		}
	}
	return
}

var engineers = filterEmployees(func(e *model.Employee) bool {
	return slices.Contains(e.Role.GetDepartments(), model.DepartmentEngineering)
})

var marketers = filterEmployees(func(e *model.Employee) bool {
	return slices.Contains(e.Role.GetDepartments(), model.DepartmentMarketing)
})

var operators = filterEmployees(func(e *model.Employee) bool {
	return slices.Contains(e.Role.GetDepartments(), model.DepartmentOperations)
})
