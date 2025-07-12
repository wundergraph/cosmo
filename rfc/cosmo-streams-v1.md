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
type SubscriptionEventConfiguration interface {
    ProviderID() string
}

type StreamContext interface {
    ProviderType() string
    SubscriptionConfiguration() SubscriptionEventConfiguration
}

type RequestContext interface {
    Authentication() *core.Authentication
}

type SubscriptionOnStartHookContext interface {
    RequestContext() RequestContext
    StreamContext() StreamContext
}

// This is the new hook that will be called once at subscription start
type SubscriptionOnStartHandler interface {
    SubscriptionOnStart(ctx SubscriptionOnStartHookContext) error
}

// already defined in the provider package
type NatsSubscriptionEventConfiguration struct {
    ProviderID          string               `json:"providerId"`
    Subjects            []string             `json:"subjects"`
    StreamConfiguration *StreamConfiguration `json:"streamConfiguration,omitempty"`
}

type MyModule struct {}

func customCheckIfClientIsAllowedToSubscribe(ctx SubscriptionOnStartHookContext) bool {
    cfg, ok := ctx.StreamContext().SubscriptionConfiguration().(*NatsSubscriptionEventConfiguration)
    if !ok {
        return true
    }

    providerId := cfg.ProviderID
    clientScopes := ctx.RequestContext().Authentication().Scopes()
    
    if slices.Contains(clientScopes, "admin") {
        return true
    }
    
    if providerId == "sharable-data" {
        return true
    }
    
    if providerId == "almost-sharable-data" &&
       slices.Equal(cfg.Subjects, []string{"public"}) {
        return true
    }

    return false
}

func (m *MyModule) SubscriptionOnStart(ctx SubscriptionOnStartHookContext) error {
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

Add a new hook to the subscription lifecycle, `SubscriptionOnStartHandler`, that will be called once at subscription start.

The hook arguments are:
* `ctx SubscriptionContext`: The subscription context, which contains the request context and, optionally, the stream context

`RequestContext` already exists and requires no changes, but `SubscriptionContext` is new.

The hook should return an error if the client is not allowed to subscribe to the stream, preventing the subscription from starting.
The hook should return `nil` if the client is allowed to subscribe to the stream, allowing the subscription to proceed.

I evaluated the possibility of adding the `SubscriptionContext` to the request context and using it within one of the existing hooks, but it would be difficult to build the subscription context without executing the pubsub code.

The `StreamContext.SubscriptionConfiguration()` contains the subscription configuration as used by the provider. This allows the hooks system to be provider-agnostic, so adding a new provider will not require changes to the hooks system. To use specific fields, the hook can cast the configuration to the specific type for the provider.

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

type SubscriptionOnStartHookContext struct {
    RequestContext() RequestContext
    StreamContext() StreamContext
}

// This is the new hook that will be called once at stream start
type SubscriptionOnStartHandler interface {
    SubscriptionOnStart(ctx SubscriptionOnStartHookContext) error
}

// each provider will have its own event type that implements the StreamEvent interface
type NatsEvent struct {
    ProviderID string
    Subject string
    Data json.RawMessage
    Metadata map[string]string
}

type MyModule struct {}

func (m *MyModule) SubscriptionOnStart(ctx SubscriptionOnStartHookContext) error {
    opName := ctx.RequestContext().Operation().Name()
    opVarId := ctx.RequestContext().Operation().Variables().GetInt("id")
    if opName == "employeeSub" {
        evt := &NatsEvent{
            ProviderID: "employee-stream",
            Subject: "employee-stream",
            Data: []byte(fmt.Sprintf("{\"id\": \"%d\", \"__typename\": \"Employee\"}", opVarId)),
            Metadata: map[string]string{
                "entity-id": fmt.Sprintf("%d", opVarId),
            },
        }
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

The `StreamEvent` contains the data as used by the provider. This allows the hooks system to be provider-agnostic, so adding a new provider will not require changes to the hooks system. To use specific fields, the hook can cast the event to the specific type for the provider. If the custom modules only need to read the data, they can use the `Data()`/`SetData()` methods without casting the event.

This change will require adding a new type in each provider package to represent the event with additional fields (metadata, etc.). This is a significant change, but it is necessary to support additional data in events, anyway, even if we don't expose them to the custom modules.

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

type SubscriptionEventConfiguration interface {
    ProviderID() string
}

type StreamBatchDirection string

const (
    StreamBatchDirectionInbound StreamBatchDirection = "inbound"
    StreamBatchDirectionOutbound StreamBatchDirection = "outbound"
)

type StreamBatchEventHookContext interface {
    Direction() StreamBatchDirection
}

// each provider will have its own event type that implements the StreamEvent interface
type NatsEvent struct {
    ProviderID string
    Subject string
    Data json.RawMessage
    Metadata map[string]string
}

// StreamBatchEventHook processes a batch of stream events (inbound or outbound).  
//  
// Return:  
//   - empty slice: drop all events.  
//   - non-empty slice: emit those events (can grow, shrink, or reorder the batch).  
// err != nil: abort the subscription with an error.  
type StreamBatchEventHook interface {
    OnStreamEvents(ctx StreamBatchEventHookContext, events []StreamEvent) ([]StreamEvent, error)
}

func (m *MyModule) OnStreamEvents(
    ctx StreamBatchEventHookContext,
    events []StreamEvent,
) ([]StreamEvent, error) {
    // we only rewrite the data for inbound events
    if ctx.Direction() == StreamBatchDirectionOutbound {
        return events, nil
    }

    newEvents := make([]StreamEvent, 0, len(events))
    for _, evt := range events {
        if natsEvent, ok := evt.(*NatsEvent); ok {
            if natsEvent.Subject == "topic-with-internal-data-format" {
                // rewrite the event data to a format that is usable by Cosmo streams
                var dataReceived struct {
                    EmployeeId string `json:"EmployeeId"`
                }
                err := json.Unmarshal(natsEvent.Data(), &dataReceived)
                if err != nil {
                    return events, fmt.Errorf("error unmarshalling data: %w", err)
                }
                var dataForStream struct {
                    Id string `json:"id"`
                    Name string `json:"__typename"`
                }
                dataForStream.Id = dataReceived.EmployeeId
                dataForStream.Name = "Employee"

                dataForStreamMarshalled, err := json.Marshal(dataForStream)
                if err != nil {
                    return events, fmt.Errorf("error marshalling data: %w", err)
                }

                newEvent := &NatsEvent{
                    ProviderID: natsEvent.ProviderID,
                    Subject: natsEvent.Subject,
                    Data: dataForStreamMarshalled,
                    Metadata: natsEvent.Metadata,
                }
                newEvents = append(newEvents, newEvent)
                continue
            }
        }
        newEvents = append(newEvents, evt)
    }

    return events, nil  
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

type SubscriptionEventConfiguration interface {
    ProviderID() string
}

type StreamBatchDirection string

const (
    StreamBatchDirectionInbound StreamBatchDirection = "inbound"
    StreamBatchDirectionOutbound StreamBatchDirection = "outbound"
)

type StreamBatchEventHookContext interface {
    Direction() StreamBatchDirection
}

// each provider will have its own event type that implements the StreamEvent interface
type NatsEvent struct {
    ProviderID string
    Subject string
    Data json.RawMessage
    Metadata map[string]string
}
// StreamBatchEventHook processes a batch of stream events (inbound or outbound).  
//  
// Return:  
//   - empty slice: drop all events.  
//   - non-empty slice: emit those events (can grow, shrink, or reorder the batch).  
// err != nil: abort the subscription with an error.  
type StreamBatchEventHook interface {
    OnStreamEvents(ctx StreamBatchEventHookContext, events []StreamEvent) ([]StreamEvent, error)
}

func (m *MyModule) OnStreamEvents(
    ctx StreamBatchEventHookContext,
    events []StreamEvent,
) ([]StreamEvent, error) {
    // we only rewrite the data for outbound events
    if ctx.Direction() == StreamBatchDirectionInbound {
        return events, nil
    }

    newEvents := make([]StreamEvent, 0, len(events))
    for _, evt := range events {
        if natsEvent, ok := evt.(*NatsEvent); ok {
            if natsEvent.Subject == "topic-with-internal-data-format" {
                // unmarshal the event data that we received from the provider
                var dataReceived struct {
                    Id string `json:"id"`
                    TypeName string `json:"__typename"`
                }
                err := json.Unmarshal(natsEvent.Data(), &dataReceived)
                if err != nil {
                    return events, fmt.Errorf("error unmarshalling data: %w", err)
                }

                // prepare the data to send to the provider to be usable from external systems
                var dataToSend struct {
                    EmployeeId string `json:"EmployeeId"`
                    OtherField string `json:"OtherField"`
                }
                dataToSend.EmployeeId = dataReceived.Id
                dataToSend.OtherField = "Custom value"
                dataToSendMarshalled, err := json.Marshal(dataToSend)
                if err != nil {
                    return events, fmt.Errorf("error marshalling data: %w", err)
                }
                newEvent := &NatsEvent{
                    ProviderID: natsEvent.ProviderID,
                    Subject: natsEvent.Subject,
                    Data: dataToSendMarshalled,
                    Metadata: map[string]string{
                        "entity-id": dataReceived.Id,
                        "entity-domain": "employee",
                    },
                }
                newEvents = append(newEvents, newEvent)
                continue
            }
        }
        newEvents = append(newEvents, evt)
    }
    return newEvents, nil
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

Add a new hooks to the stream lifecycle `StreamBatchEventHook` which will be called once for each event received from the provider and once for each event that is going to be sent to the provider.

The `StreamBatchEventHook` will be called for each event received from the provider and each event that is going to be sent to the provider, making it possible to rewrite the event data to a format usable within Cosmo streams or by external systems.

The hook arguments are:
* `ctx StreamBatchEventHookContext`: The stream context, which contains the ID and type of the stream (inbound or outbound)
* `events []StreamEvent`: The events received from the provider or the events that are going to be sent to the provider

The hook will return a new slice of events that will be used to emit the events to the client or to the provider.
The hook will also return an error if one of the events cannot be processed, preventing the event from being processed.

I also considered exposing the subscription context to the hook, but this would be too easy to misuse. Users might add subscription-specific data to an event that will be sent to multiple providers. To make it safe, I would need to copy the entire event data for each pair of event and subscription that needs to receive it.  

#### Do we need a new hook?

Another possible solution for mapping outward data would be to use the existing middleware hooks `RouterOnRequestHandler` or `RouterMiddlewareHandler` to intercept the mutation, access the stream context, and emit the event to the stream. However, this would require exposing a stream context in the request lifecycle, which is difficult. It would also require coordination to ensure that an event emitted on the stream is sent only after the subscription starts.

Additionally, this solution is not usable on the subscription side of streams:
- The middleware hook is linked to the request lifecycle, making it difficult to use them to rewrite event data
- When we use the streams feature internally, we will still need to provide a way to rewrite event data, requiring a new hook in the subscription lifecycle

Therefore, I believe the best solution is to add a new hooks to the stream lifecycle.

## Event Filtering

We need to allow customers to filter events based on custom logic. We currently only provide declarative filters, which are quite limited.

### Example: Filter events based on stream configuration and client's scopes

```go
// the structs are reported only with the fields that are used in the example
type StreamEvent interface {
    Data() []byte
    SetData(data []byte)
}

type SubscriptionEventConfiguration interface {
    ProviderID() string
}

type StreamBatchDirection string

const (
    StreamBatchDirectionInbound StreamBatchDirection = "inbound"
    StreamBatchDirectionOutbound StreamBatchDirection = "outbound"
)

type StreamBatchEventHookContext interface {
    Direction() StreamBatchDirection
    RequestContext() RequestContext
}

// each provider will have its own event type that implements the StreamEvent interface
type NatsEvent struct {
    ProviderID string
    Subject string
    Data json.RawMessage
    Metadata map[string]string
}
// StreamBatchEventHook processes a batch of stream events (inbound or outbound).  
//  
// Return:  
//   - empty slice: drop all events.  
//   - non-empty slice: emit those events (can grow, shrink, or reorder the batch).  
// err != nil: abort the subscription with an error.  
type StreamBatchEventHook interface {
    OnStreamEvents(ctx StreamBatchEventHookContext, events []StreamEvent) ([]StreamEvent, error)
}

type MyModule struct {}

func (m *MyModule) OnStreamEvents(ctx StreamBatchEventHookContext, events []StreamEvent) ([]StreamEvent, error) {
    // we only filter the events for inbound events
    if ctx.Direction() == StreamBatchDirectionOutbound {
        return events, nil
    }

    newEvents := make([]StreamEvent, 0, len(events))
    clientAllowedEntitiesIds, found := ctx.RequestContext().Authentication().Claims()["allowedEntitiesIds"]
    if !found {
        return newEvents, nil
    }

    for _, evt := range events {
        if natsEvent, ok := evt.(*NatsEvent); ok {
            if natsEvent.Subject == "topic-with-internal-data-format" {
                idHeader, ok := natsEvent.Metadata["entity-id"]
                if !ok {
                    continue
                }
                if slices.Contains(clientAllowedEntitiesIds, idHeader) {
                    newEvents = append(newEvents, evt)
                }
            }
        }
    }
    return newEvents, nil
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

We can use the new `StreamBatchEventHook` to filter events based on the stream configuration and the client's scopes.

The hook arguments are:
* `ctx StreamBatchEventHookContext`: The stream context, which contains the ID and type of the stream (inbound or outbound) and the request context
* `events []StreamEvent`: The events received from the provider or the events that are going to be sent to the provider

The hook will return a new slice of events that will be used to emit the events to the client or to the provider.
The hook will also return an error if one of the events cannot be processed, preventing the event from being processed.

## Architecture

With this proposal, we will add a new hook to the subscription and stream lifecycles.

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
One or more batched events are received from the provider
    │
    └─▶ core.StreamBatchEventHook (Data mapping, Filtering)
    │
    └─▶ "Deliver events to client"

One or more batched events are sent to the provider
    │
    └─▶ core.StreamBatchEventHook (Data mapping, Filtering)
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
- Especially the casting of the event to the specific type for the provider could raise a panic if the event is not of the expected type and the developer is not using the type check
- We should add metrics to track how much time is spent in each hook, to help customers identify slow hooks
