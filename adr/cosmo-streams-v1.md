---
title: "Cosmo Streams v1"
author: Alessandro Pagnin
date: 2025-07-16
status: Accepted
---

# ADR - Cosmo Streams V1

- **Author:** Alessandro Pagnin, Dominik Korittki
- **Date:** 2025-07-16
- **Status:** Accepted
- **RFC:** ../rfcs/cosmo-streams-v1.md

## Abstract
This ADR describes new hooks that will be added to the router to support more customizable stream behavior.
The goal is to allow developers to customize the cosmo streams behavior.

## Decision
The following interfaces will extend the existing logic in custom modules.
These provide additional control over subscriptions by providing hooks, which are invoked during specific events.

- `SubscriptionOnStartHandler`: Called once at subscription start.
- `StreamReceiveEventHandler`: Triggered for each client/subscription when a batch of events is received from the provider, prior to delivery.
- `StreamPublishEventHandler`: Called each time a batch of events is going to be sent to the provider.

```go
// STRUCTURES TO BE ADDED TO PUBSUB/DATASOURCE PACKAGE
type ProviderType string
const (
    ProviderTypeNats  ProviderType = "nats"
    ProviderTypeKafka ProviderType = "kafka"
    ProviderTypeRedis ProviderType = "redis"
}

// OperationContext provides information about the GraphQL operation
type OperationContext interface {
    Name() string
    Variables() *astjson.Value
}

// StreamEvents is a wrapper around a list of stream events providing safe iteration
type StreamEvents struct {
    evts []StreamEvent
}

func (e StreamEvents) All() iter.Seq2[int, StreamEvent]  // iterator for all events
func (e StreamEvents) Len() int                          // returns the number of events
func (e StreamEvents) Unsafe() []StreamEvent             // returns the underlying slice

func NewStreamEvents(evts []StreamEvent) StreamEvents

// StreamEvent is a generic immutable event.
// Every provider will have it's distinct implementation with additionals fields.
// Common to all providers is that their events have a payload.
type StreamEvent interface {
    // GetData returns a copy of payload data of the event
    GetData() []byte
    // Clone returns a mutable copy of the event
    Clone() MutableStreamEvent
}

// MutableStreamEvent is a StreamEvent that can be modified.
type MutableStreamEvent interface {
    StreamEvent
    // SetData sets the payload data for this event
    SetData([]byte)
}

// SubscriptionEventConfiguration is the common interface for the subscription event configuration
type SubscriptionEventConfiguration interface {
    ProviderID() string
    ProviderType() ProviderType
    // the root field name of the subscription in the schema
    RootFieldName() string
}

// PublishEventConfiguration is the common interface for the publish event configuration
type PublishEventConfiguration interface {
    ProviderID() string
    ProviderType() ProviderType
    // the root field name of the mutation in the schema
    RootFieldName() string
}

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
	// EmitLocalEvent sends an event directly to the subscription stream of the
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
	EmitLocalEvent(event datasource.StreamEvent) bool
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
	// You can use EmitLocalEvent to emit this event to subscriptions.
	NewEvent(data []byte) datasource.MutableStreamEvent
}

type SubscriptionOnStartHandler interface {
    // OnSubscriptionOnStart is called once at subscription start
    // Returning an error will result in a GraphQL error being returned to the client
    SubscriptionOnStart(ctx SubscriptionOnStartHandlerContext) error
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
    // The hook will be called once for each active subscription, therefore it is advised to
    // avoid resource heavy computation or blocking tasks whenever possible.
    // The events argument contains all events from a batch and is shared between
    // all active subscribers of these events.
    // Use events.All() to iterate through them and event.Clone() to create mutable copies, when needed.
    // Returning an error will result in the subscription being closed and the error being logged.
    OnReceiveEvents(ctx StreamReceiveEventHandlerContext, events StreamEvents) (StreamEvents, error)
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
    // Returning an error will result in a GraphQL error being returned to the client.
    OnPublishEvents(ctx StreamPublishEventHandlerContext, events StreamEvents) (StreamEvents, error)
}
```

## Immutable vs Mutable events

The design of `StreamEvent` and `MutableStreamEvent` interfaces addresses a critical performance and safety trade-off in the event handling system. When events are received from a provider, they are typically delivered to multiple active subscriptions simultaneously. The `OnReceiveEvents` handler is called once for each active subscription, meaning the same batch of events needs to be processed by multiple handlers concurrently.

The primary design challenge was avoiding unnecessary memory allocations and data copying while maintaining safety guarantees. If we automatically created a deep copy of all events before each handler invocation, the performance cost would be significant, especially under high load with many active subscriptions. However, if we simply passed mutable references to all handlers, we would risk handlers inadvertently modifying shared event data, causing unexpected behavior for other subscribers processing the same events.

The current solution leverages immutability as the default behavior with explicit opt-in mutability. The `StreamEvent` interface is designed to be immutable: the `GetData()` method returns a copy of the payload data, ensuring that read operations are safe by default. When a handler needs to modify an event, it must explicitly call the `Clone()` method to obtain a `MutableStreamEvent`. This creates a conscious decision point where developers understand they are creating a new copy that can be safely modified without affecting other subscriptions.

The `MutableStreamEvent` interface extends `StreamEvent` and adds the `SetData()` method, allowing modifications only on explicitly cloned copies. This design pattern ensures that:
1. Handlers that only read event data incur no copying overhead
2. Multiple subscriptions can safely share the same underlying event data
3. Modifications are isolated to the specific subscription that cloned the event
4. The API makes the performance implications of cloning explicit and intentional

## Example Use Cases

- **Authorization**: Implementing authorization checks at the start of subscriptions
- **Initial message**: Sending an initial message to clients upon subscription start
- **Data mapping**: Transforming events data from the format that could be used by the external system to/from Federation compatible Router events
- **Event filtering**: Filtering events using custom logic
- **Event creation**: Creating new events from scratch using `ctx.NewEvent(data)` method available in all handler contexts

## Backwards Compatibility

The new hooks can be integrated in the router in a fully backwards compatible way.

When the new module system will be released, the Cosmo Streams hooks:
- will be moved to the `core/hooks.go` file
- will be added to the `hookRegistry`
- will be initialized in the `coreModuleHooks.initCoreModuleHooks`


# Example Modules

__All examples reflect the current implementation and match the actual API__

## Filter and remap events

This example will show how to filter the events based on the client's scopes and remapping the messages as they are expected from the `Employee` type.

### 1. Add a subscription to the cosmo streams graphql schema

The developer will start by adding a subscription to the cosmo streams graphql schema.

```graphql
type Subscription {
    employeeUpdates: Employee! @edfs__natsSubscribe(subjects: ["employeeUpdates"], providerId: "my-nats")
}

type Employee @key(fields: "id", resolvable: false) {
  id: Int! @external
}
```
After publishing the schema, the developer will need to add the module to the cosmo router.

### 2. Write the custom module

The developer will need to write the custom module that will be used to subscribe to the `employeeUpdates` subject and filter the events based on the client's scopes and remapping the messages as they are expected from the `Employee` type.

```go
package mymodule

import (
    "encoding/json"
    "fmt"
    "slices"
    "github.com/wundergraph/cosmo/router/core"
    "github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

func init() {
    // Register your module here and it will be loaded at router start
    core.RegisterModule(&MyModule{})
}

type MyModule struct {}

func (m *MyModule) OnReceiveEvents(ctx core.StreamReceiveEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
    // check if the provider is nats
    if ctx.SubscriptionEventConfiguration().ProviderType() != datasource.ProviderTypeNats {
        return events, nil
    }

    // check if the provider id is the one expected by the module
    if ctx.SubscriptionEventConfiguration().ProviderID() != "my-nats" {
        return events, nil
    }

	// check if the subscription is the one expected by the module
	if ctx.SubscriptionEventConfiguration().RootFieldName() != "employeeUpdates" {
		return events, nil
	}

	newEvents := make([]datasource.StreamEvent, 0, events.Len())

    // check if the client is authenticated
    if ctx.Authentication() == nil {
        // if the client is not authenticated, return no events
        return datasource.NewStreamEvents(newEvents), nil
    }

    // check if the client is allowed to subscribe to the stream
    allowedEntitiesIdsRaw, found := ctx.Authentication().Claims()["allowedEntitiesIds"]
    if !found {
        return datasource.NewStreamEvents(newEvents), fmt.Errorf("client is not allowed to subscribe to the stream")
    }
    
    // type assert to string slice
    clientAllowedEntitiesIds, ok := allowedEntitiesIdsRaw.([]string)
    if !ok {
        return datasource.NewStreamEvents(newEvents), fmt.Errorf("allowedEntitiesIds claim is not a string slice")
    }

    for _, evt := range events.All() {
        // decode the event data coming from the provider
        var dataReceived struct {
            EmployeeId string `json:"EmployeeId"`
            OtherField string `json:"OtherField"`
        }
        err := json.Unmarshal(evt.GetData(), &dataReceived)
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

        // create a new event using the context's NewEvent method
        newEvent := ctx.NewEvent(dataToSendMarshalled)
        newEvents = append(newEvents, newEvent)
    }
    return datasource.NewStreamEvents(newEvents), nil
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
    _ core.StreamReceiveEventHandler = (*MyModule)(nil)
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

## Check authorization at subscription start

This example will show how to check the authorization at subscription start.

### 1. Add a subscription to the cosmo streams graphql schema

The developer will start by adding a subscription to the cosmo streams graphql schema.

```graphql
type Subscription {
    employeeUpdates: Employee! @edfs__natsSubscribe(subjects: ["employeeUpdates"], providerId: "my-nats")
}

type Employee @key(fields: "id", resolvable: false) {
  id: Int! @external
}
```
After publishing the schema, the developer will need to add the module to the cosmo streams engine.

### 2. Write the custom module

The developer will need to write the custom module that will be used to check the authorization at subscription start.

```go
package mymodule

import (
    "net/http"
    "github.com/wundergraph/cosmo/router/core"
    "github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

func init() {
    // Register your module here and it will be loaded at router start
    core.RegisterModule(&MyModule{})
}

type MyModule struct {}

func (m *MyModule) SubscriptionOnStart(ctx core.SubscriptionOnStartHandlerContext) error {
    // check if the provider is nats
    if ctx.SubscriptionEventConfiguration().ProviderType() != datasource.ProviderTypeNats {
        return nil
    }

    // check if the provider id is the one expected by the module
    if ctx.SubscriptionEventConfiguration().ProviderID() != "my-nats" {
        return nil
    }

	// check if the subscription is the one expected by the module
	if ctx.SubscriptionEventConfiguration().RootFieldName() != "employeeUpdates" {
		return nil
	}

    // check if the client is authenticated
    if ctx.Authentication() == nil {
        // if the client is not authenticated, return an error
        return &core.StreamHandlerError{
	    	Message: "client is not authenticated",
	    }
    }

    // check if the client is allowed to subscribe to the stream
    _, found := ctx.Authentication().Claims()["readEmployee"]
    if !found {
        return &core.StreamHandlerError{
	    	Message: "client is not allowed to read employees",
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

// Interface guards
var (
    _ core.SubscriptionOnStartHandler = (*MyModule)(nil)
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

# Outlook

## Using AsyncAPI for Event Data Structure

We could use AsyncAPI specifications to define the event data structure and generate the Go structs automatically. This would make the development of custom modules easier and more maintainable.
We could also generate the AsyncAPI specification from the schema and the events data, to make it easier for external systems to use the events published by cosmo streams engine.

## Generate hooks from AsyncAPI specifications

Building on the AsyncAPI integration, we could allow the user to define their streams using AsyncAPI and generate fully typesafe hooks with all events structures generated from the AsyncAPI specification.
