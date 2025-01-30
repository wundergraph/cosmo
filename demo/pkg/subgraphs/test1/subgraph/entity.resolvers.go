package subgraph

// This file will be automatically regenerated based on the schema, any resolver implementations
// will be copied through when generating and any unknown code will be moved to the end.
// Code generated by github.com/99designs/gqlgen version v0.17.63

import (
	"context"
	"fmt"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/test1/subgraph/generated"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/test1/subgraph/model"
)

// FindEmployeeByID is the resolver for the findEmployeeByID field.
func (r *entityResolver) FindEmployeeByID(ctx context.Context, id int) (*model.Employee, error) {
	return nil, fmt.Errorf("error resolving FindEmployeeByID for id %d", id)
}

// Entity returns generated.EntityResolver implementation.
func (r *Resolver) Entity() generated.EntityResolver { return &entityResolver{r} }

type entityResolver struct{ *Resolver }
