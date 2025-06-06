
# Adding a PubSub Provider

This guide outlines the steps required to integrate a new PubSub provider into the router.

## Modify the Router Proto

Update the [`router.proto`](../../../proto/wg/cosmo/node/v1/node.proto) file by adding your provider’s configuration. Follow these steps:

- Define a new configuration message similar to `KafkaEventConfiguration`.
- Add this configuration as a repeated field within the `DataSourceCustomEvents` message.
- Field naming should reflect the provider's message grouping mechanism. For example, use `channels` if the provider groups messages by channel, or `topics` if it uses topics.

After making these changes, compile the updated proto definitions by running the following command from the root directory:

```bash
make generate-go
```

This will generate the new proto files in the `gen` folder.


## Implement the PubSub Provider

To implement a new PubSub provider, the following components must be created:
- `SubscriptionEventConfiguration` and `PublishEventConfiguration`: Define the data structures used for communication between the adapter and the engine.
- `ProviderAdapter`: Implements the logic that interfaces with the provider’s client or SDK.
- `SubscriptionDataSource` and `PublishDataSource`: Engine components that leverage the configurations to subscribe and publish data.
- `EngineDataSourceFactory`: Bridges the engine and the provider.
- `ProviderBuilder`: Used by the router to instantiate the provider.

### `SubscriptionEventConfiguration` and `PublishEventConfiguration`

These structures should be placed at the top of the `engine_datasource.go` file. Their design is specific to each provider.

Refer to the [kafka implementation](./kafka/engine_datasource.go) for a working example.

### `ProviderAdapter`

This component encapsulates the provider-specific logic. Although not required, it’s best practice to implement the following interface to facilitate testing via mocks:

```go
type Adapter interface {
	Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error
	Publish(ctx context.Context, event PublishEventConfiguration) error
	Startup(ctx context.Context) error
	Shutdown(ctx context.Context) error
}
```

Refer to the [kafka implementation](./kafka/adapter.go) for a working example.

### `SubscriptionDataSource` and `PublishDataSource`

These are the core engine interfaces:

The engine expect two kind of structures:
- `SubscriptionDataSource`: Implements `resolve.SubscriptionDataSource`
- `PublishDataSource`: Implements `resolve.DataSource`

The implementation of `SubscriptionDataSource` and `PublishDataSource` should be in the `engine_datasource.go` file.

They are going to use the `SubscriptionEventConfiguration` and `PublishEventConfiguration` that you have implemented in the first step.

Implement these in the `engine_datasource.go` file, referencing the [kafka implementation](./kafka/engine_datasource.go) for a working example.

### `EngineDataSourceFactory`

This structure connects the engine (resolve.DataSource and resolve.SubscriptionDataSource) with the provider implementation. It must implement the `EngineDataSourceFactory` interface defined in [datasource.go](./datasource/datasource.go).

Refer to the [kafka implementation](./kafka/pubsub_datasource.go) for a working example.

### `ProviderBuilder`

The builder is responsible for instantiating the provider within the router. It must implement the [ProviderBuilder](./datasource/provider.go) interface.

The interface has two generic types:
- `P`, the generic type of the options that the provider builder will need, as defined in the [config.go](../config/config.go) (NatsEventSource, KafkaEventSource, ...)
- `E`, the generic type of the event configuration that the provider builder will receive, as defined in the [proto/wg/cosmo/node/v1/node.proto](../../../proto/wg/cosmo/node/v1/node.proto) (KafkaEventConfiguration, NatsEventConfiguration, ...)

Key methods:
- `BuildProvider`: Initializes the provider with its configuration and receive the provider options (defined by the `P` type)
- `BuildEngineDataSourceFactory`: Creates the data source and receive the event configuration (defined by the `E` type)

Refer to the [kafka implementation](./kafka/provider_builder.go) for a working example.

### Add tests

You should also add tests to your provider.

### Generate mocks
As a first step, you can use the [mockery](https://github.com/vektra/mockery) tool to generate the mocks for the ProviderAdapter interface you have implemented. To do this, add the following to the `.mockery.yml` file:

```yaml
packages:
  github.com/wundergraph/cosmo/router/pkg/pubsub/{your-provider-name}:
    interfaces:
      Adapter:
```

Then run the following command from the router directory:

```bash
make generate-mocks
```

This will generate the mocks in the `{your-provider-name}/mocks.go` file.

You can then use the mocks in your tests.

### Tests

You should add tests as specified in the table below.

| Implementation File | Test File | Reference File |
|-------------------|-----------|-----------------|
| engine_datasource.go | engine_datasource_test.go | [kafka implementation](./kafka/engine_datasource_test.go) |
| engine_datasource_factory.go | engine_datasource_factory_test.go | [kafka implementation](./kafka/engine_datasource_factory_test.go) |
| provider_builder.go | provider_builder_test.go | [kafka implementation](./kafka/provider_builder_test.go) |
| pubsub.go | pubsub_test.go | TestBuildProvidersAndDataSources_Kafka_OK |

## Add the provider to the router

Update the `BuildProvidersAndDataSources` function in the [pubsub.go](./pubsub.go) file to include your new provider.

## How to use the new PubSub Provider

After you have implemented all the above, you can use your PubSub Provider by adding the following to your router config:

```yaml
pubsub:
  providers:
    - name: provider-name
      type: new-provider
```

But to use it in the GraphQL schema, you will have to work in the [composition](../../../composition) package.