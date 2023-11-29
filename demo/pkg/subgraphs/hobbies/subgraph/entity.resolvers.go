package subgraph

// This file will be automatically regenerated based on the schema, any resolver implementations
// will be copied through when generating and any unknown code will be moved to the end.
// Code generated by github.com/99designs/gqlgen version v0.17.39

import (
	"context"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/hobbies/subgraph/generated"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/hobbies/subgraph/model"
)

// FindEmployeeByID is the resolver for the findEmployeeByID field.
func (r *entityResolver) FindEmployeeByID(ctx context.Context, id int) (*model.Employee, error) {
	if id < 1 {
		return nil, nil
	}
	for _, employee := range employees {
		if id == employee.ID {
			return employee, nil
		}
	}
	return nil, nil
}

// FindSDKByUpc is the resolver for the findSDKByUpc field.
func (r *entityResolver) FindSDKByUpc(ctx context.Context, upc string) (*model.Sdk, error) {
	return &model.Sdk{
		Upc: "sdk",
		ClientLanguages: []model.ProgrammingLanguage{
			model.ProgrammingLanguageRust,
			model.ProgrammingLanguageTypescript,
		},
	}, nil
}

// Entity returns generated.EntityResolver implementation.
func (r *Resolver) Entity() generated.EntityResolver { return &entityResolver{r} }

type entityResolver struct{ *Resolver }
