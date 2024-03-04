package subgraph

import "github.com/wundergraph/cosmo/demo/pkg/subgraphs/hobbies/subgraph/model"

var employees = []*model.Employee{
	{
		// Jens
		ID: 1,
		Hobbies: []model.Hobby{
			model.Exercise{
				Category: model.ExerciseTypeSport,
			},
			model.Gaming{
				Genres: []model.GameGenre{
					model.GameGenreFps,
				},
				Name:              "Counter Strike",
				YearsOfExperience: 20.0,
			},
			model.Other{
				Name: "WunderGraph",
			},
			model.Programming{
				Languages: []model.ProgrammingLanguage{
					model.ProgrammingLanguageGo,
					model.ProgrammingLanguageTypescript,
				},
			},
			model.Travelling{
				CountriesLived: []*model.Country{
					{
						Key: &model.CountryKey{
							Name: "England",
						},
					},
					{
						Key: &model.CountryKey{
							Name: "Germany",
						},
					},
				},
			},
		},
	},
	{
		// Dustin
		ID: 2,
		Hobbies: []model.Hobby{
			model.Exercise{
				Category: model.ExerciseTypeStrengthTraining,
			},
			model.Gaming{
				Genres: []model.GameGenre{
					model.GameGenreFps,
				},
				Name:              "Counter Strike",
				YearsOfExperience: 0.5,
			},
			model.Programming{
				Languages: []model.ProgrammingLanguage{
					model.ProgrammingLanguageGo,
					model.ProgrammingLanguageRust,
				},
			},
		},
	},
	{
		// Stefan
		ID: 3,
		Hobbies: []model.Hobby{
			model.Exercise{
				Category: model.ExerciseTypeHiking,
			},
			model.Exercise{
				Category: model.ExerciseTypeSport,
			},
			model.Other{
				Name: "Reading",
			},
			model.Travelling{
				CountriesLived: []*model.Country{
					{
						Key: &model.CountryKey{
							Name: "America",
						},
					},
					{
						Key: &model.CountryKey{
							Name: "Serbia",
						},
					},
				},
			},
		},
	},
	{
		// Björn
		ID: 4,
		Hobbies: []model.Hobby{
			model.Exercise{
				Category: model.ExerciseTypeHiking,
			},
			model.Flying{
				PlaneModels: []string{
					"Aquila AT01", "Cessna C172", "Cessna C206", "Cirrus SR20", "Cirrus SR22",
					"Diamond DA40", "Diamond HK36", "Diamond DA20", "Piper Cub", "Pitts Special", "Robin DR400",
				},
				YearsOfExperience: 20.0,
			},
			model.Travelling{
				CountriesLived: []*model.Country{
					{
						Key: &model.CountryKey{
							Name: "America",
						},
					},
					{
						Key: &model.CountryKey{
							Name: "Germany",
						},
					},
				},
			},
		},
	},
	{
		// Sergiy
		ID: 5,
		Hobbies: []model.Hobby{
			model.Other{
				Name: "Building a house",
			},
			model.Other{
				Name: "Forumla 1",
			},
			model.Other{
				Name: "Raising cats",
			},
		},
	},
	{
		// Suvij
		ID: 7,
		Hobbies: []model.Hobby{
			model.Gaming{
				Genres: []model.GameGenre{
					model.GameGenreBoard,
				},
				Name:              "Chess",
				YearsOfExperience: 9.5,
			},
			model.Other{
				Name: "Watching anime",
			},
		},
	},
	{
		// Nithin
		ID: 8,
		Hobbies: []model.Hobby{
			model.Exercise{
				Category: model.ExerciseTypeStrengthTraining,
			},
			model.Gaming{
				Genres: []model.GameGenre{
					model.GameGenreAdventure, model.GameGenreRpg, model.GameGenreSimulation, model.GameGenreStrategy,
				},
				Name:              "Miscellaneous",
				YearsOfExperience: 17.0,
			},
			model.Other{
				Name: "Watching anime",
			},
		},
	},
	{
		// Eelco
		ID: 10,
		Hobbies: []model.Hobby{
			model.Programming{
				Languages: []model.ProgrammingLanguage{
					model.ProgrammingLanguageTypescript,
				},
			},
			model.Exercise{
				Category: model.ExerciseTypeCalisthenics,
			},
			model.Exercise{
				Category: model.ExerciseTypeHiking,
			},
			model.Exercise{
				Category: model.ExerciseTypeStrengthTraining,
			},
			model.Other{
				Name: "saas-ui",
			},
			model.Travelling{
				CountriesLived: []*model.Country{
					{
						Key: &model.CountryKey{
							Name: "Germany",
						},
					},
					{
						Key: &model.CountryKey{
							Name: "Indonesia",
						},
					},
					{
						Key: &model.CountryKey{
							Name: "Netherlands",
						},
					},

					{
						Key: &model.CountryKey{
							Name: "Portugal",
						},
					},
					{
						Key: &model.CountryKey{
							Name: "Spain",
						},
					},
					{
						Key: &model.CountryKey{
							Name: "Thailand",
						},
					},
				},
			},
		},
	},
	{
		// Alexandra
		ID: 11,
		Hobbies: []model.Hobby{
			model.Other{
				Name: "Spending time with the family",
			},
		},
	},
	{
		// David
		ID: 12,
		Hobbies: []model.Hobby{
			model.Programming{
				Languages: model.AllProgrammingLanguage,
			},
			model.Exercise{
				Category: model.ExerciseTypeStrengthTraining,
			},
			model.Gaming{
				Genres: []model.GameGenre{
					model.GameGenreAdventure, model.GameGenreBoard, model.GameGenreCard, model.GameGenreRoguelite,
					model.GameGenreRpg, model.GameGenreSimulation, model.GameGenreStrategy,
				},
				Name:              "Miscellaneous",
				YearsOfExperience: 25.5,
			},
			model.Travelling{
				CountriesLived: []*model.Country{
					{
						Key: &model.CountryKey{
							Name: "England",
						},
					},
					{
						Key: &model.CountryKey{
							Name: "Korea",
						},
					},
					{
						Key: &model.CountryKey{
							Name: "Taiwan",
						},
					},
				},
			},
		},
	},
}
