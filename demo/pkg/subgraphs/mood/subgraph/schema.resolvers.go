package subgraph

// This file will be automatically regenerated based on the schema, any resolver implementations
// will be copied through when generating and any unknown code will be moved to the end.
// Code generated by github.com/99designs/gqlgen version v0.17.39

import (
	"context"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/mood/subgraph/generated"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/mood/subgraph/model"
)

// UpdateMood is the resolver for the updateMood field.
func (r *mutationResolver) UpdateMood(ctx context.Context, employeeID int, mood model.Mood) (*model.Employee, error) {
	storage.Set(employeeID, mood)
	return &model.Employee{ID: employeeID, CurrentMood: mood}, nil
}

// Mutation returns generated.MutationResolver implementation.
func (r *Resolver) Mutation() generated.MutationResolver { return &mutationResolver{r} }

type mutationResolver struct{ *Resolver }
