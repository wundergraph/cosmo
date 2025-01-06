package subgraph

// This file will be automatically regenerated based on the schema, any resolver implementations
// will be copied through when generating and any unknown code will be moved to the end.
// Code generated by github.com/99designs/gqlgen version v0.17.49

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/wundergraph/cosmo/demo/pkg/injector"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/test1/subgraph/generated"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/test1/subgraph/model"
)

// HeaderValue is the resolver for the headerValue field.
func (r *queryResolver) HeaderValue(ctx context.Context, name string) (string, error) {
	header := injector.Header(ctx)
	if header == nil {
		return "", errors.New("headers not injected into context.Context")
	}
	return header.Get(name), nil
}

// InitPayloadValue is the resolver for the initPayloadValue field.
func (r *queryResolver) InitPayloadValue(ctx context.Context, key string) (string, error) {
	payload := injector.InitPayload(ctx)
	if payload == nil {
		return "", errors.New("payload not injected into context.Context")
	}
	return fmt.Sprintf("%v", payload[key]), nil
}

// InitialPayload is the resolver for the initialPayload field.
func (r *queryResolver) InitialPayload(ctx context.Context) (map[string]interface{}, error) {
	payload := injector.InitPayload(ctx)
	if payload == nil {
		return nil, errors.New("payload not injected into context.Context")
	}
	return payload, nil
}

// Delay is the resolver for the delay field.
func (r *queryResolver) Delay(ctx context.Context, response string, ms int) (string, error) {
	time.Sleep(time.Duration(ms) * time.Millisecond)
	return response, nil
}

// BigResponse is the resolver for the bigResponse field.
func (r *queryResolver) BigResponse(ctx context.Context, artificialDelay int, bigObjects int, nestedObjects int, deeplyNestedObjects int) ([]*model.BigObject, error) {
	if artificialDelay > 0 {
		time.Sleep(time.Duration(artificialDelay) * time.Millisecond)
	}
	big := make([]*model.BigObject, bigObjects)
	for i := 0; i < bigObjects; i++ {
		nested := make([]*model.NestedObject, nestedObjects)
		for i := 0; i < nestedObjects; i++ {
			deeplyNested := make([]*model.DeeplyNestedObject, deeplyNestedObjects)
			for i := 0; i < deeplyNestedObjects; i++ {
				deeplyNested[i] = &deeplyNestedObject
			}
			nested[i] = &model.NestedObject{
				DeeplyNestedObjects: deeplyNested,
			}
		}
		big[i] = &model.BigObject{
			NestedObjects: nested,
		}
	}
	return big, nil
}

// BigAbstractResponse is the resolver for the bigAbstractResponse field.
func (r *queryResolver) BigAbstractResponse(ctx context.Context) (model.BigAbstractResponse, error) {
	return aBigObject, nil
}

// RootFieldWithListArg is the resolver for the rootFieldWithListArg field.
func (r *queryResolver) RootFieldWithListArg(ctx context.Context, arg []string) ([]string, error) {
	return arg, nil
}

// RootFieldWithNestedListArg is the resolver for the rootFieldWithNestedListArg field.
func (r *queryResolver) RootFieldWithNestedListArg(ctx context.Context, arg [][]string) ([][]string, error) {
	return arg, nil
}

// RootFieldWithListOfInputArg is the resolver for the rootFieldWithListOfInputArg field.
func (r *queryResolver) RootFieldWithListOfInputArg(ctx context.Context, arg []*model.InputType) ([]*model.InputResponse, error) {
	res := make([]*model.InputResponse, len(arg))
	for i, a := range arg {
		res[i] = &model.InputResponse{
			Arg: a.Arg,
		}
	}
	return res, nil
}

// RootFieldWithListOfEnumArg is the resolver for the rootFieldWithListOfEnumArg field.
func (r *queryResolver) RootFieldWithListOfEnumArg(ctx context.Context, arg []model.EnumType) ([]model.EnumType, error) {
	return arg, nil
}

// RootFieldWithInput is the resolver for the rootFieldWithInput field.
func (r *queryResolver) RootFieldWithInput(ctx context.Context, arg model.InputArg) (string, error) {
	if arg.String != nil {
		return *arg.String, nil
	}
	if len(arg.Strings) > 0 {
		return strings.Join(arg.Strings, ","), nil
	}
	if arg.Enum != nil {
		return arg.Enum.String(), nil
	}
	if len(arg.Enums) > 0 {
		var res []string
		for _, e := range arg.Enums {
			res = append(res, e.String())
		}
		return strings.Join(res, ","), nil
	}
	return "empty arg", nil
}

// FloatField is the resolver for the floatField field.
func (r *queryResolver) FloatField(ctx context.Context, arg *float64) (*float64, error) {
	return arg, nil
}

// SharedThings is the resolver for the sharedThings field.
func (r *queryResolver) SharedThings(ctx context.Context, numOfA int, numOfB int) ([]*model.Thing, error) {
	things := make([]*model.Thing, 0, numOfB)
	for i := 0; i < numOfB; i++ {
		thing := &model.Thing{
			B: fmt.Sprintf("b-%d", i),
		}
		things = append(things, thing)
	}
	return things, nil
}

// HeaderValue is the resolver for the headerValue field.
func (r *subscriptionResolver) HeaderValue(ctx context.Context, name string, repeat *int) (<-chan *model.TimestampedString, error) {
	header := injector.Header(ctx)
	if header == nil {
		return nil, errors.New("headers not injected into context.Context")
	}
	ch := make(chan *model.TimestampedString, 1)

	if repeat == nil {
		repeat = new(int)
		*repeat = 1
	}

	payload := injector.InitPayload(ctx)
	if payload == nil {
		payload = map[string]any{}
	}

	go func() {
		defer close(ch)

		for ii := 0; ii < *repeat; ii++ {
			// In our example we'll send the current time every second.
			time.Sleep(100 * time.Millisecond)
			select {
			case <-ctx.Done():
				return

			case ch <- &model.TimestampedString{
				Value:          header.Get(name),
				UnixTime:       int(time.Now().Unix()),
				Seq:            ii,
				Total:          *repeat,
				InitialPayload: payload,
			}:
			}
		}
	}()
	return ch, nil
}

// InitPayloadValue is the resolver for the initPayloadValue field.
func (r *subscriptionResolver) InitPayloadValue(ctx context.Context, key string, repeat *int) (<-chan *model.TimestampedString, error) {
	payload := injector.InitPayload(ctx)
	if payload == nil {
		return nil, errors.New("payload not injected into context.Context")
	}
	ch := make(chan *model.TimestampedString, 1)

	if repeat == nil {
		repeat = new(int)
		*repeat = 1
	}

	go func() {
		defer close(ch)

		for ii := 0; ii < *repeat; ii++ {
			// In our example we'll send the current time every second.
			time.Sleep(100 * time.Millisecond)
			select {
			case <-ctx.Done():
				return

			case ch <- &model.TimestampedString{
				Value:          fmt.Sprintf("%v", payload[key]),
				UnixTime:       int(time.Now().Unix()),
				Seq:            ii,
				Total:          *repeat,
				InitialPayload: payload,
			}:
			}
		}
	}()
	return ch, nil
}

// InitialPayload is the resolver for the initialPayload field.
func (r *subscriptionResolver) InitialPayload(ctx context.Context, repeat *int) (<-chan map[string]interface{}, error) {
	payload := injector.InitPayload(ctx)
	if payload == nil {
		payload = make(map[string]any)
	}
	ch := make(chan map[string]any, 1)

	if repeat == nil {
		repeat = new(int)
		*repeat = 1
	}

	go func() {
		defer close(ch)

		for ii := 0; ii < *repeat; ii++ {
			// In our example we'll send the current time every second.
			time.Sleep(100 * time.Millisecond)
			select {
			case <-ctx.Done():
				return

			case ch <- payload:

			}
		}
	}()
	return ch, nil
}

// ReturnsError is the resolver for the returnsError field.
func (r *subscriptionResolver) ReturnsError(ctx context.Context) (<-chan *string, error) {
	return nil, errors.New("this is an error")
}

// Query returns generated.QueryResolver implementation.
func (r *Resolver) Query() generated.QueryResolver { return &queryResolver{r} }

// Subscription returns generated.SubscriptionResolver implementation.
func (r *Resolver) Subscription() generated.SubscriptionResolver { return &subscriptionResolver{r} }

type queryResolver struct{ *Resolver }
type subscriptionResolver struct{ *Resolver }

// !!! WARNING !!!
// The code below was going to be deleted when updating resolvers. It has been copied here so you have
// one last chance to move it out of harms way if you want. There are two reasons this happens:
//   - When renaming or deleting a resolver the old code will be put in here. You can safely delete
//     it when you're done.
//   - You have helper methods in this file. Move them out to keep these resolver files clean.
var (
	aBigObject = &model.ABigObject{
		AFieldOnABigObject: "a field on a big object - lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum",
		BFieldOnABigObject: 1,
		CFieldOnABigObject: true,
		DFieldOnABigObject: 2,
		EFieldOnABigObject: "e field on a big object - lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum",
		FFieldOnABigObject: 3,
		GFieldOnABigObject: true,
		HFieldOnABigObject: 4,
		IFieldOnABigObject: "i field on a big object - lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum",
		JFieldOnABigObject: 5,
		KFieldOnABigObject: true,
		LFieldOnABigObject: 6,
		MFieldOnABigObject: "m field on a big object - lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum",
		NFieldOnABigObject: 7,
		OFieldOnABigObject: true,
		PFieldOnABigObject: 8,
		QFieldOnABigObject: "q field on a big object - lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum",
		RFieldOnABigObject: 9,
		SFieldOnABigObject: true,
		TFieldOnABigObject: 10,
		UFieldOnABigObject: "u field on a big object - lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum",
		VFieldOnABigObject: 11,
		WFieldOnABigObject: true,
		XFieldOnABigObject: 12,
		YFieldOnABigObject: "y field on a big object - lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum",
		ZFieldOnABigObject: 13,
	}
)
var (
	deeplyNestedObject = model.DeeplyNestedObject{
		AFieldOnDeeplyNestedObject: "a field on deeply nested object - lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum",
		BFieldOnDeeplyNestedObject: 1,
		CFieldOnDeeplyNestedObject: true,
		DFieldOnDeeplyNestedObject: 2,
		EFieldOnDeeplyNestedObject: "e field on deeply nested object - lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum",
		FFieldOnDeeplyNestedObject: 3,
		GFieldOnDeeplyNestedObject: false,
		HFieldOnDeeplyNestedObject: 4,
		IFieldOnDeeplyNestedObject: "i field on deeply nested object - lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum",
		JFieldOnDeeplyNestedObject: 5,
		KFieldOnDeeplyNestedObject: true,
		LFieldOnDeeplyNestedObject: 6,
		MFieldOnDeeplyNestedObject: "m field on deeply nested object - lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum",
		NFieldOnDeeplyNestedObject: 7,
		OFieldOnDeeplyNestedObject: false,
		PFieldOnDeeplyNestedObject: 8,
		QFieldOnDeeplyNestedObject: "q field on deeply nested object - lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum",
		RFieldOnDeeplyNestedObject: 9,
		SFieldOnDeeplyNestedObject: true,
		TFieldOnDeeplyNestedObject: 10,
		UFieldOnDeeplyNestedObject: "u field on deeply nested object - lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum",
		VFieldOnDeeplyNestedObject: 11,
		WFieldOnDeeplyNestedObject: false,
		XFieldOnDeeplyNestedObject: 12,
		YFieldOnDeeplyNestedObject: "y field on deeply nested object - lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum",
		ZFieldOnDeeplyNestedObject: 13,
	}
)
