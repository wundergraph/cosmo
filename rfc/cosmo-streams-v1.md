# RFC Cosmo Streams V1
All should use the custom modules

## Authorization

### Prerequisites
* In the authorization hook, we need to make the decision if the client/user is authorized at all to subscribe
* second, we have to decide which topics the user is allowed to subscribe to.

### Additional prerequisites
We can use a similar hook also for non-stream subscriptions, to satisfy the following requirements:
* Should also allow for customers to add additional logic on JWT, like verify expiration, sign/secrets
* Should allow to return a Unauthenticated/Unauthorized message and close the subscriptions
(requested by united talent)

## Init Func
### Prerequisites
* From the client request, derive an initial payload to resolve the first event. Can be optional. Can be implemented but might not return an initial payload.

## Map from broker to entity
### Prerequisites
* Some customers, like Procore, have existing Kafka infra that doesn't align with their GraphQL Schema. They might use headers or other Kafka specific features. This function will take events from any broker and allow us to map them to valid entity objects.

## Filter entity events
### Prerequisites
* Based on client request, client args, authentication, etc. the function can filter the stream for each subscriber.

# Proposal

## Core Types

core.OperationContext
- add `Variables() *astjson.Value`

core.SubscriptionContext
- `RequestContext() core.RequestContext`
- `SendError(err error)`
- `Close()`

core.StreamNatsConfiguration
- `Subjects() []string`

core.StreamKafkaConfiguration
- `Topics() []string`

core.StreamRedisConfiguration
- `Channels() []string`

core.StreamType
- `Nats`
- `Kafka`
- `Redis`

core.StreamProvider
- `Id() string`
- `Type() core.StreamType`

core.StreamConfiguration
- `Provider() core.StreamProvider`
- `Type() core.StreamType`
- `Nats() *core.StreamNatsConfiguration`
- `Kafka() *core.StreamKafkaConfiguration`
- `Redis() *core.StreamRedisConfiguration`

core.StreamNatsEvent
- `Subject() string`
- `Data() []byte`

core.StreamKafkaEvent
- `Topic() string`
- `Data() []byte`
- `Headers() map[string]string`
- `SetHeader(key string, value string)`, add a header to the event

core.StreamRedisEvent
- `Channel() string`
- `Data() []byte`

core.StreamEvent
- `Type() core.StreamType`
- `Redis() *core.StreamRedisEvent`
- `Kafka() *core.StreamKafkaEvent`
- `Nats() *core.StreamNatsEvent`
- `Metadata() map[string]string`, metadata that can be used to store additional information about the event and passed between hooks
- `SetMetadata(key string, value string)`, set a metadata entry
- `ToSkip() bool`, if true, the event will not be sent to the client
- `SetToSkip(toSkip bool)`, set the toSkip flag
- `Data() []byte`, get the data of the event
- `SetData(data []byte)`, set the data of the event
- `Error() error`, get the error of the event
- `SetError(err error)`, set the error of the event

core.StreamEventWithError
- `Event() core.StreamEvent`
- `Error() error`, get the error of the event
- `SetError(err error)`, set the error of the event

core.StreamContext
- `Configuration() *core.StreamConfiguration`
- `Metadata() map[string]string`, metadata that can be used to store additional information about the stream and passed between hooks
- `SetMetadata(key string, value string)`
- `WriteEvent(event core.StreamEvent)`, write an event to the stream
- `Close()`, close the stream

## Hooks

core.RouterOnSubscriptionStartHandler
- `RouterOnSubscriptionStart(ctx core.SubscriptionContext)`, called once at subscription start
  - can send an error to the client with `ctx.SendError(fmt.Errorf("my custom error: %w", err))`
  - can close the subscription with `ctx.Close()`

core.RouterOnStreamStartHandler
- `RouterOnStreamStart(subCtx core.SubscriptionContext, streamCtx core.StreamContext)`, called once at cosmo stream start, right after the subscription start hook
  - can send an error to the client with `subCtx.SendError(fmt.Errorf("my custom error: %w", err))`
  - can close the subscription with `subCtx.Close()`

core.RouterOnStreamEventReceivedHandler
- `RouterOnStreamEventReceived(streamCtx core.StreamContext, event *core.StreamEventWithError)`, called once for each event as has been received from the adapter before it is delivered to the clients
  - can set an error that will be delivered to the clients with `event.SetError(fmt.Errorf("my custom error: %w", err))`
  - can set the toSkip flag to skip delivering the event to the clients
  - can change the event data before delivering it to the clients

core.RouterOnStreamEventToClientHandler
- `RouterOnStreamEventToClient(subCtx core.SubscriptionContext, streamCtx core.StreamContext, event *core.StreamEventWithError)`, applied before the message is delivereted to the client, executed one time for each unique combination of event and client
  - can set an error that will be delivered to the client
  - can set the toSkip flag to skip delivering the event to the client
  - can change the event data even using client informations, before delivering it to the client
  - if this hook is implemented, the event is copied before delivering it to the client, to avoid side effects between clients; this behaviour will make this hook less performant than `RouterOnStreamEventReceivedHandler`, that should be preferred if possible

core.RouterOnStreamEventToSendHandler
- `RouterOnStreamEventToSend(streamCtx core.StreamContext, event *core.StreamEvent)`, called once for each event that is going to be sent to the adapter
  - can set the toSkip flag to skip delivering the event to the adapter
  - can change the event data before sending it to the adapter

core.RouterOnStreamEventToSendWithClientHandler
- `RouterOnStreamEventToSendWithClient(subCtx core.SubscriptionContext, streamCtx core.StreamContext, event *core.StreamEvent)`, called once for each event that is going to be sent to the adapter
  - can set the toSkip flag to skip delivering the event to the adapter
  - can change the event data before sending it to the adapter
  - can change the event data even using client informations, before delivering it to the adapter
  - if this hook is implemented, the event is copied before delivering it to the hook, to avoid side effects between clients; this behaviour will make this hook less performant than `RouterOnStreamEventToSendHandler`, that should be preferred if possible


## Examples

### Check if the client is allowed to subscribe to the stream

```go
type MyModule struct {
	Logger *zap.Logger
}

func (m *MyModule) Provision(ctx *core.ModuleContext) error {
	m.Logger = ctx.Logger
	return nil
}

func customCheckIfClientIsAllowedToSubscribeToStream(subCtx core.SubscriptionContext, streamCtx core.StreamContext) bool {
    providerId := streamCtx.Configuration().Provider().Id()
    clientScopes := subCtx.RequestContext().Authentication().Scopes()
    
    if slices.Contains(clientScopes, "admin") {
        return true
    }
    
    if providerId == "sharable-data" && streamCtx.Configuration().Provider().Type() == core.StreamTypeNats {
        return true
    }
    
    if providerId == "almost-sharable-data"
     && streamCtx.Configuration().Provider().Type() == core.StreamTypeNats 
     && streamCtx.Configuration().Provider().Nats().Subjects() == []string{"public"} {
        return true
    }

    return false
}

func (m *MyModule) RouterOnStreamStart(subCtx core.SubscriptionContext, streamCtx core.StreamContext) {
	if !customCheckIfClientIsAllowedToSubscribeToStream(subCtx, streamCtx) {
		subCtx.SendError(fmt.Errorf("you should be an admin to subscribe to this or only subscribe to public subscriptions!"))
		subCtx.Close()
	}
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

### Derive the initial payload

```go
type MyModule struct {
	Logger *zap.Logger
}

func (m *MyModule) Provision(ctx *core.ModuleContext) error {
	m.Logger = ctx.Logger
	return nil
}

func (m *MyModule) RouterOnStreamStart(subCtx core.SubscriptionContext, streamCtx core.StreamContext) {
    opName := subCtx.RequestContext().Operation().Name()
    opVarId := subCtx.RequestContext().Operation().Variables().GetInt("id")
    if opName == "employeeSub" && opVarId == 100 {
        streamCtx.WriteEvent(core.StreamEvent{
            Data: []byte(fmt.Sprintf("{\"id\": \"%d\", \"__typename\": \"Employee\"}", opVarId)),
        })
    }
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


### Rewrite the event from a stream for all the subscription's clients

```go
type MyModule struct {
	Logger *zap.Logger
}

func (m *MyModule) Provision(ctx *core.ModuleContext) error {
	m.Logger = ctx.Logger
	return nil
}

func (m *MyModule) RouterOnStreamEventReceived(streamCtx core.StreamContext, event *core.StreamEventWithError) {
    if streamCtx.Configuration().Type() != core.StreamTypeKafka {
        return
    }
    if event.Kafka().Topic() == "topic-with-internal-data-format" {
        idHeader := event.Kafka().Headers()["id"]
        if idHeader == "" {
            event.SetToSkip(true)
            m.Logger.Warn("id is empty, skipping")
            return
        }
        event.SetData([]byte(fmt.Sprintf("{\"id\": \"%s\", \"__typename\": \"Employee\"}", idHeader)))
    }
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



### Rewrite the mutation event for a mutation to copy the id in a header

```go
type MyModule struct {
	Logger *zap.Logger
}

func (m *MyModule) Provision(ctx *core.ModuleContext) error {
	m.Logger = ctx.Logger
	return nil
}

func (m *MyModule) RouterOnStreamEventToSend(streamCtx core.StreamContext, event *core.StreamEvent) {
    if streamCtx.Configuration().Type() != core.StreamTypeKafka {
        return
    }
    if event.Kafka().Topic() == "topic-with-internal-data-format" {
        var data struct {
            Id string `json:"id"`
        }
        json.Unmarshal(event.Data(), &data)
        event.SetHeader("entity-id", data.Id)
    }
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


### Filter events based on the client's scopes and the stream's configuration

```go
type MyModule struct {
	Logger *zap.Logger
}

func (m *MyModule) Provision(ctx *core.ModuleContext) error {
	m.Logger = ctx.Logger
	return nil
}

func (m *MyModule) RouterOnStreamEventToClient(subCtx core.SubscriptionContext, streamCtx core.StreamContext, event *core.StreamEventWithError) {
    clientAllowedEntitiesIds, found := subCtx.RequestContext().Authentication().Claims()["allowedEntitiesIds"]
    if !found {
        m.Logger.Debug("allowedEntitiesIds not found, skipping")
        return
    }
    if streamCtx.Configuration().Type() != core.StreamTypeKafka {
        return
    }
    if event.Kafka().Topic() == "topic-with-internal-data-format" {
        idHeader := event.Kafka().Headers()["id"]
        if idHeader == "" {
            event.SetToSkip(true)
            m.Logger.Warn("id is empty, skipping")
            return
        }
        if !slices.Contains(clientAllowedEntitiesIds, idHeader) {
            event.SetToSkip(true)
            m.Logger.Warn("id is not allowed, skipping")
            return
        }
    }
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


# Implementation details

The implementation of this solution will only require changes in the cosmo repo, without any changes to the engine.
This implementation will require additional changes to the hooks structures each time a new provider is added.

# Here be dragons

- all the hooks could be called in parallel, so we need to be careful with that
- all the hooks implementations could raise a panic, so we need to be careful with that also
- especially the `RouterOnStreamEventToClient` hook, that could be called for each client, could slow down the delivery of the event to the client and use a lot of memory
- probably we should also add metrics to track how much time is spent in each hook, to help customers pinpoint slow hooks