package core

import (
	"context"
	"net/http"

	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

// StreamHookError is used to customize the error messages and the behavior
type StreamHookError struct {
	err        error
	message    string
	statusCode int
	code       string
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
		err:        err,
		message:    message,
		statusCode: statusCode,
		code:       code,
	}
}

type SubscriptionOnStartHookContext interface {
	// Request is the original request received by the router.
	Request() *http.Request
	// Logger is the logger for the request
	Logger() *zap.Logger
	// Operation is the GraphQL operation
	Operation() OperationContext
	// Authentication is the authentication for the request
	Authentication() authentication.Authentication
	// SubscriptionEventConfiguration is the subscription event configuration (will return nil for engine subscription)
	SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration
	// WriteEvent writes an event to the stream of the current subscription
	// It returns true if the event was written to the stream, false if the event was dropped
	WriteEvent(event datasource.StreamEvent) bool
}

type pubSubPublishEventHookContext struct {
	request                   *http.Request
	logger                    *zap.Logger
	operation                 OperationContext
	authentication            authentication.Authentication
	publishEventConfiguration datasource.PublishEventConfiguration
}

func (c *pubSubPublishEventHookContext) Request() *http.Request {
	return c.request
}

func (c *pubSubPublishEventHookContext) Logger() *zap.Logger {
	return c.logger
}

func (c *pubSubPublishEventHookContext) Operation() OperationContext {
	return c.operation
}

func (c *pubSubPublishEventHookContext) Authentication() authentication.Authentication {
	return c.authentication
}

func (c *pubSubPublishEventHookContext) PublishEventConfiguration() datasource.PublishEventConfiguration {
	return c.publishEventConfiguration
}

type pubSubSubscriptionOnStartHookContext struct {
	request                        *http.Request
	logger                         *zap.Logger
	operation                      OperationContext
	authentication                 authentication.Authentication
	subscriptionEventConfiguration datasource.SubscriptionEventConfiguration
	writeEventHook                 func(data []byte)
}

func (c *pubSubSubscriptionOnStartHookContext) Request() *http.Request {
	return c.request
}

func (c *pubSubSubscriptionOnStartHookContext) Logger() *zap.Logger {
	return c.logger
}

func (c *pubSubSubscriptionOnStartHookContext) Operation() OperationContext {
	return c.operation
}

func (c *pubSubSubscriptionOnStartHookContext) Authentication() authentication.Authentication {
	return c.authentication
}

func (c *pubSubSubscriptionOnStartHookContext) SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration {
	return c.subscriptionEventConfiguration
}

func (c *pubSubSubscriptionOnStartHookContext) WriteEvent(event datasource.StreamEvent) bool {
	c.writeEventHook(event.GetData())

	return true
}

// EngineEvent is the event used to write to the engine subscription
type EngineEvent struct {
	Data []byte
}

func (e *EngineEvent) GetData() []byte {
	return e.Data
}

func (e *EngineEvent) Clone() datasource.StreamEvent {
	e2 := *e
	return &e2
}

type engineSubscriptionOnStartHookContext struct {
	request        *http.Request
	logger         *zap.Logger
	operation      OperationContext
	authentication authentication.Authentication
	writeEventHook func(data []byte)
}

func (c *engineSubscriptionOnStartHookContext) Request() *http.Request {
	return c.request
}

func (c *engineSubscriptionOnStartHookContext) Logger() *zap.Logger {
	return c.logger
}

func (c *engineSubscriptionOnStartHookContext) Operation() OperationContext {
	return c.operation
}

func (c *engineSubscriptionOnStartHookContext) Authentication() authentication.Authentication {
	return c.authentication
}

func (c *engineSubscriptionOnStartHookContext) WriteEvent(event datasource.StreamEvent) bool {
	c.writeEventHook(event.GetData())

	return true
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

	return func(resolveCtx resolve.StartupHookContext, subConf datasource.SubscriptionEventConfiguration) error {
		requestContext := getRequestContext(resolveCtx.Context)
		hookCtx := &pubSubSubscriptionOnStartHookContext{
			request:                        requestContext.Request(),
			logger:                         requestContext.Logger(),
			operation:                      requestContext.Operation(),
			authentication:                 requestContext.Authentication(),
			subscriptionEventConfiguration: subConf,
			writeEventHook:                 resolveCtx.Updater,
		}

		return fn(hookCtx)
	}
}

// NewEngineSubscriptionOnStartHook converts a SubscriptionOnStartHandler to a graphql_datasource.SubscriptionOnStartFn
func NewEngineSubscriptionOnStartHook(fn func(ctx SubscriptionOnStartHookContext) error) graphql_datasource.SubscriptionOnStartFn {
	if fn == nil {
		return nil
	}

	return func(resolveCtx resolve.StartupHookContext, input []byte) error {
		requestContext := getRequestContext(resolveCtx.Context)
		hookCtx := &engineSubscriptionOnStartHookContext{
			request:        requestContext.Request(),
			logger:         requestContext.Logger(),
			operation:      requestContext.Operation(),
			authentication: requestContext.Authentication(),
			writeEventHook: resolveCtx.Updater,
		}

		return fn(hookCtx)
	}
}

type StreamReceiveEventHookContext interface {
	// Request is the original request received by the router.
	Request() *http.Request
	// Logger is the logger for the request
	Logger() *zap.Logger
	// Operation is the GraphQL operation
	Operation() OperationContext
	// Authentication is the authentication for the request
	Authentication() authentication.Authentication
	// SubscriptionEventConfiguration the subscription event configuration
	SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration
}

type StreamReceiveEventHook interface {
	// OnReceiveEvents is called each time a batch of events is received from the provider
	// Returning an error will result in a GraphQL error being returned to the client, could be customized returning a StreamHookError.
	OnReceiveEvents(ctx StreamReceiveEventHookContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error)
}

type StreamPublishEventHookContext interface {
	// Request is the original request received by the router.
	Request() *http.Request
	// Logger is the logger for the request
	Logger() *zap.Logger
	// Operation is the GraphQL operation
	Operation() OperationContext
	// Authentication is the authentication for the request
	Authentication() authentication.Authentication
	// PublishEventConfiguration the publish event configuration
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
			request:                   requestContext.Request(),
			logger:                    requestContext.Logger(),
			operation:                 requestContext.Operation(),
			authentication:            requestContext.Authentication(),
			publishEventConfiguration: pubConf,
		}

		return fn(hookCtx, evts)
	}
}

type pubSubStreamReceiveEventHookContext struct {
	request                        *http.Request
	logger                         *zap.Logger
	operation                      OperationContext
	authentication                 authentication.Authentication
	subscriptionEventConfiguration datasource.SubscriptionEventConfiguration
}

func (c *pubSubStreamReceiveEventHookContext) Request() *http.Request {
	return c.request
}

func (c *pubSubStreamReceiveEventHookContext) Logger() *zap.Logger {
	return c.logger
}

func (c *pubSubStreamReceiveEventHookContext) Operation() OperationContext {
	return c.operation
}

func (c *pubSubStreamReceiveEventHookContext) Authentication() authentication.Authentication {
	return c.authentication
}

func (c *pubSubStreamReceiveEventHookContext) SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration {
	return c.subscriptionEventConfiguration
}

func NewPubSubOnReceiveEventsHook(fn func(ctx StreamReceiveEventHookContext, events []datasource.StreamEvent) ([]datasource.StreamEvent, error)) datasource.OnReceiveEventsFn {
	if fn == nil {
		return nil
	}

	return func(ctx context.Context, subConf datasource.SubscriptionEventConfiguration, evts []datasource.StreamEvent) ([]datasource.StreamEvent, error) {
		requestContext := getRequestContext(ctx)
		hookCtx := &pubSubStreamReceiveEventHookContext{
			request:                        requestContext.Request(),
			logger:                         requestContext.Logger(),
			operation:                      requestContext.Operation(),
			authentication:                 requestContext.Authentication(),
			subscriptionEventConfiguration: subConf,
		}

		return fn(hookCtx, evts)
	}
}
