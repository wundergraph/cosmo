package core

import (
	"context"
	"net/http"
	"slices"

	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

type SubscriptionOnStartHandlerContext interface {
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
	// NewEvent creates a new event that can be used in the subscription.
	NewEvent(data []byte) datasource.MutableStreamEvent
}

type pubSubPublishEventHookContext struct {
	request                   *http.Request
	logger                    *zap.Logger
	operation                 OperationContext
	authentication            authentication.Authentication
	publishEventConfiguration datasource.PublishEventConfiguration
	eventBuilder              datasource.EventBuilderFn
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

func (c *pubSubPublishEventHookContext) NewEvent(data []byte) datasource.MutableStreamEvent {
	return c.eventBuilder(data)
}

type pubSubSubscriptionOnStartHookContext struct {
	request                        *http.Request
	logger                         *zap.Logger
	operation                      OperationContext
	authentication                 authentication.Authentication
	subscriptionEventConfiguration datasource.SubscriptionEventConfiguration
	writeEventHook                 func(data []byte)
	eventBuilder                   datasource.EventBuilderFn
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

func (c *pubSubSubscriptionOnStartHookContext) NewEvent(data []byte) datasource.MutableStreamEvent {
	return c.eventBuilder(data)
}

// MutableEngineEvent is comparable to EngineEvent, but is mutable.
type MutableEngineEvent struct {
	data []byte
}

func (e *MutableEngineEvent) GetData() []byte {
	return e.data
}

func (e *MutableEngineEvent) SetData(data []byte) {
	e.data = data
}

func (e *MutableEngineEvent) Clone() datasource.MutableStreamEvent {
	return &MutableEngineEvent{data: slices.Clone(e.data)}
}

// EngineEvent is the event used to write to the engine subscription
type EngineEvent struct {
	evt *MutableEngineEvent
}

func (e *EngineEvent) GetData() []byte {
	if e.evt == nil {
		return nil
	}
	return slices.Clone(e.evt.data)
}

func (e *EngineEvent) Clone() datasource.MutableStreamEvent {
	if e.evt == nil {
		return &MutableEngineEvent{}
	}
	return e.evt.Clone()
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

func (c *engineSubscriptionOnStartHookContext) NewEvent(data []byte) datasource.MutableStreamEvent {
	return &MutableEngineEvent{data: data}
}

func (c *engineSubscriptionOnStartHookContext) SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration {
	return nil
}

type SubscriptionOnStartHandler interface {
	// SubscriptionOnStart is called once at subscription start
	// The error is propagated to the client.
	SubscriptionOnStart(ctx SubscriptionOnStartHandlerContext) error
}

// NewPubSubSubscriptionOnStartHook converts a SubscriptionOnStartHandler to a pubsub.SubscriptionOnStartFn
func NewPubSubSubscriptionOnStartHook(fn func(ctx SubscriptionOnStartHandlerContext) error) datasource.SubscriptionOnStartFn {
	if fn == nil {
		return nil
	}

	return func(resolveCtx resolve.StartupHookContext, subConf datasource.SubscriptionEventConfiguration, eventBuilder datasource.EventBuilderFn) error {
		requestContext := getRequestContext(resolveCtx.Context)

		logger := requestContext.Logger()
		if logger != nil {
			logger = logger.With(zap.String("component", "pubsub_subscription_on_start_hook"))
			if subConf != nil {
				logger = logger.With(
					zap.String("provider_id", subConf.ProviderID()),
					zap.String("provider_type", string(subConf.ProviderType())),
					zap.String("field_name", subConf.RootFieldName()),
				)
			}
		}

		hookCtx := &pubSubSubscriptionOnStartHookContext{
			request:                        requestContext.Request(),
			logger:                         logger,
			operation:                      requestContext.Operation(),
			authentication:                 requestContext.Authentication(),
			subscriptionEventConfiguration: subConf,
			writeEventHook:                 resolveCtx.Updater,
			eventBuilder:                   eventBuilder,
		}

		return fn(hookCtx)
	}
}

// NewEngineSubscriptionOnStartHook converts a SubscriptionOnStartHandler to a graphql_datasource.SubscriptionOnStartFn
func NewEngineSubscriptionOnStartHook(fn func(ctx SubscriptionOnStartHandlerContext) error) graphql_datasource.SubscriptionOnStartFn {
	if fn == nil {
		return nil
	}

	return func(resolveCtx resolve.StartupHookContext, input []byte) error {
		requestContext := getRequestContext(resolveCtx.Context)

		logger := requestContext.Logger()
		if logger != nil {
			logger = logger.With(zap.String("component", "engine_subscription_on_start_hook"))
		}

		hookCtx := &engineSubscriptionOnStartHookContext{
			request:        requestContext.Request(),
			logger:         logger,
			operation:      requestContext.Operation(),
			authentication: requestContext.Authentication(),
			writeEventHook: resolveCtx.Updater,
		}

		return fn(hookCtx)
	}
}

type StreamReceiveEventHandlerContext interface {
	// Context is a context for handlers.
	// If it is cancelled, the handler should stop processing.
	Context() context.Context
	// Request is the initial client request that started the subscription
	Request() *http.Request
	// Logger is the logger for the request
	Logger() *zap.Logger
	// Operation is the GraphQL operation
	Operation() OperationContext
	// Authentication is the authentication for the request
	Authentication() authentication.Authentication
	// SubscriptionEventConfiguration the subscription event configuration
	SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration
	// NewEvent creates a new event that can be used in the subscription.
	NewEvent(data []byte) datasource.MutableStreamEvent
}

type StreamReceiveEventHandler interface {
	// OnReceiveEvents is called whenever a batch of events is received from a provider,
	// before delivering them to clients.
	// The hook will be called once for each active subscription, therefore it is adviced to
	// avoid resource heavy computation or blocking tasks whenever possible.
	// The events argument contains all events from a batch and is shared between
	// all active subscribers of these events.
	// Use events.All() to iterate through them and event.Clone() to create mutable copies, when needed.
	// Returning an error will result in the subscription being closed and the error being logged.
	OnReceiveEvents(ctx StreamReceiveEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error)
}

type StreamPublishEventHandlerContext interface {
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
	// NewEvent creates a new event that can be used in the subscription.
	NewEvent(data []byte) datasource.MutableStreamEvent
}

type StreamPublishEventHandler interface {
	// OnPublishEvents is called each time a batch of events is going to be sent to a provider.
	// The events argument contains all events from a batch.
	// Use events.All() to iterate through them and event.Clone() to create mutable copies, when needed.
	// Returning an error will result in a GraphQL error being returned to the client, could be customized returning a
	// StreamHookError.
	OnPublishEvents(ctx StreamPublishEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error)
}

func NewPubSubOnPublishEventsHook(fn func(ctx StreamPublishEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error)) datasource.OnPublishEventsFn {
	if fn == nil {
		return nil
	}

	return func(ctx context.Context, pubConf datasource.PublishEventConfiguration, evts []datasource.StreamEvent, eventBuilder datasource.EventBuilderFn) ([]datasource.StreamEvent, error) {
		requestContext := getRequestContext(ctx)

		logger := requestContext.Logger()
		if logger != nil {
			logger = logger.With(zap.String("component", "on_publish_events_hook"))
			if pubConf != nil {
				logger = logger.With(
					zap.String("provider_id", pubConf.ProviderID()),
					zap.String("provider_type", string(pubConf.ProviderType())),
					zap.String("field_name", pubConf.RootFieldName()),
				)
			}
		}

		hookCtx := &pubSubPublishEventHookContext{
			request:                   requestContext.Request(),
			logger:                    logger,
			operation:                 requestContext.Operation(),
			authentication:            requestContext.Authentication(),
			publishEventConfiguration: pubConf,
			eventBuilder:              eventBuilder,
		}

		newEvts, err := fn(hookCtx, datasource.NewStreamEvents(evts))

		return newEvts.Unsafe(), err
	}
}

type pubSubStreamReceiveEventHookContext struct {
	request                        *http.Request
	logger                         *zap.Logger
	operation                      OperationContext
	authentication                 authentication.Authentication
	subscriptionEventConfiguration datasource.SubscriptionEventConfiguration
	eventBuilder                   datasource.EventBuilderFn
	context                        context.Context
}

func (c *pubSubStreamReceiveEventHookContext) Context() context.Context {
	return c.context
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

func (c *pubSubStreamReceiveEventHookContext) NewEvent(data []byte) datasource.MutableStreamEvent {
	return c.eventBuilder(data)
}

func NewPubSubOnReceiveEventsHook(fn func(ctx StreamReceiveEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error)) datasource.OnReceiveEventsFn {
	if fn == nil {
		return nil
	}

	return func(subscriptionCtx context.Context, updaterCtx context.Context, subConf datasource.SubscriptionEventConfiguration, eventBuilder datasource.EventBuilderFn, evts []datasource.StreamEvent) ([]datasource.StreamEvent, error) {
		requestContext := getRequestContext(subscriptionCtx)

		logger := requestContext.Logger()
		if logger != nil {
			logger = logger.With(zap.String("component", "on_receive_events_hook"))
			if subConf != nil {
				logger = logger.With(
					zap.String("provider_id", subConf.ProviderID()),
					zap.String("provider_type", string(subConf.ProviderType())),
					zap.String("field_name", subConf.RootFieldName()),
				)
			}
		}

		hookCtx := &pubSubStreamReceiveEventHookContext{
			request:                        requestContext.Request(),
			logger:                         logger,
			operation:                      requestContext.Operation(),
			authentication:                 requestContext.Authentication(),
			subscriptionEventConfiguration: subConf,
			eventBuilder:                   eventBuilder,
			context:                        updaterCtx,
		}
		newEvts, err := fn(hookCtx, datasource.NewStreamEvents(evts))
		return newEvts.Unsafe(), err
	}
}
