package core

import (
	"context"
	"crypto/tls"
	"fmt"
	"github.com/nats-io/nats.go/jetstream"
	"net/http"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"

	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sasl/plain"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
	pubsubNats "github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
	"go.uber.org/zap"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/introspection_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

type ExecutorConfigurationBuilder struct {
	introspection bool
	includeInfo   bool
	baseURL       string
	transport     http.RoundTripper
	logger        *zap.Logger

	transportOptions *TransportOptions
}

type Executor struct {
	PlanConfig      plan.Configuration
	Definition      *ast.Document
	Resolver        *resolve.Resolver
	RenameTypeNames []resolve.RenameTypeName
}

func (b *ExecutorConfigurationBuilder) Build(ctx context.Context, routerConfig *nodev1.RouterConfig, routerEngineConfig *RouterEngineConfiguration, reporter resolve.Reporter) (*Executor, error) {
	planConfig, err := b.buildPlannerConfiguration(ctx, routerConfig, routerEngineConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to build planner configuration: %w", err)
	}

	options := resolve.ResolverOptions{
		MaxConcurrency:               routerEngineConfig.Execution.MaxConcurrentResolvers,
		Debug:                        routerEngineConfig.Execution.Debug.EnableResolverDebugging,
		Reporter:                     reporter,
		PropagateSubgraphErrors:      routerEngineConfig.SubgraphErrorPropagation.Enabled,
		PropagateSubgraphStatusCodes: routerEngineConfig.SubgraphErrorPropagation.PropagateStatusCodes,
		RewriteSubgraphErrorPaths:    routerEngineConfig.SubgraphErrorPropagation.RewritePaths,
		OmitSubgraphErrorLocations:   routerEngineConfig.SubgraphErrorPropagation.OmitLocations,
		OmitSubgraphErrorExtensions:  routerEngineConfig.SubgraphErrorPropagation.OmitExtensions,
	}

	switch routerEngineConfig.SubgraphErrorPropagation.Mode {
	case config.SubgraphErrorPropagationModePassthrough:
		options.SubgraphErrorPropagationMode = resolve.SubgraphErrorPropagationModePassThrough
	case config.SubgraphErrorPropagationModeWrapped:
		options.SubgraphErrorPropagationMode = resolve.SubgraphErrorPropagationModeWrapped
	default:
		options.SubgraphErrorPropagationMode = resolve.SubgraphErrorPropagationModeWrapped
	}

	// this is the resolver, it's stateful and manages all the client connections, etc...
	resolver := resolve.New(ctx, options)

	// this is the GraphQL Schema that we will expose from our API
	var definition ast.Document
	var report operationreport.Report
	// The client schema may not be present in old configs
	if routerConfig.EngineConfig.GetGraphqlClientSchema() != "" {
		definition, report = astparser.ParseGraphqlDocumentString(routerConfig.EngineConfig.GetGraphqlClientSchema())
	} else {
		definition, report = astparser.ParseGraphqlDocumentString(routerConfig.EngineConfig.GraphqlSchema)
	}
	if report.HasErrors() {
		return nil, fmt.Errorf("failed to parse graphql schema from engine config: %w", report)
	}

	// we need to merge the base schema, it contains the __schema and __type queries
	// these are not usually part of a regular GraphQL schema
	// the engine needs to have them defined, otherwise it cannot resolve such fields
	err = asttransform.MergeDefinitionWithBaseSchema(&definition)
	if err != nil {
		return nil, fmt.Errorf("failed to merge graphql schema with base schema: %w", err)
	}

	if b.introspection {
		// by default, the engine doesn't understand how to resolve the __schema and __type queries
		// we need to add a special data source for that
		// it takes the definition as the input and generates resolvers from it
		introspectionFactory, err := introspection_datasource.NewIntrospectionConfigFactory(&definition)
		if err != nil {
			return nil, fmt.Errorf("failed to create introspection config factory: %w", err)
		}
		fieldConfigs := introspectionFactory.BuildFieldConfigurations()
		// we need to add these fields to the config
		// otherwise the engine wouldn't know how to resolve them
		planConfig.Fields = append(planConfig.Fields, fieldConfigs...)
		dataSources := introspectionFactory.BuildDataSourceConfigurations()
		// finally, we add our data source for introspection to the existing data sources
		planConfig.DataSources = append(planConfig.DataSources, dataSources...)
	}

	var renameTypeNames []resolve.RenameTypeName

	// when applying namespacing, it's possible that we need to rename types
	// for that, we have to map the rename types config to the engine's rename type names
	for _, configuration := range planConfig.Types {
		if configuration.RenameTo != "" {
			renameTypeNames = append(renameTypeNames, resolve.RenameTypeName{
				From: []byte(configuration.RenameTo),
				To:   []byte(configuration.TypeName),
			})
		}
	}

	return &Executor{
		PlanConfig:      *planConfig,
		Definition:      &definition,
		Resolver:        resolver,
		RenameTypeNames: renameTypeNames,
	}, nil
}

func buildNatsOptions(eventSource config.NatsEventSource) ([]nats.Option, error) {

	var opts []nats.Option

	if eventSource.Authentication != nil {
		if eventSource.Authentication.Token != nil {
			opts = append(opts, nats.Token(*eventSource.Authentication.Token))
		} else if eventSource.Authentication.Username != nil || eventSource.Authentication.Password != nil {
			opts = append(opts, nats.UserInfo(*eventSource.Authentication.Username, *eventSource.Authentication.Password))
		}
	}

	return opts, nil
}

func buildKafkaOptions(eventSource config.KafkaEventSource) ([]kgo.Opt, error) {

	opts := []kgo.Opt{
		kgo.SeedBrokers(eventSource.Brokers...),
		// We want to consume the events produced after the router starts
		// This replicates a stateless publish-subscribe model
		kgo.ConsumeResetOffset(kgo.NewOffset().AfterMilli(time.Now().UnixMilli())),
		// For observability, we set the client ID to the router
		kgo.ClientID("router"),
		// Ensure proper timeouts are set
		kgo.ProduceRequestTimeout(10 * time.Second),
		kgo.ConnIdleTimeout(60 * time.Second),
	}

	if eventSource.TLS != nil && eventSource.TLS.Enabled {
		opts = append(opts,
			// Configure TLS. Uses SystemCertPool for RootCAs by default.
			kgo.DialTLSConfig(new(tls.Config)),
		)
	}

	if eventSource.Authentication != nil && eventSource.Authentication.Username != nil && eventSource.Authentication.Password != nil {
		opts = append(opts, kgo.SASL(plain.Auth{
			User: *eventSource.Authentication.Username,
			Pass: *eventSource.Authentication.Password,
		}.AsMechanism()))
	}

	return opts, nil
}

func (b *ExecutorConfigurationBuilder) buildPlannerConfiguration(ctx context.Context, routerCfg *nodev1.RouterConfig, routerEngineCfg *RouterEngineConfiguration) (*plan.Configuration, error) {
	// this loader is used to take the engine config and create a plan config
	// the plan config is what the engine uses to turn a GraphQL Request into an execution plan
	// the plan config is stateful as it carries connection pools and other things

	natsPubSubByProviderID := make(map[string]pubsub_datasource.NatsPubSub)
	kafkaPubSubByProviderID := make(map[string]pubsub_datasource.KafkaPubSub)

	datasourceConfigurations := routerCfg.EngineConfig.GetDatasourceConfigurations()
	for _, datasourceConfiguration := range datasourceConfigurations {
		if datasourceConfiguration.CustomEvents == nil {
			continue
		}

		for _, eventConfiguration := range datasourceConfiguration.GetCustomEvents().GetNats() {

			providerID := eventConfiguration.EngineEventConfiguration.GetProviderId()
			// if this source name's provider has already been initiated, do not try to initiate again
			_, ok := natsPubSubByProviderID[providerID]
			if ok {
				continue
			}

			for _, eventSource := range routerEngineCfg.Events.Providers.Nats {
				if eventSource.ID == eventConfiguration.EngineEventConfiguration.GetProviderId() {
					options, err := buildNatsOptions(eventSource)
					if err != nil {
						return nil, fmt.Errorf("failed to build options for Nats provider with ID \"%s\": %w", providerID, err)
					}
					natsConnection, err := nats.Connect(eventSource.URL, options...)
					if err != nil {
						return nil, fmt.Errorf("failed to create connection for Nats provider with ID \"%s\": %w", providerID, err)
					}
					js, err := jetstream.New(natsConnection)
					if err != nil {
						return nil, err
					}

					natsPubSubByProviderID[providerID] = pubsubNats.NewConnector(b.logger, natsConnection, js).New(ctx)

					break
				}
			}
		}

		for _, eventConfiguration := range datasourceConfiguration.GetCustomEvents().GetKafka() {

			providerID := eventConfiguration.EngineEventConfiguration.GetProviderId()
			// if this source name's provider has already been initiated, do not try to initiate again
			_, ok := kafkaPubSubByProviderID[providerID]
			if ok {
				continue
			}

			for _, eventSource := range routerEngineCfg.Events.Providers.Kafka {

				if eventSource.ID == providerID {
					options, err := buildKafkaOptions(eventSource)
					if err != nil {
						return nil, fmt.Errorf("failed to build options for Kafka provider with ID \"%s\": %w", providerID, err)
					}
					client, err := kgo.NewClient(options...)
					if err != nil {
						return nil, fmt.Errorf("failed to create client for Kafka provider with ID \"%s\": %w", providerID, err)
					}

					kafkaPubSubByProviderID[providerID] = kafka.NewConnector(b.logger, client).New(ctx)

					break
				}
			}
		}

	}

	loader := NewLoader(b.includeInfo, NewDefaultFactoryResolver(
		ctx,
		NewTransport(b.transportOptions),
		b.transport,
		b.logger,
		routerEngineCfg.Execution.EnableSingleFlight,
		natsPubSubByProviderID,
		kafkaPubSubByProviderID,
	))

	// this generates the plan config using the data source factories from the config package
	planConfig, err := loader.Load(routerCfg, routerEngineCfg)
	if err != nil {
		return nil, fmt.Errorf("failed to load configuration: %w", err)
	}
	debug := &routerEngineCfg.Execution.Debug
	planConfig.Debug = plan.DebugConfiguration{
		PrintOperationTransformations: debug.PrintOperationTransformations,
		PrintOperationEnableASTRefs:   debug.PrintOperationEnableASTRefs,
		PrintPlanningPaths:            debug.PrintPlanningPaths,
		PrintQueryPlans:               debug.PrintQueryPlans,
		PrintNodeSuggestions:          debug.PrintNodeSuggestions,
		ConfigurationVisitor:          debug.ConfigurationVisitor,
		PlanningVisitor:               debug.PlanningVisitor,
		DatasourceVisitor:             debug.DatasourceVisitor,
	}
	planConfig.IncludeInfo = true
	return planConfig, nil
}
