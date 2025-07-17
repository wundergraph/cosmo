package core

import (
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// StreamHookError is used to customize the error messages and the behavior
type StreamHookError struct {
	HttpError         HttpError
	CloseSubscription bool
}

func (e *StreamHookError) Error() string {
	return e.HttpError.Error()
}

type SubscriptionOnStartHookContext interface {
	// the request context
	RequestContext() RequestContext
	// the subscription event configuration
	SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration
	// write an event to the stream of the current subscription
	WriteEvent(event datasource.StreamEvent)
}

type subscriptionOnStartHookContext struct {
	requestContext                 RequestContext
	subscriptionEventConfiguration datasource.SubscriptionEventConfiguration
	events                         []datasource.StreamEvent
}

func (c *subscriptionOnStartHookContext) RequestContext() RequestContext {
	return c.requestContext
}

func (c *subscriptionOnStartHookContext) SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration {
	return c.subscriptionEventConfiguration
}

func (c *subscriptionOnStartHookContext) WriteEvent(event datasource.StreamEvent) {
	c.events = append(c.events, event)
}

type SubscriptionOnStartHandler interface {
	// OnSubscriptionOnStart is called once at subscription start
	// Returning an error will result in a GraphQL error being returned to the client, could be customized returning a StreamHookError.
	SubscriptionOnStart(ctx SubscriptionOnStartHookContext) error
}

//write a method that converts from func(ctx SubscriptionOnStartHookContext) error to func(ctx *resolve.Context, event StreamEvent) error

func callSubscriptionOnStart(fn func(ctx SubscriptionOnStartHookContext) error) func(resolveCtx *resolve.Context, subConf datasource.SubscriptionEventConfiguration) (error, []datasource.StreamEvent) {
	return func(resolveCtx *resolve.Context, subConf datasource.SubscriptionEventConfiguration) (error, []datasource.StreamEvent) {
		requestContext := getRequestContext(resolveCtx.Context())
		hookCtx := &subscriptionOnStartHookContext{
			requestContext:                 requestContext,
			subscriptionEventConfiguration: subConf,
		}

		err := fn(hookCtx)

		return err, hookCtx.events
	}
}
