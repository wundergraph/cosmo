package subgraph

// This file will be automatically regenerated based on the schema, any resolver implementations
// will be copied through when generating and any unknown code will be moved to the end.
// Code generated by github.com/99designs/gqlgen version v0.17.63

import (
	"context"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/countries/subgraph/generated"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/countries/subgraph/model"
)

// FindCountryByKeyName is the resolver for the findCountryByKeyName field.
func (r *entityResolver) FindCountryByKeyName(ctx context.Context, keyName string) (*model.Country, error) {
	for _, country := range countries {
		if country.Key.Name == keyName {
			return country, nil
		}
	}

	return nil, nil
}

// Entity returns generated.EntityResolver implementation.
func (r *Resolver) Entity() generated.EntityResolver { return &entityResolver{r} }

type entityResolver struct{ *Resolver }
