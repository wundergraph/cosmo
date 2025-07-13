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

type MyModule struct {}

// This is a custom function that will be used to check if the client is allowed to subscribe to the stream
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

// This is the new hook that will be called once at subscription start
func (m *MyModule) SubscriptionOnStart(ctx SubscriptionOnStartHookContext) error {
    // check if the client is allowed to subscribe to the stream
    if !customCheckIfClientIsAllowedToSubscribe(ctx) {
        // if not, return an error to prevent the subscription from starting
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
// the interfaces/structs are reported partially to make the example more readable
// the full new interfaces/structs are available in the appendix 1

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

// This is the new hook that will be called once at subscription start
func (m *MyModule) SubscriptionOnStart(ctx SubscriptionOnStartHookContext) error {
    // get the operation name and variables that we need
    opName := ctx.RequestContext().Operation().Name()
    opVarId := ctx.RequestContext().Operation().Variables().GetInt("id")
    
    // check if the operation name is the one expected by the module
    if opName == "employeeSub" {
        // create the event to emit using the operation variables
        evt := &NatsEvent{
            ProviderID: "employee-stream",
            Subject: "employee-stream",
            Data: []byte(fmt.Sprintf("{\"id\": \"%d\", \"__typename\": \"Employee\"}", opVarId)),
            Metadata: map[string]string{
                "entity-id": fmt.Sprintf("%d", opVarId),
            },
        }
        // emit the event to the stream, that will be received by the client
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
// the interfaces/structs are reported partially to make the example more readable
// the full new interfaces/structs are available in the appendix 1

// each provider will have its own event type that implements the StreamEvent interface
type NatsEvent struct {
    ProviderID string
    Subject string
    Data json.RawMessage
    Metadata map[string]string
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
    // create a new slice of events that we will return with the events with the new format
    newEvents := make([]StreamEvent, 0, len(events))
    for _, evt := range events {
        // check if the event is the one expected by the module
        if natsEvent, ok := evt.(*NatsEvent); ok {
            // check if the subject is the one expected by the module
            if natsEvent.Subject == "topic-with-internal-data-format" {
                // unmarshal the event data that we received from the provider
                var dataReceived struct {
                    EmployeeId string `json:"EmployeeId"`
                }
                err := json.Unmarshal(natsEvent.Data(), &dataReceived)
                if err != nil {
                    return events, fmt.Errorf("error unmarshalling data: %w", err)
                }

                // prepare the data to send to the client
                var dataForStream struct {
                    Id string `json:"id"`
                    Name string `json:"__typename"`
                }
                dataForStream.Id = dataReceived.EmployeeId
                dataForStream.Name = "Employee"

                // marshal the data to send to the client
                dataForStreamMarshalled, err := json.Marshal(dataForStream)
                if err != nil {
                    return events, fmt.Errorf("error marshalling data: %w", err)
                }

                // create the new event
                newEvent := &NatsEvent{
                    ProviderID: natsEvent.ProviderID,
                    Subject: natsEvent.Subject,
                    Data: dataForStreamMarshalled,
                    Metadata: natsEvent.Metadata,
                }
                // add the new event to the slice of events to return
                newEvents = append(newEvents, newEvent)
                continue
            }
        }
        // add the original event to the slice of events to return
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
    ProviderID string
    Subject string
    Data json.RawMessage
    Metadata map[string]string
}

type MyModule struct {}

// This is the new hook that will be called each time a batch of events is going to be sent to the provider
func (m *MyModule) OnPublishEvents(
    ctx StreamPublishEventHookContext,
    events []StreamEvent,
) ([]StreamEvent, error) {
    // create a new slice of events that we will return with the events with the new format
    newEvents := make([]StreamEvent, 0, len(events))
    for _, evt := range events {
        // check if the event is the one expected by the module
        if natsEvent, ok := evt.(*NatsEvent); ok {
            // check if the subject is the one expected by the module
            if natsEvent.Subject == "topic-with-internal-data-format" {
                // unmarshal the event data that we received from cosmo streams
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

                // create the new event
                newEvent := &NatsEvent{
                    ProviderID: natsEvent.ProviderID,
                    Subject: natsEvent.Subject,
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

The hook arguments are:
* `ctx StreamBatchEventHookContext`: The stream context, which contains the provider ID
* `events []StreamEvent`: The events received from the provider or the events that are going to be sent to the provider

The hook will return a new slice of events that will be used to emit the events to the client or to the provider.
The hook will also return an error if one of the events cannot be processed, preventing the event from being processed.

I also considered exposing the subscription context to the hook, but this would be too easy to misuse. Users might add subscription-specific data to an event that will be sent to multiple providers. To make it safe, I would need to copy the entire event data for each pair of event and subscription that needs to receive it.  

#### Do we need two new hooks?

Another possible solution for mapping outward data would be to use the existing middleware hooks `RouterOnRequestHandler` or `RouterMiddlewareHandler` to intercept the mutation, access the stream context, and emit the event to the stream. However, this would require exposing a stream context in the request lifecycle, which is difficult. It would also require coordination to ensure that an event emitted on the stream is sent only after the subscription starts.

Additionally, this solution is not usable on the subscription side of streams:
- The middleware hook is linked to the request lifecycle, making it difficult to use them to rewrite event data
- When we use the streams feature internally, we will still need to provide a way to rewrite event data, requiring a new hook in the subscription lifecycle

Therefore, I believe the best solution is to add a new hooks to the stream lifecycle.

## Event Filtering

We need to allow customers to filter events based on custom logic. We currently only provide declarative filters, which are quite limited.

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
    ProviderID string
    Subject string
    Data json.RawMessage
    Metadata map[string]string
}

type MyModule struct {}

// This is the new hook that will be called each time a batch of events is received from the provider
func (m *MyModule) OnStreamEvents(ctx StreamBatchEventHookContext, events []StreamEvent) ([]StreamEvent, error) {
    // create a new slice of events that we will return with the events that are allowed to be received by the client
    newEvents := make([]StreamEvent, 0, len(events))

    // get the client's allowed entities IDs
    clientAllowedEntitiesIds, found := ctx.RequestContext().Authentication().Claims()["allowedEntitiesIds"]
    if !found {
        // if the client doesn't have allowed entities IDs, return the original events
        return newEvents, nil
    }

    for _, evt := range events {
        // check if the event is the one expected by the module
        if natsEvent, ok := evt.(*NatsEvent); ok {
            // check if the subject is the one expected by the module
            if natsEvent.Subject == "topic-with-internal-data-format" {
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

One or more batched events are sent to the provider
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

### 1. Add a subscription to the cosmo streams graphql schema

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
    if ctx.StreamContext().ProviderType() != "nats" {
        return events, nil
    }

    // check if the client is allowed to subscribe to the stream
    clientAllowedEntitiesIds, found := ctx.RequestContext().Authentication().Claims()["allowedEntitiesIds"]
    if !found {
        return events, fmt.Errorf("client is not allowed to subscribe to the stream")
    }

    newEvents := make([]core.StreamEvent, 0, len(events))

    for _, evt := range events {
        if natsEvent, ok := evt.(*nats.NatsEvent); ok {
            // check if the subject is the one expected by the module
            if natsEvent.Subject != "employeeUpdates" {
                newEvents = append(newEvents, evt)
                continue
            }
            
            // check if the provider id is the one expected by the module
            if natsEvent.ProviderID != "my-nats" {
                newEvents = append(newEvents, evt)
                continue
            }

            // decode the event data coming from the provider
            var dataReceived struct {
                EmployeeId string `json:"EmployeeId"`
                OtherField string `json:"OtherField"`
            }
            err := json.Unmarshal(natsEvent.Data(), &dataReceived)
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
                ProviderID: natsEvent.ProviderID,
                Subject: natsEvent.Subject,
                Data: dataToSendMarshalled,
                Metadata: natsEvent.Metadata,
            }
            newEvents = append(newEvents, newEvent)
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



## Development workflow of cosmo streams mutation with custom modules

Lets build an example of how the development workflow would look like for a developer that want to add a custom module to the cosmo streams engine. The idea is to build a module that will be used to subscribe to the `employeeUpdates` subject and filter the events based on the client's scopes and remapping the messages as they are expected from the `Employee` type.

### 1. Add a mutation to the cosmo streams graphql schema

The developer will start by adding a mutation to the cosmo streams graphql schema.
```graphql
type Mutation {
    updateEmployee(id: Int!, update: UpdateEmployeeInput!): edfs__PublishResult! @edfs__natsPublish(subject: "employeeUpdated", providerId: "my-nats")
}

input UpdateEmployeeInput {
    name: String
    email: String
}
```
After publishing the schema, the developer will need to add the module to the cosmo streams engine.

### 2. Write the custom module

The developer will need to write the custom module that will be used to publish the event to the `employeeUpdated` subject. It will also be used to validate if the client is allowed to publish the event and to remap the data to the expected format.

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

func (m *MyModule) OnStreamPublish(ctx StreamPublishEventHookContext, events []core.StreamEvent) ([]core.StreamEvent, error) {
    // check if the provider is nats
    if ctx.StreamContext().ProviderType() != "nats" {
        return events, nil
    }

    // check if the client is allowed to publish the event
    clientAllowedEntitiesIds, found := ctx.RequestContext().Authentication().Claims()["allowedEntitiesIds"]
    if !found {
        return events, fmt.Errorf("client is not allowed to publish the event")
    }

    newEvents := make([]core.StreamEvent, 0, len(events))

    for _, evt := range events {
        if natsEvent, ok := evt.(*nats.NatsEvent); ok {
            // check if the subject is the one expected by the module
            if natsEvent.Subject != "employeeUpdated" {
                newEvents = append(newEvents, evt)
                continue
            }

            // check if the provider id is the one expected by the module
            if natsEvent.ProviderID != "my-nats" {
                newEvents = append(newEvents, evt)
                continue
            }

            // decode the event data coming from cosmo streams
            var dataReceived struct {
                Id string `json:"id"`
                Name string `json:"name"`
                Email string `json:"email"`
            }
            err := json.Unmarshal(natsEvent.Data(), &dataReceived)
            if err != nil {
                return events, fmt.Errorf("error unmarshalling data: %w", err)
            }

            // skip the event if the client is not allowed to publish the event
            if !slices.Contains(clientAllowedEntitiesIds, dataReceived.Id) {
                continue
            }

            // prepare the data to send to the client
            var dataToSend struct {
                EmployeeId string `json:"employeeId"`
                EmployeeName string `json:"employeeName"`
                EmployeeEmail string `json:"employeeEmail"`
            }
            dataToSend.EmployeeId = dataReceived.Id
            dataToSend.EmployeeName = dataReceived.Name
            dataToSend.EmployeeEmail = dataReceived.Email

            // marshal the data to send to the client
            dataToSendMarshalled, err := json.Marshal(dataToSend)
            if err != nil {
                return events, fmt.Errorf("error marshalling data: %w", err)
            }

            // create the new event
            newEvent := &nats.NatsEvent{
                ProviderID: natsEvent.ProviderID,
                Subject: natsEvent.Subject,
                Data: dataToSendMarshalled,
                Metadata: natsEvent.Metadata,
            }
            newEvents = append(newEvents, newEvent)
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

// Interface guards
var (
	_ core.StreamPublishEventHook = (*MyModule)(nil)
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
}

type StreamEvent interface {
    Data() []byte
    SetData(data []byte)
}

type StreamBatchEventHookContext interface {
    ProviderType() string
    ProviderID() string
    RequestContext() RequestContext
    SubscriptionConfiguration() SubscriptionEventConfiguration
}

type StreamPublishEventHookContext interface {
    ProviderType() string
    ProviderID() string
    RequestContext() RequestContext
}

type SubscriptionOnStartHookContext interface {
    ProviderType() string
    SubscriptionConfiguration() SubscriptionEventConfiguration
    WriteEvent(event core.StreamEvent)
}

type RequestContext interface {
    Authentication() *core.Authentication
}

type SubscriptionOnStartHookContext interface {
    RequestContext() RequestContext
    StreamContext() StreamContext
}

// ALREADY EXISTING INTERFACES THAT WILL BE UPDATED
type OperationContext interface {
    Name() string
    // the variables are currently not available, so we need to add them here
    Variables() *astjson.Value
}
```