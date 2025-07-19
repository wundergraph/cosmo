package core

import (
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// SubscriptionHookError is used to customize the error messages and the behavior
type SubscriptionHookError struct {
	HttpError         HttpError
	CloseSubscription bool
}

func (e *SubscriptionHookError) Error() string {
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

type pubSubSubscriptionOnStartHookContext struct {
	requestContext                 RequestContext
	subscriptionEventConfiguration datasource.SubscriptionEventConfiguration
	events                         []datasource.StreamEvent
}

func (c *pubSubSubscriptionOnStartHookContext) RequestContext() RequestContext {
	return c.requestContext
}

func (c *pubSubSubscriptionOnStartHookContext) SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration {
	return c.subscriptionEventConfiguration
}

func (c *pubSubSubscriptionOnStartHookContext) WriteEvent(event datasource.StreamEvent) {
	c.events = append(c.events, event)
}

// EngineEvent is the event used to write to the engine subscription
type EngineEvent struct {
	Data []byte
}

func (e *EngineEvent) GetData() []byte {
	return e.Data
}

type engineSubscriptionOnStartHookContext struct {
	requestContext RequestContext
	events         [][]byte
}

func (c *engineSubscriptionOnStartHookContext) RequestContext() RequestContext {
	return c.requestContext
}

func (c *engineSubscriptionOnStartHookContext) WriteEvent(event datasource.StreamEvent) {
	c.events = append(c.events, event.GetData())
}

func (c *engineSubscriptionOnStartHookContext) SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration {
	return nil
}

type SubscriptionOnStartHandler interface {
	// OnSubscriptionOnStart is called once at subscription start
	// Returning an error will result in a GraphQL error being returned to the client, could be customized returning a StreamHookError.
	SubscriptionOnStart(ctx SubscriptionOnStartHookContext) error
}

// NewPubSubOnSubscriptionStartHook converts a SubscriptionOnStartHandler to a pubsub.OnSubscriptionStartFn
func NewPubSubOnSubscriptionStartHook(fn func(ctx SubscriptionOnStartHookContext) error) datasource.OnSubscriptionStartFn {
	return func(resolveCtx *resolve.Context, subConf datasource.SubscriptionEventConfiguration) ([]datasource.StreamEvent, error) {
		requestContext := getRequestContext(resolveCtx.Context())
		hookCtx := &pubSubSubscriptionOnStartHookContext{
			requestContext:                 requestContext,
			subscriptionEventConfiguration: subConf,
		}

		err := fn(hookCtx)

		return hookCtx.events, err
	}
}

func NewEngineOnSubscriptionStartHook(fn func(ctx SubscriptionOnStartHookContext) error) graphql_datasource.OnSubscriptionStartFn {
	return func(resolveCtx *resolve.Context) ([][]byte, error) {
		requestContext := getRequestContext(resolveCtx.Context())
		hookCtx := &engineSubscriptionOnStartHookContext{
			requestContext: requestContext,
		}

		err := fn(hookCtx)

		return hookCtx.events, err
	}
}
