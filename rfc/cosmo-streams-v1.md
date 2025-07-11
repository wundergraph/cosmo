# RFC Cosmo Streams V1

Based on customer feedback, we've identified the need for more customizable stream behavior. The key areas for customization include:
- Authorization: implementing authorization checks at the start of subscriptions
- Initial message: sending an initial message to clients upon subscription start
- Data mapping: mapping data to align with internal specifications
- Event filtering: filtering events using custom logic

Let's explore how we can address each of these requirements.

## Authorization
To support authorization, we need a hook that enables two key decisions:
- Whether the client or user is authorized to initiate the subscription at all
- Which topics the client is permitted to subscribe to

Additionally, a similar mechanism is required for non-stream subscriptions, allowing:
- Custom JWT validation logic (e.g., expiration checks, signature verification, secret handling)
- The ability to reject unauthenticated or unauthorized requests and close the subscription accordingly

We already allow some customization using RouterOnRequestHandler, but it has no access to the stream data. To get them, we need to add a new hook that will be called right before the subscription is started.

### Example: check if the client is allowed to subscribe to the stream

```go
// the structs are reported only with the fields that are used in the example
type StreamContext interface {
    ProviderType() string
    ProviderId() string
    // the subscription configuration is specific for each provider
    SubscriptionConfiguration() []byte
}

type RequestContext interface {
    Authentication() *core.Authentication
}

type SubscriptionContext interface {
    RequestContext() RequestContext
    StreamContext() StreamContext
}

// This is the new hook that will be called once at stream start
type SubscriptionOnStartHandler interface {
	SubscriptionOnStart(ctx SubscriptionContext) error
}

// already defined in the provider package
type SubscriptionEventConfiguration struct {
	ProviderID          string               `json:"providerId"`
	Subjects            []string             `json:"subjects"`
	StreamConfiguration *StreamConfiguration `json:"streamConfiguration,omitempty"`
}

type MyModule struct {}

func customCheckIfClientIsAllowedToSubscribe(ctx SubscriptionContext) bool {
    providerType := ctx.StreamContext().ProviderType()
    providerId := ctx.StreamContext().ProviderId()
    clientScopes := ctx.RequestContext().Authentication().Scopes()
    
    if slices.Contains(clientScopes, "admin") {
        return true
    }
    
    if providerId == "sharable-data" && providerType == "nats" {
        return true
    }

    // unmarshal the subscription data, specific for each provider
    var subscriptionConfiguration nats.SubscriptionEventConfiguration
    err := json.Unmarshal(streamCtx.SubscriptionConfiguration(), &subscriptionConfiguration)
    if err != nil {
        return false
    }
    
    if providerId == "almost-sharable-data"
     && providerType == "nats"
     && subscriptionConfiguration.Subjects == []string{"public"} {
        return true
    }

    return false
}

func (m *MyModule) SubscriptionOnStart(ctx SubscriptionContext) error {
	if !customCheckIfClientIsAllowedToSubscribe(ctx) {
		return fmt.Errorf("you should be an admin to subscribe to this or only subscribe to public subscriptions!")
	}
	return nil
}

func (m *MyModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID: myModuleID,
		Priority: 1,
		New: func() core.Module {
			return &MyModule{}
		},
	}
}
```

### Proposal

Add a new hook to the subscription lifecycle, `SubscriptionOnStart`, that will be called once at subscription start.

The arguments of the hook are:
* `ctx SubscriptionContext`: the subscription context, that contains the request context and, optionally, the stream context

RequestContext already exists and need no changes, but SubscriptionContext is new.

The hook should return an error if the client is not allowed to subscribe to the stream, and the subscription will not be started.
The hook should return nil if the client is allowed to subscribe to the stream, and the subscription will be started.

I evaluated the possibility to just add the SubscriptionContext to the request context and use it inside one of the existing hooks,
but it would be hard to build the subscription context without executing the pubsub code.

The `StreamContext.SubscriptionConfiguration()` contains the subscription configuration as is used by the provider. This will allow the hooks system to be agnostic of the provider type, so that adding a new provider will not require any changes to the hooks system.

## Initial message

When starting a subscription, the client will send a query to the server.
The query contains the operation name and the variables.
And then the client will have to wait for the server to send the initial message.
This waiting could lead to a bad user experience, because the client can't see anything until the initial message is received.
To solve this, we can emit an initial message on subscription start.

To emit an initial message on subscription start, we need access to the stream context (to get the provider type and id) and also the query that the client sent.
The variables are really important to know to allow the module to use them to emit the initial message.
E.g. if someone start a subscription with employee id 100, the custom module can emit the initial message with that id inside.

### Example
```go
// the structs are reported only with the fields that are used in the example
type StreamEvent interface {
    Data() []byte
    SetData(data []byte)
}

type StreamContext interface {
    ProviderType() string
    WriteEvent(event core.StreamEvent)
}

type OperationContext interface {
    Name() string
    Variables() *astjson.Value
}

type RequestContext interface {
    Operation() core.OperationContext
}

type SubscriptionContext struct {
    RequestContext() RequestContext
    StreamContext() StreamContext
}

// This is the new hook that will be called once at stream start
type SubscriptionOnStartHandler interface {
	SubscriptionOnStart(ctx SubscriptionContext) error
}

// already defined in the provider package, but we need to add the metadata field
type PublishAndRequestEventConfiguration struct {
	ProviderID string          `json:"providerId"`
	Subject    string          `json:"subject"`
	Data       json.RawMessage `json:"data"`
    Metadata   map[string]string `json:"metadata"`
}

type MyModule struct {}

func (m *MyModule) SubscriptionOnStart(ctx SubscriptionContext) error {
    opName := ctx.RequestContext().Operation().Name()
    opVarId := ctx.RequestContext().Operation().Variables().GetInt("id")
    if opName == "employeeSub" {
        publishAndRequestEventConfiguration := nats.PublishAndRequestEventConfiguration{
            ProviderID: "employee-stream",
            Subject: "employee-stream",
            Data: []byte(fmt.Sprintf("{\"id\": \"%d\", \"__typename\": \"Employee\"}", opVarId)),
            Metadata: map[string]string{
                "entity-id": fmt.Sprintf("%d", opVarId),
            },
        }
        data, err := json.Marshal(publishAndRequestEventConfiguration)
        if err != nil {
            return fmt.Errorf("error marshalling data: %w", err)
        }

        // create the event with the data and the provider type
        evt := core.NewStreamEvent(ctx.StreamContext().ProviderType(), data)
        ctx.StreamContext().WriteEvent(evt)
    }
    return nil
}

func (m *MyModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID: myModuleID,
		Priority: 1,
		New: func() core.Module {
			return &MyModule{}
		},
	}
}
```

### Proposal

Using the new `SubscriptionOnStart`hook, that we already introduced to solve the previous requirement, we can emit the initial message on subscription start.
We will also need access to operation variables, that right now are not available in the request context.

To emit the message I propose to add a new method to the stream context, `WriteEvent`, that will emit the event to the stream at the lowest level.
The message will go through all the hooks, so that it will be just like any other event received from the provider.

The `StreamEvent` contains the data as is used by the provider. This will allow the hooks system to be agnostic of the provider type, so that adding a new provider will not require any changes to the hooks system.

Emitting the initial message with this hook will guarantee that the client will receive the message and it will receive it before the first event from the provider is received.

## Data mapping

The current way we have to emit and read the data from the stream is not flexible enough.
We need to be able to map the data from an external format to the internal format, and also to map the data from the internal format to an external format.

### Example 1, rewrite the event received from the provider to a format that is usable from cosmo streams
```go
// the structs are reported only with the fields that are used in the example
type StreamEvent interface {
    Data() []byte
    SetData(data []byte)
}

// This is the new hook that will be called once for each event received from the provider
type StreamOnEventReceivedHandler interface {
	StreamOnEventReceived(ctx StreamContext, event core.StreamEvent) error
}

// already defined in the provider package, but we need to add the metadata field
type PublishAndRequestEventConfiguration struct {
	ProviderID string          `json:"providerId"`
	Subject    string          `json:"subject"`
	Data       json.RawMessage `json:"data"`
    Metadata   map[string]string `json:"metadata"`
}

// to be defined in the provider package
type ReceivedEventConfiguration struct {
	ProviderID string          `json:"providerId"`
	Subject    string          `json:"subject"`
	Data       json.RawMessage `json:"data"`
    Metadata   map[string]string `json:"metadata"`
}

type MyModule struct {}

func (m *MyModule) StreamOnEventReceived(ctx StreamContext, event core.StreamEvent) error {
    var receivedEventConfiguration nats.ReceivedEventConfiguration

    // unmarshal the event data that we received from the provider
    err := json.Unmarshal(event.Data(), &receivedEventConfiguration)
    if err != nil {
        return fmt.Errorf("error unmarshalling data: %w", err)
    }

    // prepare the event to send with all the changes that we want to do to the data
    if receivedEventConfiguration.Subject == "topic-with-internal-data-format" {
        var dataReceived struct {
            EmployeeId string `json:"EmployeeId"`
        }
        err := json.Unmarshal(event.Data(), &dataReceived)
        if err != nil {
            return fmt.Errorf("error unmarshalling data: %w", err)
        }
        var dataForStream struct {
            Id string `json:"id"`
            Name string `json:"__typename"`
        }
        dataForStream.Id = dataReceived.EmployeeId
        dataForStream.Name = "Employee"

        publishAndRequestEventConfiguration := nats.PublishAndRequestEventConfiguration{
            ProviderID: receivedEventConfiguration.ProviderID,
            Subject: receivedEventConfiguration.Subject,
            Data: dataForStream,
            Metadata: receivedEventConfiguration.Metadata,
        }
        data, err := json.Marshal(publishAndRequestEventConfiguration)
        if err != nil {
            return fmt.Errorf("error marshalling data: %w", err)
        }
        event.SetData(data)
    }
    return nil
}

func (m *MyModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID: myModuleID,
		Priority: 1,
		New: func() core.Module {
			return &MyModule{}
		},
	}
}
```

### Example 2, rewrite the event before emitting it to the provider to a format that is usable from external systems
```go
// the structs are reported only with the fields that are used in the example
type StreamEvent interface {
    Data() []byte
    SetData(data []byte)
}

type StreamContext interface {
    WriteEvent(event core.StreamEvent)
}

// This is the new hook that will be called once for each event that is going to be sent to the provider
type StreamOnEventToSendHandler interface {
	StreamOnEventToSend(ctx StreamContext, event core.StreamEvent) error
}

// already defined in the provider package
type SubscriptionEventConfiguration struct {
	ProviderID          string               `json:"providerId"`
	Subjects            []string             `json:"subjects"`
	StreamConfiguration *StreamConfiguration `json:"streamConfiguration,omitempty"`
}

// already defined in the provider package, but we need to add the metadata field
type PublishAndRequestEventConfiguration struct {
	ProviderID string          `json:"providerId"`
	Subject    string          `json:"subject"`
	Data       json.RawMessage `json:"data"`
    Metadata   map[string]string `json:"metadata"`
}

type MyModule struct {}

func (m *MyModule) StreamOnEventToSend(ctx StreamContext, event core.StreamEvent) error {
    // unmarshal the subscription data, specific for each provider
    var subscriptionConfiguration nats.SubscriptionEventConfiguration
    err := json.Unmarshal(streamCtx.SubscriptionConfiguration(), &subscriptionConfiguration)
    if err != nil {
        return false
    }
    
    if subscriptionConfiguration.Subjects == []string{"topic-with-internal-data-format"} {
        // unmarshal the event data that we received from the provider
        var oldEventConfiguration nats.PublishAndRequestEventConfiguration
        err := json.Unmarshal(event.Data(), &oldEventConfiguration)
        if err != nil {
            return fmt.Errorf("error unmarshalling data: %w", err)
        }

        // unmarshal the data of the message the we are expecting
        var data struct {
            Id string `json:"id"`
            Name string `json:"__typename"`
        }
        err := json.Unmarshal(oldEventConfiguration.Data, &data)
        if err != nil {
            return fmt.Errorf("error unmarshalling data: %w", err)
        }

        // prepare the data to send to the provider to be usable from external systems
        var dataToSend struct {
            EmployeeId string `json:"EmployeeId"`
            OtherField string `json:"OtherField"`
        }
        dataToSend.EmployeeId = data.Id
        dataToSend.OtherField = "Custom value"
        dataToSendMarshalled, err := json.Marshal(dataToSend)
        if err != nil {
            return fmt.Errorf("error marshalling data: %w", err)
        }
        publishAndRequestEventConfiguration := nats.PublishAndRequestEventConfiguration{
            ProviderID: oldEventConfiguration.ProviderID,
            Subject: oldEventConfiguration.Subject,
            Data: dataToSendMarshalled,
            Metadata: map[string]string{
                "entity-id": data.Id,
                "entity-domain": "employee",
            },
        }
        eventData, err := json.Marshal(publishAndRequestEventConfiguration)
        if err != nil {
            return fmt.Errorf("error marshalling data: %w", err)
        }
        event.SetData(eventData)
    }
    return nil
}

func (m *MyModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID: myModuleID,
		Priority: 1,
		New: func() core.Module {
			return &MyModule{}
		},
	}
}
```

### Proposal

Add two new hooks to the stream lifecycle, `StreamOnEventReceived` and `StreamOnEventToSend`, that will be called once for each event received from the provider and once for each event that is going to be sent to the provider.

The `StreamOnEventReceived` hook will be called once for each event received from the provider, so that it will be possible to rewrite the event data to a format usable inside cosmo streams.
The `StreamOnEventToSend` hook will be called once for each event that is going to be sent to the provider, so that it will be possible to rewrite the event data to a format usable from external systems.

The arguments of the hooks are:
* `ctx StreamContext`: the stream context, that contains the id and type of the stream
* `event core.StreamEvent`: the event received from the provider or the event that is going to be sent to the provider

The hook should return an error if the event cannot be processed, and the event will not be processed.
The hook should return nil if the event can be processed, and the event will be processed.

I also thought about exposing the subscription context to the hooks, but it would be too easy to misuse it and use some data specific to the subscription and add it to an event that will not be sent only to that provider. To make it safe I should copy the whole event data for each pair of event and subscription that needs to receive it.

This proposal requires the introduction of a new format of events that the pubsub system uses.
As an example, for NATS we are currently using the `PublishAndRequestEventConfiguration` struct, when writing events, but when we are reading events, we only pass down the data of the event. We have to build an intermediate struct that will allow us to access metadata, data and other fields of the event. In the example 1 we are using the `ReceivedEventConfiguration` struct for this purpose.

This change is sensible but it would be needed anyway to support metadata in the events.

#### Do we need two new hooks?

Another possibile solution for mapping the outward data would be to use the already existing middleware hooks `RouterOnRequestHandler` or the `RouterMiddlewareHandler` to "eat" the mutation and access to the stream context and emit the event to the stream. But this would require exposing a stream context on the request lifecycle, that is difficult. Also this will require some coordination to be sure that an event emitted on the stream is sent only after the subscription is started.
Also, this solution is not usable on the subscription side of the streams:
- the middleware hooks are linked to the request lifecycle, so it would be hard to use them to rewrite the event data;
- when we are going to use the streams feature internally, we will still need to provide a way to rewrite the event data, so we will need to add a new hook to the subscription lifecycle;

So I think that the best solution is to add two new hooks to the stream lifecycle.


## Event filtering

We need to allow customers to filter events base on custom logic. We actually only provide declarative filters, and they are really limited.

### Example, filter events based on streams configuration and client's scopes

```go
// the structs are reported only with the fields that are used in the example
type StreamEvent interface {
    Data() []byte
}

type StreamContext interface {
    WriteEvent(event core.StreamEvent)
}

type OperationContext interface {
    Name() string
    Variables() *astjson.Value
}

type RequestContext interface {
    Authentication() *core.Authentication
    Operation() core.OperationContext
}

type SubscriptionContext struct {
    RequestContext() RequestContext
    StreamContext() StreamContext
}

// This is the new hook that will be called before delivering an event to the client
type StreamOnEventFilterHandler interface {
    // return true to skip the event, false to deliver it
	StreamOnEventFilter(ctx core.SubscriptionContext, event core.StreamEvent) bool
}

// already defined in the provider package
type SubscriptionEventConfiguration struct {
	ProviderID          string               `json:"providerId"`
	Subjects            []string             `json:"subjects"`
	StreamConfiguration *StreamConfiguration `json:"streamConfiguration,omitempty"`
}

// to be defined in the provider package
type ReceivedEventConfiguration struct {
	ProviderID string          `json:"providerId"`
	Subject    string          `json:"subject"`
	Data       json.RawMessage `json:"data"`
    Metadata   map[string]string `json:"metadata"`
}

type MyModule struct {}

func (m *MyModule) StreamOnEventFilter(ctx core.SubscriptionContext, event core.StreamEvent) bool {
    clientAllowedEntitiesIds, found := ctx.RequestContext().Authentication().Claims()["allowedEntitiesIds"]
    if !found {
        return true
    }

    var subscriptionConfiguration nats.SubscriptionEventConfiguration
    err := json.Unmarshal(ctx.StreamContext().SubscriptionConfiguration(), &subscriptionConfiguration)
    if err != nil {
        return fmt.Errorf("error unmarshalling data: %w", err)
    }

    if subscriptionConfiguration.Subjects == []string{"topic-with-internal-data-format"} {
        var receivedEventConfiguration nats.ReceivedEventConfiguration
        err := json.Unmarshal(event.Data(), &receivedEventConfiguration)
        if err != nil {
            return fmt.Errorf("error unmarshalling data: %w", err)
        }

        idHeader, ok := receivedEventConfiguration.Metadata["entity-id"]
        if !ok {
            return true
        }
        if slices.Contains(clientAllowedEntitiesIds, idHeader) {
            // the event is delivered to the client only if the id is in the allowed entities ids
            return false
        }
    }
    return true
}

func (m *MyModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID: myModuleID,
		Priority: 1,
		New: func() core.Module {
			return &MyModule{}
		},
	}
}

### Proposal

Add a new hook to the stream lifecycle, `StreamOnEventFilter`, that will be called before delivering an event to the client.

The arguments of the hook are:
* `ctx core.SubscriptionContext`: the subscription context, that contains the request context and, optionally, the stream context
* `event core.StreamEvent`: the event received from the provider or the event that is going to be sent to the provider

The hook should return true to skip the event, false to deliver it.

Ideally we could use the StreamOnEventReceivedHandler to filter the events, but it would require to add the subscription context to the stream context, that is not a good idea: it would be easy to misuse it and use some data specific to the subscription and add it to an event that will not be sent only to that client. Also, the StreamOnEventReceivedHandler is called for each event received from the provider, and this new hook should be called for each combination of event and subscription that is going to be delivered to the client.

## Architecture

With this proposal, we are going to add some hooks to the subscription lifecycle, and some hooks to the stream lifecycle.

### Subscription lifecycle
Start subscription
    │
    └─▶ core.SubscriptionOnStartHandler (Early return, Custom Authentication Logic)
    │
    └─▶ "Subscription started"

### Stream lifecycle

An event is received from the provider
    │
    └─▶ core.StreamOnEventReceivedHandler (Data mapping)
    │
    └─▶ core.StreamOnEventFilterHandler (Filtering)
    │
    └─▶ "Deliver event to client"

A mutation is sent from the client
    │
    └─▶ core.StreamOnEventToSendHandler (Data mapping)
    │
    └─▶ "Send event to provider"

# Implementation details

The implementation of this solution will only require changes in the cosmo repo, without any changes to the engine.
This implementation will require additional changes to the hooks structures each time a new provider is added.

# Here be dragons

- all the hooks could be called in parallel, so we need to be careful with that
- all the hooks implementations could raise a panic, so we need to be careful with that also
- in the hook `StreamOnEventFilter` a user could change the event data without considering that the changes could be sent to other clients also.
- probably we should also add metrics to track how much time is spent in each hook, to help customers pinpoint slow hooks
