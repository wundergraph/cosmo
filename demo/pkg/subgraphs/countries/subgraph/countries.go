package subgraph

import "github.com/wundergraph/cosmo/demo/pkg/subgraphs/countries/subgraph/model"

var countries = []*model.Country{
	{
		Key: &model.CountryKey{
			Name: "America",
		},
		Language: new("English"),
	},
	{
		Key: &model.CountryKey{
			Name: "England",
		},
		Language: new("English"),
	},
	{
		Key: &model.CountryKey{
			Name: "Germany",
		},
		Language: new("German"),
	},
	{
		Key: &model.CountryKey{
			Name: "India",
		},
		Language: new("Hindi"),
	},
	{
		Key: &model.CountryKey{
			Name: "Netherlands",
		},
		Language: new("Dutch"),
	},
	{
		Key: &model.CountryKey{
			Name: "Portugal",
		},
		Language: new("Portuguese"),
	},
	{
		Key: &model.CountryKey{
			Name: "Spain",
		},
		Language: new("Spanish"),
	},
	{
		Key: &model.CountryKey{
			Name: "Serbia",
		},
		Language: new("Serbian"),
	},
	{
		Key: &model.CountryKey{
			Name: "Ukraine",
		},
		Language: new("Ukrainian"),
	},
	{
		Key: &model.CountryKey{
			Name: "Indonesia",
		},
		Language: new("Indonesian"),
	},
	{
		Key: &model.CountryKey{
			Name: "Thailand",
		},
		Language: new("Thai"),
	},
	{
		Key: &model.CountryKey{
			Name: "Korea",
		},
		Language: new("Korean"),
	},
	{
		Key: &model.CountryKey{
			Name: "Taiwan",
		},
		Language: new("Taiwanese"),
	},
}
