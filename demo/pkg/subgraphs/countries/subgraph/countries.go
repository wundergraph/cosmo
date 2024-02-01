package subgraph

import "github.com/wundergraph/cosmo/demo/pkg/subgraphs/countries/subgraph/model"

func strToPtr(s string) *string {
	return &s
}

var countries = []*model.Country{
	{
		Key: &model.CountryKey{
			Name: "America",
		},
		Language: strToPtr("English"),
	},
	{
		Key: &model.CountryKey{
			Name: "England",
		},
		Language: strToPtr("English"),
	},
	{
		Key: &model.CountryKey{
			Name: "Germany",
		},
		Language: strToPtr("German"),
	},
	{
		Key: &model.CountryKey{
			Name: "India",
		},
		Language: strToPtr("Hindi"),
	},
	{
		Key: &model.CountryKey{
			Name: "Netherlands",
		},
		Language: strToPtr("Dutch"),
	},
	{
		Key: &model.CountryKey{
			Name: "Portugal",
		},
		Language: strToPtr("Portuguese"),
	},
	{
		Key: &model.CountryKey{
			Name: "Spain",
		},
		Language: strToPtr("Spanish"),
	},
	{
		Key: &model.CountryKey{
			Name: "Ukraine",
		},
		Language: strToPtr("Ukrainian"),
	},
	{
		Key: &model.CountryKey{
			Name: "Indonesia",
		},
		Language: strToPtr("Indonesian"),
	},
	{
		Key: &model.CountryKey{
			Name: "Thailand",
		},
		Language: strToPtr("Thai"),
	},
	{
		Key: &model.CountryKey{
			Name: "Korea",
		},
		Language: strToPtr("Korean"),
	},
	{
		Key: &model.CountryKey{
			Name: "Taiwan",
		},
		Language: strToPtr("Taiwanese"),
	},
}
