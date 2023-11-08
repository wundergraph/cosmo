package subgraph

import "github.com/wundergraph/cosmo/demo/pkg/subgraphs/employees/subgraph/model"

var employees = []*model.Employee{
	{
		Details: &model.Details{
			Forename: "Jens",
			Location: model.CountryGermany,
			Surname:  "Neuse",
		},
		ID: 1,
		Role: model.Engineer{
			Department:   model.DepartmentEngineering,
			EngineerType: model.EngineerTypeBackend,
			Title:        []string{"Founder", "CEO"},
		},
		Notes: "Jens notes resolved by employees",
	},
	{
		Details: &model.Details{
			Forename: "Dustin",
			Location: model.CountryGermany,
			Surname:  "Deus",
		},
		ID: 2,
		Role: model.Engineer{
			Department:   model.DepartmentEngineering,
			EngineerType: model.EngineerTypeFullstack,
			Title:        []string{"Co-founder", "Tech Lead"},
		},
		Notes: "Dustin notes resolved by employees",
	},
	{
		Details: &model.Details{
			Forename: "Stefan",
			Location: model.CountryAmerica,
			Surname:  "Avram",
		},
		ID: 3,
		Role: model.Marketer{
			Department: model.DepartmentMarketing,
			Title:      []string{"Co-founder", "Head of Growth"},
		},
		Notes: "Stefan notes resolved by employees",
	},
	{
		Details: &model.Details{
			Forename: "Björn",
			Location: model.CountryGermany,
			Surname:  "Schwenzer",
		},
		ID: 4,
		Role: model.Operator{
			Department: model.DepartmentOperations,
			OperatorType: []model.OperationType{
				model.OperationTypeHumanResources, model.OperationTypeFinance,
			},
			Title: []string{"Co-founder", "COO"},
		},
		Notes: "Björn notes resolved by employees",
	},
	{
		ID: 5,
		Details: &model.Details{
			Forename: "Sergiy",
			Location: model.CountryUkraine,
			Surname:  "Petrunin",
		},
		Role: model.Engineer{
			Department:   model.DepartmentEngineering,
			EngineerType: model.EngineerTypeBackend,
			Title:        []string{"Senior GO Engineer"},
		},
		Notes: "Serigy notes resolved by employees",
	},
	{
		Details: &model.Details{
			Forename: "Suvij",
			Location: model.CountryIndia,
			Surname:  "Surya",
		},
		ID: 7,
		Role: model.Engineer{
			Department:   model.DepartmentEngineering,
			EngineerType: model.EngineerTypeFullstack,
			Title:        []string{"Software Engineer"},
		},
		Notes: "Suvij notes resolved by employees",
	},
	{
		Details: &model.Details{
			Forename: "Nithin",
			Location: model.CountryIndia,
			Surname:  "Kumar",
		},
		ID: 8,
		Role: model.Engineer{
			Department:   model.DepartmentEngineering,
			EngineerType: model.EngineerTypeFullstack,
			Title:        []string{"Software Engineer"},
		},
		Notes: "Nithin notes resolved by employees",
	},
	{
		Details: &model.Details{
			Forename: "Alberto",
			Location: model.CountryPortugal,
			Surname:  "Garcia Hierro",
		},
		ID: 9,
		Role: model.Engineer{
			Department:   model.DepartmentEngineering,
			EngineerType: model.EngineerTypeBackend,
			Title:        []string{"Senior Backend Engineer"},
		},
		Notes: "Alberto notes resolved by employees",
	},
	{
		Details: &model.Details{
			Forename: "Eelco",
			Location: model.CountryNetherlands,
			Surname:  "Wiersma",
		},
		ID: 10,
		Role: model.Engineer{
			Department:   model.DepartmentEngineering,
			EngineerType: model.EngineerTypeFrontend,
			Title:        []string{"Senior Frontend Engineer"},
		},
		Notes: "Eelco notes resolved by employees",
	},
	{
		Details: &model.Details{
			Forename: "Alexandra",
			Location: model.CountryGermany,
			Surname:  "Neuse",
		},
		ID: 11,
		Role: model.Operator{
			Department: model.DepartmentOperations,
			OperatorType: []model.OperationType{
				model.OperationTypeFinance,
			},
			Title: []string{"Accounting & Finance"},
		},
		Notes: "Alexandra notes resolved by employees",
	},
	{
		Details: &model.Details{
			Forename: "David",
			Location: model.CountryEngland,
			Surname:  "Stutt",
		},
		ID: 12,
		Role: model.Engineer{
			Department:   model.DepartmentEngineering,
			EngineerType: model.EngineerTypeFullstack,
			Title:        []string{"Software Engineer"},
		},
		Notes: "David notes resolved by employees",
	},
}
