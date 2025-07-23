package core

import (
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// CustomModuleError is used to customize the error messages and the behavior
type CustomModuleError struct {
	err        error
	message    string
	statusCode int
	code       string
}

func (e *CustomModuleError) Error() string {
	return e.err.Error()
}

func (e *CustomModuleError) Message() string {
	return e.message
}

func (e *CustomModuleError) StatusCode() int {
	return e.statusCode
}

func (e *CustomModuleError) Code() string {
	return e.code
}

func NewCustomModuleError(err error, message string, statusCode int, code string) *CustomModuleError {
	return &CustomModuleError{
		err:        err,
		message:    message,
		statusCode: statusCode,
		code:       code,
	}
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
	writeEventHook                 func(data []byte)
}

func (c *pubSubSubscriptionOnStartHookContext) RequestContext() RequestContext {
	return c.requestContext
}

func (c *pubSubSubscriptionOnStartHookContext) SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration {
	return c.subscriptionEventConfiguration
}

func (c *pubSubSubscriptionOnStartHookContext) WriteEvent(event datasource.StreamEvent) {
	c.writeEventHook(event.GetData())
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
	writeEventHook func(data []byte)
}

func (c *engineSubscriptionOnStartHookContext) RequestContext() RequestContext {
	return c.requestContext
}

func (c *engineSubscriptionOnStartHookContext) WriteEvent(event datasource.StreamEvent) {
	c.writeEventHook(event.GetData())
}

func (c *engineSubscriptionOnStartHookContext) SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration {
	return nil
}

type SubscriptionOnStartHandler interface {
	// OnSubscriptionOnStart is called once at subscription start
	// If the boolean is true, the subscription is closed.
	// The error is propagated to the client.
	SubscriptionOnStart(ctx SubscriptionOnStartHookContext) (bool, error)
}

// NewPubSubOnSubscriptionStartHook converts a SubscriptionOnStartHandler to a pubsub.OnSubscriptionStartFn
func NewPubSubOnSubscriptionStartHook(fn func(ctx SubscriptionOnStartHookContext) (bool, error)) datasource.OnSubscriptionStartFn {
	return func(resolveCtx *resolve.Context, subConf datasource.SubscriptionEventConfiguration) (bool, error) {
		requestContext := getRequestContext(resolveCtx.Context())
		hookCtx := &pubSubSubscriptionOnStartHookContext{
			requestContext:                 requestContext,
			subscriptionEventConfiguration: subConf,
			writeEventHook:                 resolveCtx.EmitSubscriptionUpdate,
		}

		close, err := fn(hookCtx)

		return close, err
	}
}

// NewEngineOnSubscriptionStartHook converts a SubscriptionOnStartHandler to a graphql_datasource.OnSubscriptionStartFn
func NewEngineOnSubscriptionStartHook(fn func(ctx SubscriptionOnStartHookContext) (bool, error)) graphql_datasource.OnSubscriptionStartFn {
	return func(resolveCtx *resolve.Context, input []byte) (bool, error) {
		requestContext := getRequestContext(resolveCtx.Context())
		hookCtx := &engineSubscriptionOnStartHookContext{
			requestContext: requestContext,
			writeEventHook: resolveCtx.EmitSubscriptionUpdate,
		}

		close, err := fn(hookCtx)

		return close, err
	}
}
