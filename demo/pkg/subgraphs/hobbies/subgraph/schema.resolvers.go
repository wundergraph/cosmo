package subgraph

// This file will be automatically regenerated based on the schema, any resolver implementations
// will be copied through when generating and any unknown code will be moved to the end.
// Code generated by github.com/99designs/gqlgen version v0.17.49

import (
	"context"
	"time"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/hobbies/subgraph/generated"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/hobbies/subgraph/model"
)

// Employees is the resolver for the employees field.
func (r *exerciseResolver) Employees(ctx context.Context, obj *model.Exercise) ([]*model.Employee, error) {
	return r.Resolver.Employees(obj)
}

// Employees is the resolver for the employees field.
func (r *flyingResolver) Employees(ctx context.Context, obj *model.Flying) ([]*model.Employee, error) {
	return r.Resolver.Employees(obj)
}

// Employees is the resolver for the employees field.
func (r *gamingResolver) Employees(ctx context.Context, obj *model.Gaming) ([]*model.Employee, error) {
	return r.Resolver.Employees(obj)
}

// Employees is the resolver for the employees field.
func (r *otherResolver) Employees(ctx context.Context, obj *model.Other) ([]*model.Employee, error) {
	return r.Resolver.Employees(obj)
}

// Employees is the resolver for the employees field.
func (r *programmingResolver) Employees(ctx context.Context, obj *model.Programming) ([]*model.Employee, error) {
	return r.Resolver.Employees(obj)
}

// CountHob is the resolver for the countHob field.
func (r *subscriptionResolver) CountHob(ctx context.Context, max int, intervalMilliseconds int) (<-chan int, error) {
	ch := make(chan int)

	go func() {
		defer close(ch)

		for i := 0; i <= max; i++ {
			select {
			case <-ctx.Done():
				return
			case ch <- i:
				time.Sleep(time.Duration(intervalMilliseconds) * time.Millisecond)
			}
		}
	}()

	return ch, nil
}

// Employees is the resolver for the employees field.
func (r *travellingResolver) Employees(ctx context.Context, obj *model.Travelling) ([]*model.Employee, error) {
	return r.Resolver.Employees(obj)
}

// Exercise returns generated.ExerciseResolver implementation.
func (r *Resolver) Exercise() generated.ExerciseResolver { return &exerciseResolver{r} }

// Flying returns generated.FlyingResolver implementation.
func (r *Resolver) Flying() generated.FlyingResolver { return &flyingResolver{r} }

// Gaming returns generated.GamingResolver implementation.
func (r *Resolver) Gaming() generated.GamingResolver { return &gamingResolver{r} }

// Other returns generated.OtherResolver implementation.
func (r *Resolver) Other() generated.OtherResolver { return &otherResolver{r} }

// Programming returns generated.ProgrammingResolver implementation.
func (r *Resolver) Programming() generated.ProgrammingResolver { return &programmingResolver{r} }

// Subscription returns generated.SubscriptionResolver implementation.
func (r *Resolver) Subscription() generated.SubscriptionResolver { return &subscriptionResolver{r} }

// Travelling returns generated.TravellingResolver implementation.
func (r *Resolver) Travelling() generated.TravellingResolver { return &travellingResolver{r} }

type exerciseResolver struct{ *Resolver }
type flyingResolver struct{ *Resolver }
type gamingResolver struct{ *Resolver }
type otherResolver struct{ *Resolver }
type programmingResolver struct{ *Resolver }
type subscriptionResolver struct{ *Resolver }
type travellingResolver struct{ *Resolver }
