# RFC Cosmo Streams V1

Based on customer feedback, we've identified the need for more customizable stream behavior. The key areas for customization include:
- **Authorization**: Implementing authorization checks at the start of subscriptions
- **Initial message**: Sending an initial message to clients upon subscription start
- **Data mapping**: Transforming data to align with internal specifications
- **Event filtering**: Filtering events using custom logic

Let's explore how we can address each of these requirements.

## Authorization

To support authorization, we need a hook that enables two key decisions:
- Whether the client or user is authorized to initiate the subscription
- Which topics the client is permitted to subscribe to

Additionally, a similar mechanism is required for non-stream subscriptions, allowing:
- Custom JWT validation logic (e.g., expiration checks, signature verification, secret handling)
- The ability to reject unauthenticated or unauthorized requests and close the subscription accordingly

We already allow some customization using `RouterOnRequestHandler`, but it has no access to the stream data. To access this data, we need to add a new hook that will be called immediately before the subscription starts.

### Example: Check if the client is allowed to subscribe to the stream

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
    err := json.Unmarshal(ctx.StreamContext().SubscriptionConfiguration(), &subscriptionConfiguration)
    if err != nil {
        return false
    }
    
    if providerId == "almost-sharable-data" &&
       providerType == "nats" &&
       slices.Equal(subscriptionConfiguration.Subjects, []string{"public"}) {
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

The hook arguments are:
* `ctx SubscriptionContext`: The subscription context, which contains the request context and, optionally, the stream context

`RequestContext` already exists and requires no changes, but `SubscriptionContext` is new.

The hook should return an error if the client is not allowed to subscribe to the stream, preventing the subscription from starting.
The hook should return `nil` if the client is allowed to subscribe to the stream, allowing the subscription to proceed.

I evaluated the possibility of adding the `SubscriptionContext` to the request context and using it within one of the existing hooks, but it would be difficult to build the subscription context without executing the pubsub code.

The `StreamContext.SubscriptionConfiguration()` contains the subscription configuration as used by the provider. This allows the hooks system to be provider-agnostic, so adding a new provider will not require changes to the hooks system.

## Initial Message

When starting a subscription, the client sends a query to the server containing the operation name and variables. The client must then wait for the broker to send the initial message. This waiting period can lead to a poor user experience, as the client cannot display anything until the initial message is received. To address this, we can emit an initial message on subscription start.

To emit an initial message on subscription start, we need access to the stream context (to get the provider type and ID) and the query that the client sent. The variables are particularly important, as they allow the module to use them in the initial message. For example, if someone starts a subscription with employee ID 100 as a variable, the custom module can include that ID in the initial message.

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
    // the variables are currently not available, so we need to add them here
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

Using the new `SubscriptionOnStart` hook that we introduced for the previous requirement, we can emit the initial message on subscription start. We will also need access to operation variables, which are currently not available in the request context.

To emit the message, I propose adding a new method to the stream context, `WriteEvent`, which will emit the event to the stream at the lowest level. The message will pass through all hooks, making it behave like any other event received from the provider.

The `StreamEvent` contains the data as used by the provider. This allows the hooks system to be provider-agnostic, so adding a new provider will not require changes to the hooks system.

Emitting the initial message with this hook ensures that the client will receive the message before the first event from the provider is received.

## Data Mapping

The current approach for emitting and reading data from the stream is not flexible enough. We need to be able to map data from an external format to the internal format, and vice versa.

### Example 1: Rewrite the event received from the provider to a format that is usable by Cosmo streams

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

### Example 2: Rewrite the event before emitting it to the provider to a format that is usable by external systems

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
    err := json.Unmarshal(ctx.StreamContext().SubscriptionConfiguration(), &subscriptionConfiguration)
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

Add two new hooks to the stream lifecycle: `StreamOnEventReceived` and `StreamOnEventToSend`, which will be called once for each event received from the provider and once for each event that is going to be sent to the provider.

The `StreamOnEventReceived` hook will be called for each event received from the provider, making it possible to rewrite the event data to a format usable within Cosmo streams.
The `StreamOnEventToSend` hook will be called for each event that is going to be sent to the provider, making it possible to rewrite the event data to a format usable by external systems.

The hook arguments are:
* `ctx StreamContext`: The stream context, which contains the ID and type of the stream
* `event core.StreamEvent`: The event received from the provider or the event that is going to be sent to the provider

The hook should return an error if the event cannot be processed, preventing the event from being processed.
The hook should return `nil` if the event can be processed, allowing the event to proceed.

I also considered exposing the subscription context to the hooks, but this would be too easy to misuse. Users might add subscription-specific data to an event that will be sent to multiple providers. To make it safe, I would need to copy the entire event data for each pair of event and subscription that needs to receive it.

This proposal requires introducing a new format for events that the pubsub system uses. For example, with NATS we currently use the `PublishAndRequestEventConfiguration` struct when writing events, but when reading events, we only pass down the event data. We need to build an intermediate struct that allows us to access metadata, data, and other event fields. In Example 1, we use the `ReceivedEventConfiguration` struct for this purpose.

This change is significant but would be needed anyway to support metadata in events.

#### Do we need two new hooks?

Another possible solution for mapping outward data would be to use the existing middleware hooks `RouterOnRequestHandler` or `RouterMiddlewareHandler` to intercept the mutation, access the stream context, and emit the event to the stream. However, this would require exposing a stream context in the request lifecycle, which is difficult. It would also require coordination to ensure that an event emitted on the stream is sent only after the subscription starts.

Additionally, this solution is not usable on the subscription side of streams:
- The middleware hooks are linked to the request lifecycle, making it difficult to use them to rewrite event data
- When we use the streams feature internally, we will still need to provide a way to rewrite event data, requiring a new hook in the subscription lifecycle

Therefore, I believe the best solution is to add two new hooks to the stream lifecycle.

## Event Filtering

We need to allow customers to filter events based on custom logic. We currently only provide declarative filters, which are quite limited.

### Example: Filter events based on stream configuration and client's scopes

```go
// the structs are reported only with the fields that are used in the example
type StreamEvent interface {
    Data() []byte
}

type StreamContext interface {
    SubscriptionConfiguration() []byte
}

type OperationContext interface {
    Name() string
    Variables() *astjson.Value
}

type RequestContext interface {
    Authentication() *core.Authentication
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
        return true
    }

    if subscriptionConfiguration.Subjects == []string{"topic-with-internal-data-format"} {
        var receivedEventConfiguration nats.ReceivedEventConfiguration
        err := json.Unmarshal(event.Data(), &receivedEventConfiguration)
        if err != nil {
            return true
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
```

### Proposal

Add a new hook to the stream lifecycle, `StreamOnEventFilter`, that will be called before delivering an event to the client.

The hook arguments are:
* `ctx core.SubscriptionContext`: The subscription context, which contains the request context and, optionally, the stream context
* `event core.StreamEvent`: The event received from the provider or the event that is going to be sent to the provider

The hook should return `true` to skip the event, `false` to deliver it.

Ideally, we could use the `StreamOnEventReceivedHandler` to filter events, but this would require adding the subscription context to the stream context, which is not a good idea. It would be easy to misuse by adding subscription-specific data to an event that should not be sent only to that client. Also, the `StreamOnEventReceivedHandler` is called for each event received from the provider, while this new hook should be called for each combination of event and subscription that is going to be delivered to the client.

## Architecture

With this proposal, we will add hooks to both the subscription lifecycle and the stream lifecycle.

### Subscription Lifecycle
```
Start subscription
    │
    └─▶ core.SubscriptionOnStartHandler (Early return, Custom Authentication Logic)
    │
    └─▶ "Subscription started"
```

### Stream Lifecycle

```
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
```

### Data Flow

We will need to change the format of the event data sent within the router. Today we use the data that will be sent to the provider directly, but we will need to add a structure where we can include additional fields (metadata, etc.) in the event.

## Implementation Details

The implementation of this solution will only require changes in the Cosmo repository, without any changes to the engine. This implementation will not require additional changes to the hooks structures each time a new provider is added.

## Considerations and Risks

- All hooks could be called in parallel, so we need to handle concurrency carefully
- All hook implementations could raise a panic, so we need to implement proper error handling
- In the `StreamOnEventFilter` hook, a user could change the event data without considering that the changes could be sent to other clients as well, so we need to advise users to be careful with this hook
- We should add metrics to track how much time is spent in each hook, to help customers identify slow hooks
