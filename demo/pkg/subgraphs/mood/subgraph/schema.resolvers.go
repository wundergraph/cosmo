package subgraph

// This file will be automatically regenerated based on the schema, any resolver implementations
// will be copied through when generating and any unknown code will be moved to the end.
// Code generated by github.com/99designs/gqlgen version v0.17.63

import (
	"context"
	"fmt"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/mood/subgraph/generated"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/mood/subgraph/model"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
)

// UpdateMood is the resolver for the updateMood field.
func (r *mutationResolver) UpdateMood(ctx context.Context, employeeID int, mood model.Mood) (*model.Employee, error) {
	storage.Set(employeeID, mood)
	myNatsTopic := r.GetPubSubName(fmt.Sprintf("employeeUpdated.%d", employeeID))
	payload := fmt.Sprintf(`{"id":%d,"__typename": "Employee"}`, employeeID)
	err := r.NatsPubSubByProviderID["default"].Publish(ctx, nats.PublishAndRequestEventConfiguration{
		Subject: myNatsTopic,
		Data:    []byte(payload),
	})
	if err != nil {
		return nil, err
	}

	defaultTopic := r.GetPubSubName(fmt.Sprintf("employeeUpdatedMyNats.%d", employeeID))
	err = r.NatsPubSubByProviderID["my-nats"].Publish(ctx, nats.PublishAndRequestEventConfiguration{
		Subject: defaultTopic,
		Data:    []byte(payload),
	})
	if err != nil {
		return nil, err
	}

	return &model.Employee{ID: employeeID, CurrentMood: mood}, nil
}

// Mutation returns generated.MutationResolver implementation.
func (r *Resolver) Mutation() generated.MutationResolver { return &mutationResolver{r} }

type mutationResolver struct{ *Resolver }
