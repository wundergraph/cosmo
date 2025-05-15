
# How to add a PubSub Provider

## Add the data to the router proto

You need to change the [router proto](../../../proto/wg/cosmo/node/v1/node.proto) as follows.

Add the provider configuration like the `KafkaEventConfiguration` and then add it as repeated inside the `DataSourceCustomEvents`.

The fields of `KafkaEventConfiguration` will depends on the provider. If the providers use as grouping mechanisms of the messages "channel," it will be called "channels," if it is "Topic," it will be "topics," and so on.

After this you will have to compile the proto launching from the main folder the command `make generate-go`.


## Build the PubSub Provider

To build a PubSub provider, you need to implement five things:
- `Adapter`
- `PubSubDataSource`
- `PubSubProvider`
- `PubSubProviderBuilder`
- `PubSubProviderBuilderFactory`

### Adapter

The Adapter contains the logic actually calling the provider. Usually it implements an interface as follows:

```go
type AdapterInterface interface {
	Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error
	Publish(ctx context.Context, event PublishEventConfiguration) error
	Startup(ctx context.Context) error
	Shutdown(ctx context.Context) error
}
```

The content of `SubscriptionEventConfiguration` and `PublishEventConfiguration` depends on the provider, you can see an example of them in the [kafka implementation](./kafka/pubsub_datasource.go).


### PubSubDataSource

The `[PubSubDataSource](./datasource/datasource.go)` is the junction between the engine `resolve.DataSource` and the Provider that we are implementing.

You can see an example in [kafka `PubSubDataSource`](./kafka/pubsub_datasource.go).

To complete the `PubSubDataSource` implementation you should also add the engine data source.

Then you have to implement a `SubscriptionDataSource`, a structure that must implement all the methods needed by the interface `resolve.SubscriptionDataSource`, like the [kafka implementation](./kafka/engine_datasource.go).

And also, you have to implement a `DataSource`, a structure that must implement all the methods needed by the interface `resolve.DataSource`, like `PublishDataSource` in the [kafka implementation](./kafka/pubsub_datasource.go).


### PubSubProvider

The PubSubProvider expose the `Startup` and `Shutdown` methods of the adapter to the router.

You can see as an example of the `PubSubProvider` in the [kafka implementation](./kafka/provider.go).

### PubSubProviderBuilder

The `PubSubProviderBuilder` is the structure that the router uses to create the provider.
It must implement all the methods specified in [datasource.PubSubProviderBuilder interface](./datasource/provider.go).

You can see as an example of the `PubSubProviderBuilder` in the [kafka implementation](./kafka/provider_builder.go).


### PubSubProviderBuilderFactory

The `PubSubProviderBuilderFactory` is the initial contact point where you receive:
- `ctx context.Context`, usually passed down to the adapter
- [`config.EventsConfiguration`](../config/config.go) that contains the config needed to set up the provider connection
- `*zap.Logger`
- `hostName string`, useful if you need to identify the connection based on the local host name
- `routerListenAddr string`, useful if you need to identify the connection based on different router instances in the same host

You can see as an example of the `PubSubProviderBuilderFactory` function in the [kafka implementation](./kafka/provider_builder.go).

# How to use the new PubSub Provider

After you have implemented all the above, you can use your PubSub Provider by adding the following to your router config:

```yaml
pubsub:
  providers:
    - name: provider-name
      type: new-provider
```

But to use it in the schema, you will have to work in the [composition](../../../composition) folder.