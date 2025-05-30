
# How to add a PubSub Provider

## Add the data to the router proto

You need to change the [router proto](../../../proto/wg/cosmo/node/v1/node.proto) as follows.

Add the provider configuration like the `KafkaEventConfiguration` and then add it as repeated inside the `DataSourceCustomEvents`.

The fields of `KafkaEventConfiguration` will depends on the provider. If the providers uses as grouping mechanisms of the messages "channel" it will be called "channels", if it is "Topic" it will be "topics", and so on.

After this you will have to compile the proto launching from the main folder the command `make generate-go`.


## Build the PubSub Provider

To build a PubSub provider you need to implement 4 things:
- `Adapter`
- `ProviderFactory`
- `PubSubProvider`
- `PubSubDataSource`

And then add it inside the `GetProviderFactories` function.

### Adapter

The Adapter contains the logic that is actually calling the provider, usually it implement an interface as follows:

```go
type AdapterInterface interface {
	Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error
	Publish(ctx context.Context, event PublishEventConfiguration) error
	Startup(ctx context.Context) error
	Shutdown(ctx context.Context) error
}
```

The content of `SubscriptionEventConfiguration` and `PublishEventConfiguration` depends on the provider, you can see an example of them in the [kafka implementation](./kafka/pubsub_datasource.go).


### ProviderFactory

The `ProviderFactory` is the initial contact point where you receive:
- `ctx context.Context`, usually passed down to the adapter
- [`*nodev1.DataSourceConfiguration`](../../gen/proto/wg/cosmo/node/v1/node.pb.go#DataSourceConfiguration), that contains everything you need about the provider data parsed from the schema.
- `*plan.DataSourceMetadata`, usually not needed
- [`config.EventsConfiguration`](../config/config.go#EventsConfiguration) that contains the config needed to setup the provider connection
- `*zap.Logger`
- `hostName string`, useful if you need to identify the connection based on the local host name
- `routerListenAddr string`, useful if you need to identify the connection based on different router instances in the same host

The responsability of the factory is to initialize the PubSubProvider, like in this implementation for an `ExampleProvider`:

You can see as an example of the `GetProvider` function in the [kafka implementation](./kafka/provider.go).

### PubSubProvider

So, the `PubSubProvider` has already the Adapter of the provider initialized, and it will be called on a `Visitor.EnterField` call from the engine to check if the `PubSubProvider` is matching any `EngineEventConfiguration`.

The responsability of the `PubSubProvider` is to match the `EngineEventConfiguration` and initialize a `PubSubDataSource` with the matching event and the provider `Adapter`.

You can see as an example of the `PubSubProvider` in the [kafka implementation](./kafka/provider.go).

### PubSubDataSource

The `[PubSubDataSource](./datasource/datasource.go)` is the junction between the engine `resolve.DataSource` and the Provider that we are implementing.

You can see an example in [kafka `PubSubDataSource`](./kafka/pubsub_datasource.go).

To complete the `PubSubDataSource` implementation you should also add the engine data source.

So you have to implement the SubscriptionDataSource, a structure that implements all the methods needed by the interface `resolve.SubscriptionDataSource`, like the [kafka implementation](./kafka/engine_datasource.go).

And also, you have to implement the DataSource, a structure that implements all the methods needed by the interface `resolve.DataSource`, like `PublishDataSource` in the [kafka implementation](./kafka/pubsub_datasource.go).

# How to use the new PubSub Provider

After you have implemented all the above, you can use your PubSub Provider by adding the following to your router config:

```yaml
pubsub:
  providers:
    - name: provider-name
      type: new-provider
```

But to use it in the schema you will have to work in the [composition](../../../composition) folder.