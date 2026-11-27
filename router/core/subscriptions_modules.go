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
	"go.uber.org/zap/zapcore"
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
	// EmitEvent sends an event directly to the subscription stream of the
	// currently connected client.
	//
	// This method triggers the router to resolve the client's operation and emit
	// the resulting data as a stream event. The event exists only within the
	// router; it is not forwarded to any message broker.
	//
	// The event is delivered exclusively to the client associated with the current
	// handler execution. No other subscriptions are affected.
	//
	// The method returns true if the event was successfully emitted, or false if
	// it was dropped.
	EmitEvent(event datasource.StreamEvent) bool
	// NewEvent creates a new event that can be used in the subscription.
	//
	// The data parameter must contain valid JSON bytes. The format depends on the subscription type.
	//
	// For event-driven subscriptions (Cosmo Streams / EDFS), the data should contain:
	// __typename : The name of the schema entity, which is expected to be returned to the client.
	// {keyName} : The key of the entity as configured on the schema via @key directive.
	// Example usage: ctx.NewEvent([]byte(`{"__typename": "Employee", "id": 1}`))
	//
	// For normal subscriptions, you need to provide the complete GraphQL response structure.
	// Example usage: ctx.NewEvent([]byte(`{"data": {"fieldName": value}}`))
	//
	// You can use EmitEvent to emit this event to subscriptions.
	NewEvent(data []byte) datasource.MutableStreamEvent
	// Set stores a value under the given key for this subscription.
	// A value stored in SubscriptionOnStart can be read with Get in SubscriptionOnEnd
	// of the same subscription.
	Set(key string, value any)
	// Get returns the value stored under the given key for this subscription, ie: (value, true).
	// If no value is stored under the key it returns (nil, false).
	Get(key string) (value any, exists bool)
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
	requestContext                 *requestContext
	request                        *http.Request
	logger                         *zap.Logger
	operation                      OperationContext
	authentication                 authentication.Authentication
	subscriptionEventConfiguration datasource.SubscriptionEventConfiguration
	emitEventFn                    func(data []byte)
	eventBuilder                   datasource.EventBuilderFn
}

func (c *pubSubSubscriptionOnStartHookContext) Set(key string, value any) {
	c.requestContext.Set(key, value)
}

func (c *pubSubSubscriptionOnStartHookContext) Get(key string) (value any, exists bool) {
	return c.requestContext.Get(key)
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

func (c *pubSubSubscriptionOnStartHookContext) EmitEvent(event datasource.StreamEvent) bool {
	c.emitEventFn(event.GetData())

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
	requestContext *requestContext
	request        *http.Request
	logger         *zap.Logger
	operation      OperationContext
	authentication authentication.Authentication
	emitEventFn    func(data []byte)
}

func (c *engineSubscriptionOnStartHookContext) Set(key string, value any) {
	c.requestContext.Set(key, value)
}

func (c *engineSubscriptionOnStartHookContext) Get(key string) (value any, exists bool) {
	return c.requestContext.Get(key)
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

func (c *engineSubscriptionOnStartHookContext) EmitEvent(event datasource.StreamEvent) bool {
	c.emitEventFn(event.GetData())

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
			requestContext:                 requestContext,
			request:                        requestContext.Request(),
			logger:                         logger,
			operation:                      requestContext.Operation(),
			authentication:                 requestContext.Authentication(),
			subscriptionEventConfiguration: subConf,
			emitEventFn:                    resolveCtx.Updater,
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
			requestContext: requestContext,
			request:        requestContext.Request(),
			logger:         logger,
			operation:      requestContext.Operation(),
			authentication: requestContext.Authentication(),
			emitEventFn:    resolveCtx.Updater,
		}

		return fn(hookCtx)
	}
}

type SubscriptionOnEndHandlerContext interface {
	// Request is the original request received by the router.
	Request() *http.Request
	// Logger is the logger for the request
	Logger() *zap.Logger
	// Operation is the GraphQL operation
	Operation() OperationContext
	// Authentication is the authentication for the request
	Authentication() authentication.Authentication
	// Set stores a value under the given key for this subscription.
	// SubscriptionOnEnd handlers of other modules that run after this one can read it with Get.
	Set(key string, value any)
	// Get returns the value stored under the given key for this subscription, ie: (value, true),
	// e.g. a value that a SubscriptionOnStart handler stored with Set. Every subscription has
	// its own values, also when several subscriptions share one WebSocket connection.
	// If no value is stored under the key it returns (nil, false). That is also the case when
	// the subscription ended before SubscriptionOnStart was called for it.
	Get(key string) (value any, exists bool)
}

type subscriptionOnEndHookContext struct {
	requestContext *requestContext
	request        *http.Request
	logger         *zap.Logger
	operation      OperationContext
	authentication authentication.Authentication
}

func (c *subscriptionOnEndHookContext) Set(key string, value any) {
	c.requestContext.Set(key, value)
}

func (c *subscriptionOnEndHookContext) Get(key string) (value any, exists bool) {
	return c.requestContext.Get(key)
}

func (c *subscriptionOnEndHookContext) Request() *http.Request {
	return c.request
}

func (c *subscriptionOnEndHookContext) Logger() *zap.Logger {
	return c.logger
}

func (c *subscriptionOnEndHookContext) Operation() OperationContext {
	return c.operation
}

func (c *subscriptionOnEndHookContext) Authentication() authentication.Authentication {
	return c.authentication
}

type SubscriptionOnEndHandler interface {
	// SubscriptionOnEnd is called once when a subscription ends, whatever ended it: the client
	// unsubscribed or disconnected, the subgraph or the event provider completed the
	// subscription, an error closed it, or the router is shutting down.
	// When several clients share one upstream subscription, it is called for each of them
	// separately, when that client's subscription ends.
	//
	// It is also called for a subscription that ended while it was being set up, e.g. because
	// a SubscriptionOnStart handler rejected it. So it can be called for a subscription that
	// SubscriptionOnStart was never called for, and it can run while SubscriptionOnStart is
	// still running if the client disconnects in the meantime.
	//
	// The subscription is already closed, so nothing can be sent to the client anymore.
	// The handler blocks the goroutine that ended the subscription, so it should return quickly.
	SubscriptionOnEnd(ctx SubscriptionOnEndHandlerContext)
}

// newSubscriptionOnEndHook converts the SubscriptionOnEndHandler functions into the function the
// engine calls once when the subscription of the given request ends. It returns nil if there are
// no handlers.
func newSubscriptionOnEndHook(handlers []func(ctx SubscriptionOnEndHandlerContext), requestContext *requestContext) func() {
	if len(handlers) == 0 {
		return nil
	}

	return func() {
		logger := requestContext.Logger()
		if logger == nil {
			logger = zap.NewNop()
		}
		logger = logger.With(zap.String("component", "subscription_on_end_hook"))

		hookCtx := &subscriptionOnEndHookContext{
			requestContext: requestContext,
			request:        requestContext.Request(),
			logger:         logger,
			operation:      requestContext.Operation(),
			authentication: requestContext.Authentication(),
		}

		for _, handler := range handlers {
			runSubscriptionOnEndHandler(handler, hookCtx)
		}
	}
}

// runSubscriptionOnEndHandler recovers from a panic of the handler. The handler runs on a
// goroutine of the engine, where a panic would stop the router.
func runSubscriptionOnEndHandler(handler func(ctx SubscriptionOnEndHandlerContext), hookCtx *subscriptionOnEndHookContext) {
	defer func() {
		if r := recover(); r != nil {
			hookCtx.logger.
				WithOptions(zap.AddStacktrace(zapcore.ErrorLevel)).
				Error("[Recovery from handler panic]",
					zap.Any("error", r),
				)
		}
	}()

	handler(hookCtx)
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
	//
	// The data parameter must contain valid JSON bytes representing the raw event payload
	// from your message broker (Kafka, NATS, etc.). The JSON must have properly quoted
	// property names and must include the __typename field required by GraphQL.
	// For example: []byte(`{"__typename": "Employee", "id": 1, "update": {"name": "John"}}`).
	//
	// This method is typically used in OnReceiveEvents hooks to create new or modified events.
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
	//
	// The data parameter must contain valid JSON bytes representing the event payload
	// that will be sent to your message broker (Kafka, NATS, etc.). The JSON must have
	// properly quoted property names and must include the __typename field required by GraphQL.
	// For example: []byte(`{"__typename": "Employee", "id": 1, "update": {"name": "John"}}`).
	//
	// This method is typically used in OnPublishEvents hooks to create new or modified events
	// before they are sent to the message broker.
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

type StreamBeforeEventsDispatchHandlerContext interface {
	// Context is a context for handlers. If it is cancelled, the handler should stop processing.
	Context() context.Context
	// Logger is the logger for the handler
	Logger() *zap.Logger
	// SubscriptionEventConfiguration the subscription event configuration
	SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration
	// NewEvent creates a new event that can be used in the subscription.
	//
	// The data parameter must contain valid JSON bytes representing the raw event payload
	// from your message broker (Kafka, NATS, etc.). The JSON must have properly quoted
	// property names and must include the __typename field required by GraphQL.
	NewEvent(data []byte) datasource.MutableStreamEvent
}

type StreamBeforeEventsDispatchHandler interface {
	// BeforeEventsDispatch is called once whenever a batch of events is received from a provider,
	// before delivering them to clients. Unlike OnReceiveEvents it is called ONCE per batch (not
	// once per active subscriber), and it runs on the concurrent broadcast delivery path — it
	// does not force the serial per-subscriber path. There is therefore no per-subscriber client
	// request available on the context. The returned events replace the batch for all subscribers.
	// Use events.All() to iterate through them and event.Clone() to create mutable copies, when needed.
	// Returning an error drops the batch and logs the error.
	BeforeEventsDispatch(ctx StreamBeforeEventsDispatchHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error)
}

type pubSubStreamBeforeEventsDispatchHookContext struct {
	logger                         *zap.Logger
	subscriptionEventConfiguration datasource.SubscriptionEventConfiguration
	eventBuilder                   datasource.EventBuilderFn
	context                        context.Context
}

func (c *pubSubStreamBeforeEventsDispatchHookContext) Context() context.Context {
	return c.context
}

func (c *pubSubStreamBeforeEventsDispatchHookContext) Logger() *zap.Logger {
	return c.logger
}

func (c *pubSubStreamBeforeEventsDispatchHookContext) SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration {
	return c.subscriptionEventConfiguration
}

func (c *pubSubStreamBeforeEventsDispatchHookContext) NewEvent(data []byte) datasource.MutableStreamEvent {
	return c.eventBuilder(data)
}

func NewPubSubBeforeEventsDispatchHook(fn func(ctx StreamBeforeEventsDispatchHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error), baseLogger *zap.Logger) datasource.BeforeEventsDispatchFn {
	if fn == nil {
		return nil
	}

	return func(ctx context.Context, subConf datasource.SubscriptionEventConfiguration, eventBuilder datasource.EventBuilderFn, evts []datasource.StreamEvent) ([]datasource.StreamEvent, error) {
		// The broadcast path has no per-subscriber client request, so we use the router base
		// logger rather than a request-scoped one.
		logger := baseLogger
		if logger != nil {
			logger = logger.With(zap.String("component", "before_events_dispatch_hook"))
			if subConf != nil {
				logger = logger.With(
					zap.String("provider_id", subConf.ProviderID()),
					zap.String("provider_type", string(subConf.ProviderType())),
					zap.String("field_name", subConf.RootFieldName()),
				)
			}
		}

		hookCtx := &pubSubStreamBeforeEventsDispatchHookContext{
			logger:                         logger,
			subscriptionEventConfiguration: subConf,
			eventBuilder:                   eventBuilder,
			context:                        ctx,
		}
		newEvts, err := fn(hookCtx, datasource.NewStreamEvents(evts))
		return newEvts.Unsafe(), err
	}
}

// StreamHandlerError writes an error event with Reason to a subscription client and closes the
// websocket connection with code 1000 (Normal closure).
// It can returned from methods of the core.SubscriptionOnStartHandler interface.
type StreamHandlerError struct {
	// The message for this error.
	Message string
}

// Error returns the reason of this error.
func (e *StreamHandlerError) Error() string {
	return e.Message
}

type SubscriptionOnCreateHandlerContext interface {
	// Request is the original request received by the router.
	Request() *http.Request
	// Logger is the logger for the request.
	Logger() *zap.Logger
	// Operation is the GraphQL operation.
	Operation() OperationContext
	// Authentication is the authentication for the request.
	Authentication() authentication.Authentication
	// SubscriptionEventConfiguration returns the current subscription event configuration.
	// The returned value is a pointer; mutating it directly takes effect without any additional call.
	//
	// This method is currently EXPERIMENTAL.
	// The signature and behaviour might change without prior notice.
	SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration
}

type pubSubSubscriptionOnCreateHookContext struct {
	request                        *http.Request
	logger                         *zap.Logger
	operation                      OperationContext
	authentication                 authentication.Authentication
	subscriptionEventConfiguration datasource.SubscriptionEventConfiguration
}

func (c *pubSubSubscriptionOnCreateHookContext) Request() *http.Request {
	return c.request
}

func (c *pubSubSubscriptionOnCreateHookContext) Logger() *zap.Logger {
	return c.logger
}

func (c *pubSubSubscriptionOnCreateHookContext) Operation() OperationContext {
	return c.operation
}

func (c *pubSubSubscriptionOnCreateHookContext) Authentication() authentication.Authentication {
	return c.authentication
}

func (c *pubSubSubscriptionOnCreateHookContext) SubscriptionEventConfiguration() datasource.SubscriptionEventConfiguration {
	return c.subscriptionEventConfiguration
}

type SubscriptionOnCreateHandler interface {
	// SubscriptionOnCreate allows to modify the event configuration
	// before the subscription starts. Returning a non-nil error aborts the subscription.
	//
	// This method is currently EXPERIMENTAL.
	// The signature and behaviour might change without prior notice.
	SubscriptionOnCreate(ctx SubscriptionOnCreateHandlerContext) error
}

// NewPubSubSubscriptionOnCreateHook converts a SubscriptionOnCreateHandler fn to a datasource.SubscriptionOnCreateFn.
func NewPubSubSubscriptionOnCreateHook(fn func(ctx SubscriptionOnCreateHandlerContext) error) datasource.SubscriptionOnCreateFn {
	if fn == nil {
		return nil
	}

	return func(ctx context.Context, subConf datasource.SubscriptionEventConfiguration) (datasource.SubscriptionEventConfiguration, error) {
		requestContext := getRequestContext(ctx)

		logger := requestContext.Logger()
		if logger != nil {
			logger = logger.With(zap.String("component", "pubsub_subscription_before_trigger_hook"))
			if subConf != nil {
				logger = logger.With(
					zap.String("provider_id", subConf.ProviderID()),
					zap.String("provider_type", string(subConf.ProviderType())),
					zap.String("field_name", subConf.RootFieldName()),
				)
			}
		}

		hookCtx := &pubSubSubscriptionOnCreateHookContext{
			request:                        requestContext.Request(),
			logger:                         logger,
			operation:                      requestContext.Operation(),
			authentication:                 requestContext.Authentication(),
			subscriptionEventConfiguration: subConf,
		}

		if err := fn(hookCtx); err != nil {
			return nil, err
		}

		return hookCtx.subscriptionEventConfiguration, nil
	}
}
