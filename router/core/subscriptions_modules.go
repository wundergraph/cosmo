package core

import (
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// StreamHookError is used to customize the error messages and the behavior
type StreamHookError struct {
	err             error
	message         string
	statusCode      int
	code            string
}

func (e *StreamHookError) Error() string {
	if e.err != nil {
		return e.err.Error()
	}
	return e.message
}

func (e *StreamHookError) Message() string {
	return e.message
}

func (e *StreamHookError) StatusCode() int {
	return e.statusCode
}

func (e *StreamHookError) Code() string {
	return e.code
}

func NewStreamHookError(err error, message string, statusCode int, code string) *StreamHookError {
	return &StreamHookError{
		err:             err,
		message:         message,
		statusCode:      statusCode,
		code:            code,
	}
}

type SubscriptionOnStartHookContext interface {
	// the request context
	RequestContext() RequestContext
	// the subscription event configuration (will return nil for engine subscription)
	SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration
	// write an event to the stream of the current subscription
	// returns true if the event was written to the stream, false if the event was dropped
	WriteEvent(event datasource.StreamEvent) bool
}

type pubSubSubscriptionOnStartHookContext struct {
	requestContext                 RequestContext
	subscriptionEventConfiguration datasource.SubscriptionEventConfiguration
	writeEventHook                 func(data []byte) bool
}

func (c *pubSubSubscriptionOnStartHookContext) RequestContext() RequestContext {
	return c.requestContext
}

func (c *pubSubSubscriptionOnStartHookContext) SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration {
	return c.subscriptionEventConfiguration
}

func (c *pubSubSubscriptionOnStartHookContext) WriteEvent(event datasource.StreamEvent) bool {
	return c.writeEventHook(event.GetData())
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
	writeEventHook func(data []byte) bool
}

func (c *engineSubscriptionOnStartHookContext) RequestContext() RequestContext {
	return c.requestContext
}

func (c *engineSubscriptionOnStartHookContext) WriteEvent(event datasource.StreamEvent) bool {
	return c.writeEventHook(event.GetData())
}

func (c *engineSubscriptionOnStartHookContext) SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration {
	return nil
}

type SubscriptionOnStartHandler interface {
	// SubscriptionOnStart is called once at subscription start
	// The error is propagated to the client.
	SubscriptionOnStart(ctx SubscriptionOnStartHookContext) error
}

// NewPubSubSubscriptionOnStartHook converts a SubscriptionOnStartHandler to a pubsub.SubscriptionOnStartFn
func NewPubSubSubscriptionOnStartHook(fn func(ctx SubscriptionOnStartHookContext) error) datasource.SubscriptionOnStartFn {
	if fn == nil {
		return nil
	}

	return func(resolveCtx *resolve.Context, subConf datasource.SubscriptionEventConfiguration) (error) {
		requestContext := getRequestContext(resolveCtx.Context())
		hookCtx := &pubSubSubscriptionOnStartHookContext{
			requestContext:                 requestContext,
			subscriptionEventConfiguration: subConf,
			writeEventHook:                 resolveCtx.TryEmitSubscriptionUpdate,
		}

		return fn(hookCtx)
	}
}

// NewEngineSubscriptionOnStartHook converts a SubscriptionOnStartHandler to a graphql_datasource.SubscriptionOnStartFn
func NewEngineSubscriptionOnStartHook(fn func(ctx SubscriptionOnStartHookContext) error) graphql_datasource.SubscriptionOnStartFn {
	if fn == nil {
		return nil
	}

	return func(resolveCtx *resolve.Context, input []byte) (error) {
		requestContext := getRequestContext(resolveCtx.Context())
		hookCtx := &engineSubscriptionOnStartHookContext{
			requestContext: requestContext,
			writeEventHook: resolveCtx.TryEmitSubscriptionUpdate,
		}

		return fn(hookCtx)
	}
}
