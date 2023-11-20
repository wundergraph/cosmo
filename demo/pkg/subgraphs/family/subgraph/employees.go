package subgraph

import "github.com/wundergraph/cosmo/demo/pkg/subgraphs/family/subgraph/model"

var engaged = model.MaritalStatusEngaged
var married = model.MaritalStatusMarried

var employees = []*model.Employee{
	{
		ID: 1,
		Details: &model.Details{
			Forename:      "Jens",
			Surname:       "Neuse",
			HasChildren:   true,
			MaritalStatus: &married,
			Nationality:   model.NationalityGerman,
		},
	},
	{
		ID: 2,
		Details: &model.Details{
			Forename:      "Dustin",
			Surname:       "Deus",
			HasChildren:   false,
			MaritalStatus: &engaged,
			Nationality:   model.NationalityGerman,
		},
	},
	{
		ID: 3,
		Details: &model.Details{
			Forename:      "Stefan",
			Surname:       "Avram",
			HasChildren:   false,
			MaritalStatus: &engaged,
			Nationality:   model.NationalityAmerican,
			Pets: []model.Pet{
				model.Alligator{
					Class:     model.ClassReptile,
					Gender:    model.GenderUnknown,
					Name:      "Snappy",
					Dangerous: "yes",
				},
			},
		},
	},
	{
		ID: 4,
		Details: &model.Details{
			Forename:      "Björn",
			Surname:       "Schwenzer",
			HasChildren:   true,
			MaritalStatus: &married,
			Nationality:   model.NationalityGerman,
			Pets: []model.Pet{
				model.Dog{
					Breed:  model.DogBreedGoldenRetriever,
					Class:  model.ClassMammal,
					Gender: model.GenderFemale,
					Name:   "Abby",
				},
				model.Pony{
					Class:  model.ClassMammal,
					Gender: model.GenderMale,
					Name:   "Survivor",
				},
			},
		},
	},
	{
		ID: 5,
		Details: &model.Details{
			Forename:      "Sergiy",
			Surname:       "Petrunin",
			HasChildren:   false,
			MaritalStatus: &engaged,
			Nationality:   model.NationalityUkrainian,
			Pets: []model.Pet{
				model.Cat{
					Class:  model.ClassMammal,
					Gender: model.GenderFemale,
					Name:   "Blotch",
					Type:   model.CatTypeStreet,
				},
				model.Cat{
					Class:  model.ClassMammal,
					Gender: model.GenderMale,
					Name:   "Grayone",
					Type:   model.CatTypeStreet,
				},
				model.Cat{
					Class:  model.ClassMammal,
					Gender: model.GenderMale,
					Name:   "Rusty",
					Type:   model.CatTypeStreet,
				},
				model.Cat{
					Class:  model.ClassMammal,
					Gender: model.GenderFemale,
					Name:   "Manya",
					Type:   model.CatTypeHome,
				},
				model.Cat{
					Class:  model.ClassMammal,
					Gender: model.GenderMale,
					Name:   "Peach",
					Type:   model.CatTypeStreet,
				},
				model.Cat{
					Class:  model.ClassMammal,
					Gender: model.GenderMale,
					Name:   "Panda",
					Type:   model.CatTypeHome,
				},
				model.Cat{
					Class:  model.ClassMammal,
					Gender: model.GenderFemale,
					Name:   "Mommy",
					Type:   model.CatTypeStreet,
				},
				model.Cat{
					Class:  model.ClassMammal,
					Gender: model.GenderFemale,
					Name:   "Terry",
					Type:   model.CatTypeHome,
				},
				model.Cat{
					Class:  model.ClassMammal,
					Gender: model.GenderFemale,
					Name:   "Tilda",
					Type:   model.CatTypeHome,
				},
				model.Cat{
					Class:  model.ClassMammal,
					Gender: model.GenderMale,
					Name:   "Vasya",
					Type:   model.CatTypeHome,
				},
			},
		},
	},
	{
		ID: 7,
		Details: &model.Details{
			Forename:    "Suvij",
			Surname:     "Surya",
			HasChildren: false,
			Nationality: model.NationalityIndian,
		},
	},
	{
		ID: 8,
		Details: &model.Details{
			Forename:    "Nithin",
			Surname:     "Kumar",
			HasChildren: false,
			Nationality: model.NationalityIndian,
		},
	},
	{
		ID: 9,
		Details: &model.Details{
			Forename:      "Alberto",
			Surname:       "Garcia Hierro",
			HasChildren:   true,
			MaritalStatus: &married,
			Nationality:   model.NationalitySpanish,
			Pets: []model.Pet{
				model.Cat{
					Class:  model.ClassMammal,
					Gender: model.GenderMale,
					Name:   "Thor",
					Type:   model.CatTypeHome,
				},
			},
		},
	},
	{
		ID: 10,
		Details: &model.Details{
			Forename:    "Eelco",
			Surname:     "Wiersma",
			HasChildren: false,
			Nationality: model.NationalityDutch,
			Pets: []model.Pet{
				model.Mouse{
					Class:  model.ClassMammal,
					Gender: model.GenderUnknown,
					Name:   "Vanson",
				},
			},
		},
	},
	{
		ID: 11,
		Details: &model.Details{
			Forename:      "Alexandra",
			Surname:       "Neuse",
			HasChildren:   true,
			MaritalStatus: &married,
			Nationality:   model.NationalityGerman,
		},
	},
	{
		ID: 12,
		Details: &model.Details{
			Forename:      "David",
			Surname:       "Stutt",
			HasChildren:   false,
			MaritalStatus: &married,
			Nationality:   model.NationalityEnglish,
			Pets: []model.Pet{
				model.Cat{
					Class:  model.ClassMammal,
					Gender: model.GenderFemale,
					Name:   "Pepper",
					Type:   model.CatTypeHome,
				},
			},
		},
	},
}
