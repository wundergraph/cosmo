---
title: "Cosmo Streams v1"
author: Alessandro Pagnin
date: 2025-07-16
status: Accepted
---

# ADR - Cosmo Streams V1

- **Author:** Alessandro Pagnin
- **Date:** 2025-07-16
- **Status:** Accepted
- **RFC:** ../rfcs/cosmo-streams-v1.md

## Abstract
This ADR describes new hooks that will be added to the router to support more customizable stream behavior.
The goal is to allow developers to customize the cosmo streams behavior.

## Decision
The following interfaces will extend the existing logic in the custom modules.
These provide additional control over subscriptions by providing hooks, which are invoked during specific events.

- `SubscriptionOnStartHandler`: Called once at subscription start.
- `StreamBatchEventHook`: Called each time a batch of events is received from the provider.
- `StreamPublishEventHook`: Called each time a batch of events is going to be sent to the provider.

```go
// STRUCTURES TO BE ADDED TO PUBSUB PACKAGE
type ProviderType string
const (
    ProviderTypeNats ProviderType = "nats"
    ProviderTypeKafka ProviderType = "kafka"
    ProviderTypeRedis ProviderType = "redis"
}

// StreamHookError is used to customize the error messages and the behavior
type StreamHookError struct {
    HttpError core.HttpError
    CloseSubscription bool
}

// OperationContext already exists, we just have to add the Variables() method
type OperationContext interface {
    Name() string
    // the variables are currently not available, so we need to expose them here
    Variables() *astjson.Value
}

// each provider will have its own event type with custom fields
// the StreamEvent interface is used to allow the hooks system to be provider-agnostic
// there could be common fields in future, but for now we don't need them
type StreamEvent interface {}

// SubscriptionEventConfiguration is the common interface for the subscription event configuration
type SubscriptionEventConfiguration interface {
    ProviderID() string
    ProviderType() string
    // the root field name of the subscription in the schema
    RootFieldName() string
}

// PublishEventConfiguration is the common interface for the publish event configuration
type PublishEventConfiguration interface {
    ProviderID() string
    ProviderType() string
    // the root field name of the mutation in the schema
    RootFieldName() string
}

type SubscriptionOnStartHookContext interface {
    // the request context
    RequestContext() RequestContext
    // the stream context
    StreamContext() StreamContext
    // the subscription event configuration
    SubscriptionEventConfiguration() SubscriptionEventConfiguration
    // write an event to the stream of the current subscription
    WriteEvent(event core.StreamEvent)
}

type SubscriptionOnStartHandler interface {
    // OnSubscriptionOnStart is called once at subscription start
    // Returning an error will result in a GraphQL error being returned to the client, could be customized returning a StreamHookError.
    SubscriptionOnStart(ctx SubscriptionOnStartHookContext) error
}

type StreamBatchEventHookContext interface {
    // the request context
    RequestContext() RequestContext
    // the subscription event configuration
    SubscriptionEventConfiguration() SubscriptionEventConfiguration
}

type StreamBatchEventHook interface {
    // OnStreamEvents is called each time a batch of events is received from the provider
    // Returning an error will result in a GraphQL error being returned to the client, could be customized returning a StreamHookError.
    OnStreamEvents(ctx StreamBatchEventHookContext, events []StreamEvent) ([]StreamEvent, error)
}

type StreamPublishEventHookContext interface {
    // the request context
    RequestContext() RequestContext
    // the publish event configuration
    PublishEventConfiguration() PublishEventConfiguration
}

type StreamPublishEventHook interface {
    // OnPublishEvents is called each time a batch of events is going to be sent to the provider
    // Returning an error will result in a GraphQL error being returned to the client, could be customized returning a StreamHookError.
    OnPublishEvents(ctx StreamPublishEventHookContext, events []StreamEvent) ([]StreamEvent, error)
}
```

## Example Use Cases

- **Authorization**: Implementing authorization checks at the start of subscriptions
- **Initial message**: Sending an initial message to clients upon subscription start
- **Data mapping**: Transforming events data from the format that could be used by the external system to/from Federation compatible Router events
- **Event filtering**: Filtering events using custom logic

## Backwards Compatibility

The new hooks can be integrated in the router in a fully backwards compatible way.
When the new module system will be released, some changes will be needed.

# Example Modules

__All examples are pseudocode and not tested, but they are as close as possible to the final implementation__

## Filter and remap events

This example will show how to filter the events based on the client's scopes and remapping the messages as they are expected from the `Employee` type.

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
    if ctx.StreamContext().ProviderType() != pubsub.ProviderTypeNats {
        return events, nil
    }

    // check if the provider id is the one expected by the module
    if ctx.StreamContext().ProviderID() != "my-nats" {
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

## Check authorization at subscription start

This example will show how to check the authorization at subscription start.

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

The developer will need to write the custom module that will be used to check the authorization at subscription start.

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

func (m *MyModule) SubscriptionOnStart(ctx SubscriptionOnStartHookContext) error {
    // check if the provider is nats
    if ctx.StreamContext().ProviderType() != pubsub.ProviderTypeNats {
        return nil
    }

    // check if the provider id is the one expected by the module
    if ctx.StreamContext().ProviderID() != "my-nats" {
        return nil
    }

    // check if the subject is the one expected by the module
    natsConfig := ctx.SubscriptionEventConfiguration().(*nats.SubscriptionEventConfiguration)
    if natsConfig.Subjects[0] != "employeeUpdates" {
        return nil
    }

    // check if the client is authenticated
    if ctx.RequestContext().Authentication() == nil {
        // if the client is not authenticated, return an error
        return &StreamHookError{
            HttpError: core.HttpError{
                Code: http.StatusUnauthorized,
                Message: "client is not authenticated",
            },
            CloseSubscription: true,
        }
    }

    // check if the client is allowed to subscribe to the stream
    clientAllowedEntitiesIds, found := ctx.RequestContext().Authentication().Claims()["readEmployee"]
    if !found {
        return &StreamHookError{
            HttpError: core.HttpError{
                Code: http.StatusForbidden,
                Message: "client is not allowed to read employees",
            },
            CloseSubscription: true,
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