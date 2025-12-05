# RFC Cosmo Streams V1

Based on customer feedback, we've identified the need for more customizable stream behavior. The key areas for customization include:
- **Authorization**: Implementing authorization checks at the start of subscriptions
- **Initial message**: Sending an initial message to clients upon subscription start
- **Data mapping**: Transforming events data from the format that could be used by the external system to/from Federation compatible Router events
- **Event filtering**: Filtering events using custom logic

Let's explore how we can address each of these requirements.

## Authorization

To support authorization, we need a hook that enables the following key decisions:
- Whether the client or user is authorized to initiate the subscription
- Which topics the client is permitted to subscribe to
- Whether the client is allowed to consume an event from the stream (covered by the Event Filtering hook)

Additionally, a similar mechanism is required for non-stream subscriptions, allowing:
- Custom JWT validation logic (e.g., expiration checks, signature verification, secret handling)
- The ability to reject unauthenticated or unauthorized requests and close the subscription accordingly

We already allow some customization using `RouterOnRequestHandler`, but it has no access to the stream data. To access this data, we need to add a new hook that will be called immediately before the subscription starts.

### Example: Check if the client is allowed to subscribe to the stream

```go
// the interfaces/structs are reported partially to make the example more readable
// the full new interfaces/structs are available in the appendix 1

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

type StreamHookError struct {
    HttpError core.HttpError
    CloseSubscription bool
}

type MyModule struct {}

// This is a custom function that will be used to check if the client is allowed to subscribe to the stream
func customCheckIfClientIsAllowedToSubscribe(ctx SubscriptionOnStartHookContext) bool {
    // check if the field name is the one expected by the module
    if ctx.SubscriptionEventConfiguration().RootFieldName() != "employeeUpdates" {
        return true
    }

    // get the specific configuration for the provider to make more advanced checks
    cfg, ok := ctx.SubscriptionEventConfiguration().(*NatsSubscriptionEventConfiguration)
    if !ok {
        return true
    }

    providerId := cfg.ProviderID
    auth := ctx.RequestContext().Authentication()
    
    // add checks here on client authentication scopes, provider ID, etc.

    return false
}

// This is the new hook that will be called once at subscription start
func (m *MyModule) SubscriptionOnStart(ctx SubscriptionOnStartHookContext) error {
    // check if the client is allowed to subscribe to the stream
    if !customCheckIfClientIsAllowedToSubscribe(ctx) {
        // if not, return an error to prevent the subscription from starting
        return StreamHookError{
            HttpError: core.NewHttpGraphqlError(
                "you should be an admin to subscribe to this or only subscribe to public subscriptions!",
                 "UNAUTHORIZED", 
                 http.StatusUnauthorized,
            ), CloseSubscription: true,
        }
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
* `ctx SubscriptionOnStartHookContext`: The subscription context, which contains the request context and, optionally, the subscription event configuration, and a method to emit the event to the stream

`RequestContext` already exists and requires no changes, but `SubscriptionEventConfiguration` is new.

The hook should return an error if the client is not allowed to subscribe to the stream, preventing the subscription from starting.
The hook should return `nil` if the client is allowed to subscribe to the stream, allowing the subscription to proceed.

The hook can return a `SubscriptionHookError` to customize the error messages and the behavior on the subscription.

I evaluated the possibility of adding the `SubscriptionContext` to the request context and using it within one of the existing hooks, but it would be difficult to build the subscription context without executing the pubsub code.

The `SubscriptionEventConfiguration()` contains the subscription configuration as used by the provider. This allows the hooks system to be provider-agnostic, so adding a new provider will not require changes to the hooks system. To use specific fields, the hook can cast the configuration to the specific type for the provider.
The `WriteEvent()` method is new and allows the hook to emit the event to the stream.

## Initial Message

When starting a subscription, the client sends a query to the server containing the operation name and variables. The client must then wait for the broker to send the initial message. This waiting period can lead to a poor user experience, as the client cannot display anything until the initial message is received. To address this, we can emit an initial message on subscription start.

To emit an initial message on subscription start, we need access to the stream context (to get the provider type and ID) and the query that the client sent. The variables are particularly important, as they allow the module to use them in the initial message. For example, if someone starts a subscription with employee ID 100 as a variable, the custom module can include that ID in the initial message.

### Example

```go
// the interfaces/structs are reported partially to make the example more readable
// the full new interfaces/structs are available in the appendix 1

// This is the new hook that will be called once at stream start
type SubscriptionOnStartHandler interface {
    SubscriptionOnStart(ctx SubscriptionOnStartHookContext) error
}

// each provider will have its own event type that implements the StreamEvent interface
type NatsEvent struct {
    Data json.RawMessage
    Metadata map[string]string
}

type MyModule struct {}

// This is the new hook that will be called once at subscription start
func (m *MyModule) SubscriptionOnStart(ctx SubscriptionOnStartHookContext) error {
    // get the operation name and variables that we need
    opName := ctx.RequestContext().Operation().Name()
    opVarId := ctx.RequestContext().Operation().Variables().GetInt("id")

    // check if the provider ID is the one expected by the module
    if ctx.SubscriptionEventConfiguration().ProviderID() != "my-provider-id" {
        return nil
    }

    //check if the provider type is the one expected by the module
    if ctx.SubscriptionEventConfiguration().ProviderType() != pubsub.ProviderTypeNats {
        return nil
    }
    
    // check if the operation name is the one expected by the module
    if opName == "employeeSub" {
        // create the event to emit using the operation variables
        evt := &NatsEvent{
            Data: []byte(fmt.Sprintf("{\"id\": \"%d\", \"__typename\": \"Employee\"}", opVarId)),
            Metadata: map[string]string{
                "entity-id": fmt.Sprintf("%d", opVarId),
            },
        }
        // emit the event to the stream, that will be received only by the client that subscribed to the stream
        ctx.WriteEvent(evt)
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

To emit the message, I propose adding a new method to the stream context, `WriteEvent`, which will emit the event to the stream at the lowest level. The message will pass through all hooks, making it behave like any other event received from the provider. The message will be received only by the client that subscribed to the stream, and not by the other clients that subscribed to the same stream.

The `StreamEvent` contains the data as used by the provider. This allows the hooks system to be provider-agnostic, so adding a new provider will not require changes to the hooks system. To use events, the hook has to cast the event to the specific type for the provider.

This change will require adding a new type in each provider package to represent the event with additional fields (metadata, etc.). This is a significant change, but it is necessary to support additional data in events, anyway, even if we don't expose them to the custom modules.

Emitting the initial message with this hook ensures that the client will receive the message before the first event from the provider is received.

## Data Mapping

The current approach for emitting and reading data from the stream is not flexible enough. We need to be able to map data from an external format to the internal format, and vice versa.

Also, different providers can have different additional fields other than the message body.

As an example:
- NATS provider can have a `Metadata` field
- Kafka provider can have a `Headers` and `Key` fields

And this additional fields could be an important part of integrating with external systems.

### Example 1: Rewrite the event received from the provider to a format that is usable by Cosmo streams

```go
// the interfaces/structs are reported partially to make the example more readable
// the full new interfaces/structs are available in the appendix 1

// each provider will have its own event type that implements the StreamEvent interface
type NatsEvent struct {
    Data json.RawMessage
    Metadata map[string]string
}
type KafkaEvent struct {
    Key []byte
    Data json.RawMessage
    Headers map[[]byte][]byte
}

// StreamBatchEventHook processes a batch of inbound stream events  
//  
// Return:  
//   - empty slice: drop all events.  
//   - non-empty slice: emit those events (can grow, shrink, or reorder the batch).  
// err != nil: abort the subscription with an error.  
type StreamBatchEventHook interface {
    OnStreamEvents(ctx StreamBatchEventHookContext, events []StreamEvent) ([]StreamEvent, error)
}

type MyModule struct {}

// This is the new hook that will be called each time a batch of events is received from the provider
func (m *MyModule) OnStreamEvents(
    ctx StreamBatchEventHookContext,
    events []StreamEvent,
) ([]StreamEvent, error) {
    // check if the provider ID is the one expected by the module
    if ctx.SubscriptionEventConfiguration().ProviderID() != "my-provider-id" {
        return events, nil
    }

    // check if the provider type is the one expected by the module
    if ctx.SubscriptionEventConfiguration().ProviderType() != pubsub.ProviderTypeNats {
        return events, nil
    }

    // check if the subject is the one expected by the module
    natsConfig := ctx.SubscriptionEventConfiguration().(*nats.SubscriptionEventConfiguration)
    if natsConfig.Subjects[0] != "topic-with-internal-data-format" {
        return events, nil
    }

    // create a new slice of events that we will return with the events with the new format
    newEvents := make([]StreamEvent, 0, len(events))
    for _, evt := range events {
        // check if the event is the one expected by the module
        if natsEvent, ok := evt.(*NatsEvent); ok {
            // here you can umarshal the old data and map it to the new format
            // for example:
            // var dataReceived struct {
            //     EmployeeName string `json:"EmployeeName"`
            // }
            // err := json.Unmarshal(natsEvent.Data, &dataReceived)

            // if we have to extract the data from the metadata fields, we can do it like this:
            entityId := natsEvent.Metadata["entity-id"]
            entityType := natsEvent.Metadata["entity-type"]
            // and prepare the new event with the data inside
            newDataFormat, _ := json.Marshal(map[string]string{
                "id": entityId,
                "name": dataReceived.EmployeeName,
                "__typename": entityType,
            })

            // create the new event
            newEvent := &NatsEvent{
                Data: newDataFormat,
                Metadata: natsEvent.Metadata,
            }

            // or for Kafka we would have something like:
            // newEvent := &KafkaEvent{
            //     Key: kafkaEvent.Key,
            //     Data: newDataFormat,
            //     Headers: kafkaEvent.Headers,
            // }

            // add the new event to the slice of events to return
            newEvents = append(newEvents, newEvent)
            continue
        }
        // add the original event to the slice of events to return
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

### Example 2: Rewrite the event before emitting it to the provider to a format that is usable by external systems

```go
// the interfaces/structs are reported partially to make the example more readable
// the full new interfaces/structs are available in the appendix 1

// StreamPublishEventHook processes a batch of outbound stream events  
//  
// Return:  
//   - empty slice: drop all events.  
//   - non-empty slice: emit those events (can grow, shrink, or reorder the batch).  
// err != nil: abort the subscription with an error.  
type StreamPublishEventHook interface {
    OnPublishEvents(ctx StreamPublishEventHookContext, events []StreamEvent) ([]StreamEvent, error)
}

// each provider will have its own event type that implements the StreamEvent interface
type NatsEvent struct {
    Data json.RawMessage
    Metadata map[string]string
}

type MyModule struct {}

// This is the new hook that will be called each time a batch of events is going to be sent to the provider
func (m *MyModule) OnPublishEvents(
    ctx StreamPublishEventHookContext,
    events []StreamEvent,
) ([]StreamEvent, error) {
    // check if the provider ID is the one expected by the module
    if ctx.PublishEventConfiguration().ProviderID() != "my-provider-id" {
        return events, nil
    }

    // check if the provider type is the one expected by the module
    if ctx.PublishEventConfiguration().ProviderType() != pubsub.ProviderTypeNats {
        return events, nil
    }

    // check if the subject is the one expected by the module
    natsConfig := ctx.PublishEventConfiguration().(*nats.PublishAndRequestEventConfiguration)
    if natsConfig.Subject != "topic-with-internal-data-format" {
        return events, nil
    }

    // create a new slice of events that we will return with the events with the new format
    newEvents := make([]StreamEvent, 0, len(events))
    for _, evt := range events {
        // check if the event is the one expected by the module
        if natsEvent, ok := evt.(*NatsEvent); ok {
            // here you can umarshal the old data and map it to the new format
            // for example:
            // var dataReceived struct {
            //     EmployeeId string `json:"EmployeeId"`
            // }
            // err := json.Unmarshal(natsEvent.Data, &dataReceived)

            // create the new event
            newEvent := &NatsEvent{
                Data: dataToSendMarshalled,
                Metadata: map[string]string{
                    "entity-id": dataReceived.Id,
                    "entity-domain": "employee",
                },
            }

            // add the new event to the slice of events to return
            newEvents = append(newEvents, newEvent)
            continue
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

Add two new hooks to the stream lifecycle: `StreamBatchEventHook` and `StreamPublishEventHook`.
The `StreamBatchEventHook` will be called each time a batch of events is received from the provider, making it possible to rewrite, filter or split the event data to a format usable within Cosmo streams.
The `StreamPublishEventHook` will be called each time a batch of events is going to be sent to the provider, making it possible to rewrite, filter or split the event data to a format usable by external systems.

The hook arguments of `StreamBatchEventHook` are:
* `ctx StreamBatchEventHookContext`: The stream context, which contains the provider ID and the subscription configuration
* `events []StreamEvent`: The events received from the provider

The hook will return a new slice of events that will be used to emit the events to the client.
The hook will also return an error if one of the events cannot be processed, preventing the events from being processed.

The hook arguments of `StreamPublishEventHook` are:
* `ctx StreamPublishEventHookContext`: The stream context, which contains the provider ID and the publish configuration
* `events []StreamEvent`: The events that are going to be sent to the provider

The hook will return a new slice of events that will be used to emit the events to the provider.
The hook will also return an error if one of the events cannot be processed, preventing the events from being processed.

#### Do we need two new hooks?

Another possible solution for mapping outward data would be to use the existing middleware hooks `RouterOnRequestHandler` or `RouterMiddlewareHandler` to intercept the mutation, access the stream context, and emit the event to the stream. However, this would require exposing a stream context in the request lifecycle, which is difficult. It would also require coordination to ensure that an event emitted on the stream is sent only after the subscription starts.

Additionally, this solution is not usable on the subscription side of streams:
- The middleware hook is linked to the request lifecycle, making it difficult to use them to rewrite event data
- When we use the streams feature internally, we will still need to provide a way to rewrite event data, requiring a new hook in the subscription lifecycle

Therefore, I believe the best solution is to add a new hooks to the stream lifecycle.

## Event Filtering

We need to allow customers to filter events based on custom logic. We currently only provide declarative filters, which are quite limited.
The event filtering hook will also be useful to implement the authorization logic at the events level.

### Example: Filter events based on stream configuration and client's scopes

```go
// the interfaces/structs are reported partially to make the example more readable
// the full new interfaces/structs are available in the appendix 1

// StreamBatchEventHook processes a batch of inbound stream events.  
//  
// Return:  
//   - empty slice: drop all events.  
//   - non-empty slice: emit those events (can grow, shrink, or reorder the batch).  
// err != nil: abort the subscription with an error.  
type StreamBatchEventHook interface {
    OnStreamEvents(ctx StreamBatchEventHookContext, events []StreamEvent) ([]StreamEvent, error)
}

// each provider will have its own event type that implements the StreamEvent interface
type NatsEvent struct {
    Data json.RawMessage
    Metadata map[string]string
}

type MyModule struct {}

// This is the new hook that will be called each time a batch of events is received from the provider
func (m *MyModule) OnStreamEvents(ctx StreamBatchEventHookContext, events []StreamEvent) ([]StreamEvent, error) {
    // check if the provider ID is the one expected by the module
    if ctx.SubscriptionEventConfiguration().ProviderID() != "my-provider-id" {
        return events, nil
    }

    // check if the provider type is the one expected by the module
    if ctx.SubscriptionEventConfiguration().ProviderType() != pubsub.ProviderTypeNats {
        return events, nil
    }

    // check if the subject is the one expected by the module
    natsConfig := ctx.SubscriptionEventConfiguration().(*nats.SubscriptionEventConfiguration)
    if natsConfig.Subjects[0] != "topic-with-internal-data-format" {
        return events, nil
    }

    // create a new slice of events that we will return with the events that are allowed to be received by the client
    newEvents := make([]StreamEvent, 0, len(events))

    
    if ctx.RequestContext().Authentication() == nil {
        // if the client is not authenticated, return no events
        return newEvents, nil
    }

    // get the client's allowed entities IDs
    clientAllowedEntitiesIds, found := ctx.RequestContext().Authentication().Claims()["allowedEntitiesIds"]
    if !found {
        // if the client doesn't have allowed entities IDs, return the original events
        return newEvents, nil
    }

    for _, evt := range events {
        // check if the event is the one expected by the module
        if natsEvent, ok := evt.(*NatsEvent); ok {
            // check the entity ID in the metadata
            idHeader, ok := natsEvent.Metadata["entity-id"]
            if !ok {
                continue
            }
            // check if the entity ID is in the client's allowed entities IDs
            if slices.Contains(clientAllowedEntitiesIds, idHeader) {
                // add the event to the slice of events to return because the client is allowed to receive it
                newEvents = append(newEvents, evt)
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
* `ctx StreamBatchEventHookContext`: The stream context, which contains the ID of the stream and the request context
* `events []StreamEvent`: The events received from the provider or the events that are going to be sent to the provider

The hook will return a new slice of events that will be used to emit the events to the client or to the provider.
The hook will also return an error if one of the events cannot be processed, preventing the event from being processed.

## Architecture

With this proposal, we will add two new hooks to stream lifecycles and other hooks to the subscription lifecycle.

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

One or more batched events are published to the provider
    │
    └─▶ core.StreamPublishEventHook (Data mapping, Filtering)
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

## Development workflow of subscription with custom modules

Lets build an example of how the development workflow would look like for a developer that want to add a custom module to the cosmo streams engine. The idea is to build a module that will be used to subscribe to the `employeeUpdates` subject and filter the events based on the client's scopes and remapping the messages as they are expected from the `Employee` type.

I'll show the workflow for a developer that wants to customize the subscription, but the same workflow can be applied to the mutation.

### Add a subscription to the cosmo streams graphql schema

The developer will start by adding a subscription to the cosmo streams graphql schema.
```graphql
type Subscription {
    employeeUpdates(): Employee! @edfs__natsSubscribe(subjects: ["employeeUpdates"], providerId: "my-nats")
}

type Employee @key(fields: "id", resolvable: false) {
  id: Int! @external
}
```
After publishing the schema, the developer will need to add the module to the cosmo streams engine.

### 2. Write the custom module

The developer will need to write the custom module that will be used to subscribe to the `employeeUpdates` subject and filter the events based on the client's scopes and remapping the messages as they are expected from the `Employee` type.

```go
package mymodule

import (
    "encoding/json"
    "slices"
    "github.com/wundergraph/cosmo/router/core"
    "github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
)

func init() {
	// Register your module here and it will be loaded at router start
	core.RegisterModule(&MyModule{})
}

type MyModule struct {}

func (m *MyModule) OnStreamEvents(ctx StreamBatchEventHookContext, events []core.StreamEvent) ([]core.StreamEvent, error) {
    // check if the provider is nats
    if ctx.SubscriptionEventConfiguration().ProviderType() != pubsub.ProviderTypeNats {
        return events, nil
    }

    // check if the provider id is the one expected by the module
    if ctx.SubscriptionEventConfiguration().ProviderID() != "my-nats" {
        return events, nil
    }

    // check if the subject is the one expected by the module
    natsConfig := ctx.SubscriptionEventConfiguration().(*nats.SubscriptionEventConfiguration)
    if natsConfig.Subjects[0] != "employeeUpdates" {
        return events, nil
    }

    // check if the client is authenticated
    if ctx.RequestContext().Authentication() == nil {
        // if the client is not authenticated, return no events
        return events, nil
    }

    // check if the client is allowed to subscribe to the stream
    clientAllowedEntitiesIds, found := ctx.RequestContext().Authentication().Claims()["allowedEntitiesIds"]
    if !found {
        return events, fmt.Errorf("client is not allowed to subscribe to the stream")
    }

    newEvents := make([]core.StreamEvent, 0, len(events))

    for _, evt := range events {
        natsEvent, ok := evt.(*nats.NatsEvent);
        if !ok {
            newEvents = append(newEvents, evt)
            continue
        }

        // decode the event data coming from the provider
        var dataReceived struct {
            EmployeeId string `json:"EmployeeId"`
            OtherField string `json:"OtherField"`
        }
        err := json.Unmarshal(natsEvent.Data, &dataReceived)
        if err != nil {
            return events, fmt.Errorf("error unmarshalling data: %w", err)
        }

        // filter the events based on the client's scopes
        if !slices.Contains(clientAllowedEntitiesIds, dataReceived.EmployeeId) {
            continue
        }

        // prepare the data to send to the client
        var dataToSend struct {
            Id string `json:"id"`
            TypeName string `json:"__typename"`
        }
        dataToSend.Id = dataReceived.EmployeeId
        dataToSend.TypeName = "Employee"

        // marshal the data to send to the client
        dataToSendMarshalled, err := json.Marshal(dataToSend)
        if err != nil {
            return events, fmt.Errorf("error marshalling data: %w", err)
        }

        // create the new event
        newEvent := &nats.NatsEvent{
            Data: dataToSendMarshalled,
            Metadata: natsEvent.Metadata,
        }
        newEvents = append(newEvents, newEvent)
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

// Interface guards
var (
	_ core.StreamBatchEventHook = (*MyModule)(nil)
)
```

### 3. Add the provider configuration to the cosmo router
```yaml
version: "1"

events:
  providers:
    nats:
      - id: my-nats
        url: "nats://localhost:4222"
```

### 4. Build the cosmo router with the custom module

Build and run the router with the custom module added.

## Appendix 1, new data structures

```go
// NEW HOOKS

// SubscriptionOnStartHandler is a hook that is called once at subscription start
// it is used to validate if the client is allowed to subscribe to the stream
// if returns an error, the subscription will not start
type SubscriptionOnStartHandler interface {
    SubscriptionOnStart(ctx SubscriptionOnStartHookContext) error
}

// StreamBatchEventHook processes a batch of inbound stream events  
//  
// Return:  
//   - empty slice: drop all events.  
//   - non-empty slice: emit those events (can grow, shrink, or reorder the batch).  
// err != nil: abort the subscription with an error.  
type StreamBatchEventHook interface {
    OnStreamEvents(ctx StreamBatchEventHookContext, events []StreamEvent) ([]StreamEvent, error)
}

// StreamPublishEventHook processes a batch of outbound stream events  
//  
// Return:  
//   - empty slice: drop all events.  
//   - non-empty slice: emit those events (can grow, shrink, or reorder the batch).  
// err != nil: abort the subscription with an error.  
type StreamPublishEventHook interface {
    OnPublishEvents(ctx StreamPublishEventHookContext, events []StreamEvent) ([]StreamEvent, error)
}

// NEW INTERFACES
type SubscriptionEventConfiguration interface {
    ProviderID() string
    ProviderType() string
    RootFieldName() string // the root field name of the subscription in the schema
}

type PublishEventConfiguration interface {
    ProviderID() string
    ProviderType() string
    RootFieldName() string // the root field name of the mutation in the schema
}

type StreamEvent interface {}

type StreamBatchEventHookContext interface {
    RequestContext() RequestContext
    SubscriptionEventConfiguration() SubscriptionEventConfiguration
}

type StreamPublishEventHookContext interface {
    RequestContext() RequestContext
    PublishEventConfiguration() PublishEventConfiguration
}

type SubscriptionOnStartHookContext interface {
    RequestContext() RequestContext
    SubscriptionEventConfiguration() SubscriptionEventConfiguration
    WriteEvent(event core.StreamEvent)
}

// ALREADY EXISTING INTERFACES THAT WILL BE UPDATED
type OperationContext interface {
    Name() string
    // the variables are currently not available, so we need to add them here
    Variables() *astjson.Value
}

// NEW STRUCTURES
// StreamHookError is used to customize the error messages and the behavior
type StreamHookError struct {
    HttpError core.HttpError
    CloseSubscription bool
}

func (e StreamHookError) Error() string {
    return e.HttpError.Message()
}

// STRUCTURES TO BE ADDED TO PUBSUB PACKAGE
type ProviderType string
const (
    ProviderTypeNats ProviderType = "nats"
    ProviderTypeKafka ProviderType = "kafka"
    ProviderTypeRedis ProviderType = "redis"
}

```

## Appendix 2, Using AsyncAPI for Event Data Structure

As a side note, it is important to find ways to document the data that is arriving and going out of the cosmo streams engine. This could allow some automatic code generation starting from the schema and the events data.
As an example, we are going to explore how AsyncAPI could be used to generate the data structures for the custom modules and assure the messages format.

### Example: AsyncAPI Integration for Custom Module Development

We propose integrating AsyncAPI specifications with Cosmo streams to generate type-safe Go structs that can be used in custom modules. This would significantly improve the developer experience by providing:

1. **Type Safety**: Generated structs prevent runtime errors from incorrect field access
2. **Documentation**: AsyncAPI specs serve as living documentation for event schemas
3. **Code Generation**: Automatic generation of Go structs from AsyncAPI specifications
4. **IDE Support**: Better autocomplete and error detection in development environments

### AsyncAPI Specification Example

So if we have as an example the following AsyncAPI specification:

```yaml
# employee-events.asyncapi.yaml
asyncapi: 3.0.0
info:
  title: Employee Events API
  version: 1.0.0
  description: Events related to employee updates in the system

channels:
  externalSystemEmployeeUpdates:
    messages:
      EmployeeUpdated:
        $ref: '#/components/messages/EmployeeUpdated'

components:
  messages:
    ExternalSystemEmployeeUpdated:
      name: ExternalSystemEmployeeUpdated
      title: External System Employee Updated Event
      summary: Sent when an employee is updated in the external system
      contentType: application/json
      payload:
        $ref: '#/components/schemas/ExternalSystemEmployeeFormat'

  schemas:
    ExternalSystemEmployeeFormat:
      type: object
      description: Employee data as received from external systems
      properties:
        EmployeeId:
          type: string
          description: Unique identifier for the employee
        EmployeeName:
          type: string
          description: Full name of the employee
        EmployeeEmail:
          type: string
          format: email
          description: Email address of the employee
        OtherField:
          type: string
          description: Additional field from external system
      required:
        - EmployeeId
        - EmployeeName
        - EmployeeEmail
```

### Code Generation Workflow

We could provide a CLI command to WGC to generate the Go structs from AsyncAPI specifications:

```bash
# Generate Go structs from AsyncAPI spec
wgc streams generate -i employee-events.asyncapi.yaml -o ./generated/events.go -p events
```

Before generating the code, we could add to the data that cosmo streams is expecting to receive and send.
```yaml
# cosmo-streams-events.asyncapi.yaml
asyncapi: 3.0.0
info:
  title: Cosmo Streams Employee Events API
  version: 1.0.0

channels:
  cosmoStreamsEmployeeUpdates:
    messages:
      CosmoStreamsEmployeeUpdated:
        $ref: '#/components/messages/CosmoStreamsEmployeeUpdated'

components:
  messages:
    CosmoStreamsEmployeeUpdated:
      name: CosmoStreamsEmployeeUpdated
      title: Cosmo Streams Employee Updated Event
      summary: Event published when updating an employee in the cosmo streams
      contentType: application/json
      payload:
        $ref: '#/components/schemas/EmployeeInternalFormat'

  schemas:
    CosmoStreamsEmployeeUpdated:
      type: object
      description: Employee data as used internally by Cosmo streams
      properties:
        id:
          type: string
          description: Unique identifier for the employee
        name:
          type: string
          description: Full name of the employee
        email:
          type: string
          format: email
          description: Email address of the employee
      required:
        - id
        - __typename
```

This command would be a wrapper around asyncapi modelina, and with some additional logic to extract the internal events format from the schema SDL.

This would generate a second async api specification and Go code like:

```go
// generated/events.go
package events

import (
    "encoding/json"
    "time"
)

// ExternalSystemEmployeeUpdated represents employee data as received from external systems
type ExternalSystemEmployeeUpdated struct {
    EmployeeId    string `json:"EmployeeId"`
    EmployeeName  string `json:"EmployeeName"`
    EmployeeEmail string `json:"EmployeeEmail"`
    OtherField    string `json:"OtherField"`
}

// EmployeeInternalFormat represents employee data as used internally by Cosmo streams
type CosmoStreamsEmployeeUpdated struct {
    Id       string `json:"id"`
    Name     string `json:"name"`
    Email    string `json:"email"`
}
```

We could than encourage the developers to add conversions in a file in the same package of the generated file, like so:

```go
// generated/events.go
package events

import (
    "encoding/json"
    "time"
)

func ExternalSystemEmployeeUpdatedToCosmoStreamsEmployeeUpdated(e *ExternalSystemEmployeeUpdated) *CosmoStreamsEmployeeUpdated {
    return &CosmoStreamsEmployeeUpdated{
        Id: e.EmployeeId,
        Name: e.EmployeeName, 
        Email: e.EmployeeEmail,
    }
}

```

Also, external systems could use the generated async api specification to generate the code for the events that they are sending/receiving to/from cosmo streams.

### Enhanced Custom Module Development

With generated structs, the custom module code becomes more maintainable and type-safe:

```go
package mymodule

import (
    "encoding/json"
    "fmt"
    "slices"
    
    "github.com/wundergraph/cosmo/router/core"
    "github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
    "your-project/generated/genevents"
)

type MyModule struct {}

func (m *MyModule) OnStreamEvents(ctx StreamBatchEventHookContext, events []core.StreamEvent) ([]core.StreamEvent, error) {
    if ctx.SubscriptionEventConfiguration().ProviderType() != pubsub.ProviderTypeNats {
        return events, nil
    }

    if ctx.SubscriptionEventConfiguration().ProviderID() != "my-nats" {
        return events, nil
    }

    natsConfig := ctx.SubscriptionEventConfiguration().(*nats.SubscriptionEventConfiguration)
    if natsConfig.Subjects[0] != "employeeUpdates" {
        return events, nil
    }

    clientAllowedEntitiesIds, found := ctx.RequestContext().Authentication().Claims()["allowedEntitiesIds"]
    if !found {
        return events, fmt.Errorf("client is not allowed to subscribe to the stream")
    }

    for _, evt := range events {
        natsEvent, ok := evt.(*nats.NatsEvent);
        if !ok {
            newEvents = append(newEvents, evt)
            continue
        }

        // Use generated struct for type-safe deserialization
        var dataReceived genevents.ExternalSystemEmployeeUpdated
        err := json.Unmarshal(natsEvent.Data, &dataReceived)
        if err != nil {
            return events, fmt.Errorf("error unmarshalling data: %w", err)
        }

        // Convert to internal format using generated method
        dataToSend := genevents.ExternalSystemEmployeeUpdatedToCosmoStreamsEmployeeUpdated(&dataReceived)

        // Marshal using the generated struct
        dataToSendMarshalled, err := json.Marshal(dataToSend)
        if err != nil {
            return events, fmt.Errorf("error marshalling data: %w", err)
        }

        // Create new event
        newEvent := &nats.NatsEvent{
            Data:       dataToSendMarshalled,
        }
        newEvents = append(newEvents, newEvent)
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

var _ core.StreamBatchEventHook = (*MyModule)(nil)
```

### Considerations

The developers would need to regenerate the code each time the AsyncAPI specification changes or the schema SDL changes.

### Outlook

In a second step, we could:
- allow the user to define their streams using AsyncAPI
- generate fully typesafe hooks with all events structures generated from the AsyncAPI specification