package subgraph

import "github.com/wundergraph/cosmo/demo/hobbies/subgraph/model"

var employees = []*model.Employee{
	{
		// Jens
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
				CountriesLived: []model.Country{
					model.CountryEngland, model.CountryGermany,
				},
			},
		},
	},
	{
		// Dustin
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
				CountriesLived: []model.Country{
					model.CountryAmerica, model.CountrySerbia,
				},
			},
		},
	},
	{
		// Björn
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
				CountriesLived: []model.Country{
					model.CountryAmerica, model.CountryGermany,
				},
			},
		},
	},
	{
		// Sergiy
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
		// Alberto
		Hobbies: []model.Hobby{
			model.Exercise{
				Category: model.ExerciseTypeCalisthenics,
			},
			model.Gaming{
				Genres: []model.GameGenre{
					model.GameGenreBoard,
				},
				Name:              "Chess",
				YearsOfExperience: 2.0,
			},
			model.Programming{
				Languages: []model.ProgrammingLanguage{
					model.ProgrammingLanguageRust,
				},
			},
		},
	},
	{
		// Eelco
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
				CountriesLived: []model.Country{
					model.CountryGermany, model.CountryIndonesia, model.CountryNetherlands,
					model.CountryPortugal, model.CountrySpain, model.CountryThailand,
				},
			},
		},
	},
	{
		// Alexandra
		Hobbies: []model.Hobby{
			model.Other{
				Name: "Spending time with the family",
			},
		},
	},
	{
		// David
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
				CountriesLived: []model.Country{
					model.CountryEngland, model.CountryKorea, model.CountryTaiwan,
				},
			},
		},
	},
	{
		// Dani
		Hobbies: []model.Hobby{
			model.Other{
				Name: "Watching anime",
			},
		},
	},
}
