package core

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sasl/plain"
	"go.uber.org/zap"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/introspection_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
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
	PlanConfig plan.Configuration
	// ClientSchema is the GraphQL Schema that is exposed from our API
	// it is used for the introspection and query normalization/validation.
	ClientSchema *ast.Document
	// RouterSchema the GraphQL Schema that we use for planning the queries
	RouterSchema    *ast.Document
	Resolver        *resolve.Resolver
	RenameTypeNames []resolve.RenameTypeName
}

func (b *ExecutorConfigurationBuilder) Build(ctx context.Context, routerConfig *nodev1.RouterConfig, routerEngineConfig *RouterEngineConfiguration, pubSubProviders *EnginePubSubProviders, reporter resolve.Reporter) (*Executor, error) {
	planConfig, err := b.buildPlannerConfiguration(ctx, routerConfig, routerEngineConfig, pubSubProviders)
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

	var (
		// clientSchemaDefinition is the GraphQL Schema that is exposed from our API
		// it should be used for the introspection and query normalization/validation.
		clientSchemaDefinition *ast.Document
		// routerSchemaDefinition the GraphQL Schema that we use for planning the queries
		routerSchemaDefinition ast.Document
		report                 operationreport.Report
	)

	routerSchemaDefinition, report = astparser.ParseGraphqlDocumentString(routerConfig.EngineConfig.GraphqlSchema)
	if report.HasErrors() {
		return nil, fmt.Errorf("failed to parse graphql schema from engine config: %w", report)
	}
	// we need to merge the base schema, it contains the __schema and __type queries,
	// as well as built-in scalars like Int, String, etc...
	// these are usually not part of a regular GraphQL schema
	// the engine needs to have them defined, otherwise it cannot resolve such fields
	err = asttransform.MergeDefinitionWithBaseSchema(&routerSchemaDefinition)
	if err != nil {
		return nil, fmt.Errorf("failed to merge graphql schema with base schema: %w", err)
	}

	if clientSchemaStr := routerConfig.EngineConfig.GetGraphqlClientSchema(); clientSchemaStr != "" {
		// The client schema is a subset of the router schema that does not include @inaccessible fields.
		// The client schema only exists if the federated schema includes @inaccessible directives or @tag directives

		clientSchema, report := astparser.ParseGraphqlDocumentString(clientSchemaStr)
		if report.HasErrors() {
			return nil, fmt.Errorf("failed to parse graphql client schema from engine config: %w", report)
		}
		err = asttransform.MergeDefinitionWithBaseSchema(&clientSchema)
		if err != nil {
			return nil, fmt.Errorf("failed to merge graphql client schema with base schema: %w", err)
		}
		clientSchemaDefinition = &clientSchema
	} else {
		// In the event that a client schema is not generated, the router schema is used in place of the client schema (e.g., for operation validation)

		clientSchemaDefinition = &routerSchemaDefinition
	}

	if b.introspection {
		// by default, the engine doesn't understand how to resolve the __schema and __type queries
		// we need to add a special datasource for that
		// it takes the definition as the input and generates introspection data
		// datasource is attached to Query.__schema, Query.__type, __Type.fields and __Type.enumValues fields
		introspectionFactory, err := introspection_datasource.NewIntrospectionConfigFactory(clientSchemaDefinition)
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
		ClientSchema:    clientSchemaDefinition,
		RouterSchema:    &routerSchemaDefinition,
		Resolver:        resolver,
		RenameTypeNames: renameTypeNames,
	}, nil
}

func buildNatsOptions(eventSource config.NatsEventSource, logger *zap.Logger) ([]nats.Option, error) {

	opts := []nats.Option{
		nats.ErrorHandler(func(conn *nats.Conn, subscription *nats.Subscription, err error) {

			if errors.Is(err, nats.ErrSlowConsumer) {
				logger.Warn(
					"Nats slow consumer detected. Events are being dropped. Please consider increasing the buffer size or reducing the number of messages being sent.",
					zap.Error(err),
				)
			} else {
				logger.Error("nats error", zap.Error(err))
			}
		}),
	}

	if eventSource.Authentication != nil {
		if eventSource.Authentication.Token != nil {
			opts = append(opts, nats.Token(*eventSource.Authentication.Token))
		} else if eventSource.Authentication.UserInfo.Username != nil && eventSource.Authentication.UserInfo.Password != nil {
			opts = append(opts, nats.UserInfo(*eventSource.Authentication.UserInfo.Username, *eventSource.Authentication.UserInfo.Password))
		}
	}

	return opts, nil
}

// buildKafkaOptions creates a list of kgo.Opt options for the given Kafka event source configuration.
// Only general options like TLS, SASL, etc. are configured here. Specific options like topics, etc. are
// configured in the KafkaPubSub implementation.
func buildKafkaOptions(eventSource config.KafkaEventSource) ([]kgo.Opt, error) {

	opts := []kgo.Opt{
		kgo.SeedBrokers(eventSource.Brokers...),
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

	if eventSource.Authentication != nil && eventSource.Authentication.SASLPlain.Username != nil && eventSource.Authentication.SASLPlain.Password != nil {
		opts = append(opts, kgo.SASL(plain.Auth{
			User: *eventSource.Authentication.SASLPlain.Username,
			Pass: *eventSource.Authentication.SASLPlain.Password,
		}.AsMechanism()))
	}

	return opts, nil
}

func (b *ExecutorConfigurationBuilder) buildPlannerConfiguration(ctx context.Context, routerCfg *nodev1.RouterConfig, routerEngineCfg *RouterEngineConfiguration, pubSubProviders *EnginePubSubProviders) (*plan.Configuration, error) {
	// this loader is used to take the engine config and create a plan config
	// the plan config is what the engine uses to turn a GraphQL Request into an execution plan
	// the plan config is stateful as it carries connection pools and other things

	loader := NewLoader(b.includeInfo, NewDefaultFactoryResolver(
		ctx,
		NewTransport(b.transportOptions),
		b.transport,
		b.logger,
		routerEngineCfg.Execution.EnableSingleFlight,
		pubSubProviders.nats,
		pubSubProviders.kafka,
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
