package core

import (
	"context"
	"errors"

	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// StreamHookError is used to customize the error messages and the behavior
type StreamHookError struct {
	err               error
	message           string
	statusCode        int
	code              string
	closeSubscription bool
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

func (e *StreamHookError) CloseSubscription() bool {
	return e.closeSubscription
}

func NewStreamHookError(err error, message string, statusCode int, code string, closeSubscription bool) *StreamHookError {
	return &StreamHookError{
		err:               err,
		message:           message,
		statusCode:        statusCode,
		code:              code,
		closeSubscription: closeSubscription,
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

type pubSubPublishEventHookContext struct {
	requestContext            RequestContext
	publishEventConfiguration datasource.PublishEventConfiguration
}

func (c *pubSubPublishEventHookContext) RequestContext() RequestContext {
	return c.requestContext
}

func (c *pubSubPublishEventHookContext) PublishEventConfiguration() datasource.PublishEventConfiguration {
	return c.publishEventConfiguration
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
	// If the error is a StreamHookError and CloseSubscription is true, the subscription is closed.
	// The error is propagated to the client.
	SubscriptionOnStart(ctx SubscriptionOnStartHookContext) error
}

// NewPubSubSubscriptionOnStartHook converts a SubscriptionOnStartHandler to a pubsub.SubscriptionOnStartFn
func NewPubSubSubscriptionOnStartHook(fn func(ctx SubscriptionOnStartHookContext) error) datasource.SubscriptionOnStartFn {
	if fn == nil {
		return nil
	}

	return func(resolveCtx *resolve.Context, subConf datasource.SubscriptionEventConfiguration) (bool, error) {
		requestContext := getRequestContext(resolveCtx.Context())
		hookCtx := &pubSubSubscriptionOnStartHookContext{
			requestContext:                 requestContext,
			subscriptionEventConfiguration: subConf,
			writeEventHook:                 resolveCtx.TryEmitSubscriptionUpdate,
		}

		err := fn(hookCtx)

		// Check if the error is a StreamHookError and should close the connection
		var streamHookErr *StreamHookError
		close := false
		if errors.As(err, &streamHookErr) {
			close = streamHookErr.CloseSubscription()
		}

		return close, err
	}
}

// NewEngineSubscriptionOnStartHook converts a SubscriptionOnStartHandler to a graphql_datasource.SubscriptionOnStartFn
func NewEngineSubscriptionOnStartHook(fn func(ctx SubscriptionOnStartHookContext) error) graphql_datasource.SubscriptionOnStartFn {
	if fn == nil {
		return nil
	}

	return func(resolveCtx *resolve.Context, input []byte) (bool, error) {
		requestContext := getRequestContext(resolveCtx.Context())
		hookCtx := &engineSubscriptionOnStartHookContext{
			requestContext: requestContext,
			writeEventHook: resolveCtx.TryEmitSubscriptionUpdate,
		}

		err := fn(hookCtx)

		// Check if the error is a StreamHookError and should close the connection
		var streamHookErr *StreamHookError
		close := false
		if errors.As(err, &streamHookErr) {
			close = streamHookErr.CloseSubscription()
		}

		return close, err
	}
}

type StreamBatchEventHookContext interface {
	// the request context
	RequestContext() RequestContext
	// the subscription event configuration
	SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration
}

type StreamBatchEventHook interface {
	// OnStreamEvents is called each time a batch of events is received from the provider
	// Returning an error will result in a GraphQL error being returned to the client, could be customized returning a StreamHookError.
	OnStreamEvents(ctx StreamBatchEventHookContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error)
}

type StreamPublishEventHookContext interface {
	// the request context
	RequestContext() RequestContext
	// the publish event configuration
	PublishEventConfiguration() datasource.PublishEventConfiguration
}

type StreamPublishEventHook interface {
	// OnPublishEvents is called each time a batch of events is going to be sent to the provider
	// Returning an error will result in a GraphQL error being returned to the client, could be customized returning a StreamHookError.
	OnPublishEvents(ctx StreamPublishEventHookContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error)
}

func NewPubSubOnPublishEventsHook(fn func(ctx StreamPublishEventHookContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error)) datasource.OnPublishEventsFn {
	if fn == nil {
		return nil
	}

	return func(ctx context.Context, pubConf datasource.PublishEventConfiguration, evts []datasource.StreamEvent) ([]datasource.StreamEvent, error) {
		requestContext := getRequestContext(ctx)
		hookCtx := &pubSubPublishEventHookContext{
			requestContext:            requestContext,
			publishEventConfiguration: pubConf,
		}

		return fn(hookCtx, evts)
	}
}

type pubSubStreamBatchEventHookContext struct {
	requestContext                 RequestContext
	subscriptionEventConfiguration datasource.SubscriptionEventConfiguration
}

func (c *pubSubStreamBatchEventHookContext) RequestContext() RequestContext {
	return c.requestContext
}

func (c *pubSubStreamBatchEventHookContext) SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration {
	return c.subscriptionEventConfiguration
}

func NewPubSubOnStreamEventsHook(fn func(ctx StreamBatchEventHookContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error)) datasource.OnStreamEventsFn {
	if fn == nil {
		return nil
	}

	return func(ctx context.Context, subConf datasource.SubscriptionEventConfiguration, evts []datasource.StreamEvent) ([]datasource.StreamEvent, error) {
		requestContext := getRequestContext(ctx)
		hookCtx := &pubSubStreamBatchEventHookContext{
			requestContext:                 requestContext,
			subscriptionEventConfiguration: subConf,
		}

		return fn(hookCtx, evts)
	}
}
