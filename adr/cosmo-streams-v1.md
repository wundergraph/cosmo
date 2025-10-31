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

// each provider will have its own event type with custom fields
// the StreamEvent interface is used to allow the hooks system to be provider-agnostic
type StreamEvent interface {
    GetData() []byte
    Clone() MutableStreamEvent  // returns a mutable copy of the event
}

// MutableStreamEvent is a stream event that can be modified
type MutableStreamEvent interface {
    StreamEvent
    SetData([]byte)  // sets the data of the event
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
    // WriteEvent writes an event to the stream of the current subscription
    // It returns true if the event was written to the stream, false if the event was dropped
    WriteEvent(event datasource.StreamEvent) bool
    // NewEvent creates a new event that can be used in the subscription.
    NewEvent(data []byte) datasource.MutableStreamEvent
}

type SubscriptionOnStartHandler interface {
    // OnSubscriptionOnStart is called once at subscription start
    // Returning an error will result in a GraphQL error being returned to the client
    SubscriptionOnStart(ctx SubscriptionOnStartHandlerContext) error
}

type StreamReceiveEventHandlerContext interface {
    // Request is the initial client request that started the subscription
    Request() *http.Request
    // Logger is the logger for the request
    Logger() *zap.Logger
    // Operation is the GraphQL operation
    Operation() OperationContext
    // Authentication is the authentication for the request
    Authentication() authentication.Authentication
    // SubscriptionEventConfiguration is the subscription event configuration
    SubscriptionEventConfiguration() SubscriptionEventConfiguration
    // NewEvent creates a new event that can be used in the subscription.
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
    // PublishEventConfiguration is the publish event configuration
    PublishEventConfiguration() PublishEventConfiguration
    // NewEvent creates a new event that can be used in the subscription.
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
    "go.uber.org/zap"
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
            ctx.Logger().Error("error unmarshalling event data", zap.Error(err))
            continue
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
            ctx.Logger().Error("error marshalling event data", zap.Error(err))
            continue
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

## Filter events based on HTTP headers

This example demonstrates how to use HTTP headers from the client request to filter events in the `OnReceiveEvents` handler.

### Example: OnReceiveEvents with header-based filtering

```go
package mymodule

import (
    "encoding/json"
    "fmt"
    "github.com/wundergraph/cosmo/router/core"
    "github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

func init() {
    core.RegisterModule(&HeaderFilterModule{})
}

type HeaderFilterModule struct {}

func (m *HeaderFilterModule) OnReceiveEvents(ctx core.StreamReceiveEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
    // Get the tenant ID from the request header
    tenantID := ctx.Request().Header.Get("X-Tenant-ID")
    if tenantID == "" {
        // No tenant header provided, return empty events
        return datasource.NewStreamEvents([]datasource.StreamEvent{}), nil
    }

    newEvents := make([]datasource.StreamEvent, 0, events.Len())

    for _, evt := range events.All() {
        // Decode event to check tenant field
        var eventData struct {
            TenantID string `json:"tenantId"`
            Data     json.RawMessage `json:"data"`
        }
        
        err := json.Unmarshal(evt.GetData(), &eventData)
        if err != nil {
            // If we can't parse, skip this event
            continue
        }

        // Only include events that match the tenant ID from the header
        if eventData.TenantID == tenantID {
            newEvents = append(newEvents, evt)
        }
    }

    return datasource.NewStreamEvents(newEvents), nil
}

func (m *HeaderFilterModule) Module() core.ModuleInfo {
    return core.ModuleInfo{
        ID: "headerFilterModule",
        Priority: 1,
        New: func() core.Module {
            return &HeaderFilterModule{}
        },
    }
}

// Interface guards
var (
    _ core.StreamReceiveEventHandler = (*HeaderFilterModule)(nil)
)
```

## Add metadata to published events based on headers

This example shows how to use HTTP headers to add metadata to events before publishing them using the `OnPublishEvents` handler.

### Example: OnPublishEvents with header-based enrichment

```go
package mymodule

import (
    "encoding/json"
    "fmt"
    "time"
    "github.com/wundergraph/cosmo/router/core"
    "github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
    "go.uber.org/zap"
)

func init() {
    core.RegisterModule(&PublishEnrichmentModule{})
}

type PublishEnrichmentModule struct {}

func (m *PublishEnrichmentModule) OnPublishEvents(ctx core.StreamPublishEventHandlerContext, events datasource.StreamEvents) (datasource.StreamEvents, error) {
    // Extract metadata from request headers
    userID := ctx.Request().Header.Get("X-User-ID")
    clientVersion := ctx.Request().Header.Get("X-Client-Version")
    
    if userID == "" {
        // User ID is required for publishing
        return events, fmt.Errorf("X-User-ID header is required")
    }

    newEvents := make([]datasource.StreamEvent, 0, events.Len())

    for _, evt := range events.All() {
        // Parse the original event data
        var originalData map[string]interface{}
        err := json.Unmarshal(evt.GetData(), &originalData)
        if err != nil {
            ctx.Logger().Error("failed to parse event data", zap.Error(err))
            continue
        }

        // Add metadata from headers
        enrichedData := map[string]interface{}{
            "data": originalData,
            "metadata": map[string]interface{}{
                "publishedBy": userID,
                "clientVersion": clientVersion,
                "timestamp": time.Now().Unix(),
            },
        }

        // Marshal the enriched data
        enrichedBytes, err := json.Marshal(enrichedData)
        if err != nil {
            ctx.Logger().Error("failed to marshal enriched data", zap.Error(err))
            continue
        }

        // Create a new event with enriched data
        newEvent := ctx.NewEvent(enrichedBytes)
        newEvents = append(newEvents, newEvent)
    }

    return datasource.NewStreamEvents(newEvents), nil
}

func (m *PublishEnrichmentModule) Module() core.ModuleInfo {
    return core.ModuleInfo{
        ID: "publishEnrichmentModule",
        Priority: 1,
        New: func() core.Module {
            return &PublishEnrichmentModule{}
        },
    }
}

// Interface guards
var (
    _ core.StreamPublishEventHandler = (*PublishEnrichmentModule)(nil)
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
        return core.NewHttpGraphqlError(
            "client is not authenticated",
            http.StatusText(http.StatusUnauthorized),
            http.StatusUnauthorized,
        )
    }

    // check if the client is allowed to subscribe to the stream
    _, found := ctx.Authentication().Claims()["readEmployee"]
    if !found {
        return core.NewHttpGraphqlError(
            "client is not allowed to read employees",
            http.StatusText(http.StatusForbidden),
            http.StatusForbidden,
        )
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
