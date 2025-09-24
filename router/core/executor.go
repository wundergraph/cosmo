package core

import (
	"context"
	"fmt"
	"net/http"
	"time"

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
	"github.com/wundergraph/cosmo/router/pkg/grpcconnector"
	pubsub_datasource "github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
)

type ExecutorConfigurationBuilder struct {
	introspection  bool
	trackUsageInfo bool
	baseURL        string
	logger         *zap.Logger

	transportOptions *TransportOptions
	baseTripper      http.RoundTripper
	subgraphTrippers map[string]http.RoundTripper
	pluginHost       *grpcconnector.Connector

	subscriptionClientOptions *SubscriptionClientOptions
	instanceData              InstanceData
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
	TrackUsageInfo  bool
}

type ExecutorBuildOptions struct {
	EngineConfig                   *nodev1.EngineConfiguration
	Subgraphs                      []*nodev1.Subgraph
	RouterEngineConfig             *RouterEngineConfiguration
	Reporter                       resolve.Reporter
	ApolloCompatibilityFlags       config.ApolloCompatibilityFlags
	ApolloRouterCompatibilityFlags config.ApolloRouterCompatibilityFlags
	HeartbeatInterval              time.Duration
	TraceClientRequired            bool
	PluginsEnabled                 bool
	InstanceData                   InstanceData
}

func (b *ExecutorConfigurationBuilder) Build(ctx context.Context, opts *ExecutorBuildOptions) (*Executor, []pubsub_datasource.Provider, error) {
	planConfig, providers, err := b.buildPlannerConfiguration(ctx, opts.EngineConfig, opts.Subgraphs, opts.RouterEngineConfig, opts.PluginsEnabled)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to build planner configuration: %w", err)
	}

	options := resolve.ResolverOptions{
		MaxConcurrency:                     opts.RouterEngineConfig.Execution.MaxConcurrentResolvers,
		Debug:                              opts.RouterEngineConfig.Execution.Debug.EnableResolverDebugging,
		Reporter:                           opts.Reporter,
		PropagateSubgraphErrors:            opts.RouterEngineConfig.SubgraphErrorPropagation.Enabled,
		PropagateSubgraphStatusCodes:       opts.RouterEngineConfig.SubgraphErrorPropagation.PropagateStatusCodes,
		RewriteSubgraphErrorPaths:          opts.RouterEngineConfig.SubgraphErrorPropagation.RewritePaths,
		OmitSubgraphErrorLocations:         opts.RouterEngineConfig.SubgraphErrorPropagation.OmitLocations,
		OmitSubgraphErrorExtensions:        opts.RouterEngineConfig.SubgraphErrorPropagation.OmitExtensions,
		AllowedErrorExtensionFields:        opts.RouterEngineConfig.SubgraphErrorPropagation.AllowedExtensionFields,
		AttachServiceNameToErrorExtensions: opts.RouterEngineConfig.SubgraphErrorPropagation.AttachServiceName,
		DefaultErrorExtensionCode:          opts.RouterEngineConfig.SubgraphErrorPropagation.DefaultExtensionCode,
		AllowedSubgraphErrorFields:         opts.RouterEngineConfig.SubgraphErrorPropagation.AllowedFields,
		AllowAllErrorExtensionFields:       opts.RouterEngineConfig.SubgraphErrorPropagation.AllowAllExtensionFields,
		MaxRecyclableParserSize:            opts.RouterEngineConfig.Execution.ResolverMaxRecyclableParserSize,
		SubscriptionHeartbeatInterval:      opts.HeartbeatInterval,
		MaxSubscriptionFetchTimeout:        opts.RouterEngineConfig.Execution.SubscriptionFetchTimeout,
		PropagateFetchReasons:              opts.RouterEngineConfig.Execution.EnableRequireFetchReasons,
	}

	if opts.ApolloCompatibilityFlags.ValueCompletion.Enabled {
		options.ResolvableOptions.ApolloCompatibilityValueCompletionInExtensions = true
	}
	if opts.ApolloCompatibilityFlags.TruncateFloats.Enabled {
		options.ResolvableOptions.ApolloCompatibilityTruncateFloatValues = true
	}
	if opts.ApolloCompatibilityFlags.SuppressFetchErrors.Enabled {
		options.ResolvableOptions.ApolloCompatibilitySuppressFetchErrors = true
	}
	if opts.ApolloCompatibilityFlags.ReplaceInvalidVarErrors.Enabled {
		options.ResolvableOptions.ApolloCompatibilityReplaceInvalidVarError = true
	}

	if opts.ApolloRouterCompatibilityFlags.SubrequestHTTPError.Enabled {
		options.ApolloRouterCompatibilitySubrequestHTTPError = true
	}

	switch opts.RouterEngineConfig.SubgraphErrorPropagation.Mode {
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

	routerSchemaDefinition, report = astparser.ParseGraphqlDocumentString(opts.EngineConfig.GraphqlSchema)
	if report.HasErrors() {
		return nil, providers, fmt.Errorf("failed to parse graphql schema from engine config: %w", report)
	}
	// we need to merge the base schema, it contains the __schema and __type queries,
	// as well as built-in scalars like Int, String, etc...
	// these are usually not part of a regular GraphQL schema
	// the engine needs to have them defined, otherwise it cannot resolve such fields
	err = asttransform.MergeDefinitionWithBaseSchema(&routerSchemaDefinition)
	if err != nil {
		return nil, providers, fmt.Errorf("failed to merge graphql schema with base schema: %w", err)
	}

	if clientSchemaStr := opts.EngineConfig.GetGraphqlClientSchema(); clientSchemaStr != "" {
		// The client schema is a subset of the router schema that does not include @inaccessible fields.
		// The client schema only exists if the federated schema includes @inaccessible directives or @tag directives

		clientSchema, report := astparser.ParseGraphqlDocumentString(clientSchemaStr)
		if report.HasErrors() {
			return nil, providers, fmt.Errorf("failed to parse graphql client schema from engine config: %w", report)
		}
		err = asttransform.MergeDefinitionWithBaseSchema(&clientSchema)
		if err != nil {
			return nil, providers, fmt.Errorf("failed to merge graphql client schema with base schema: %w", err)
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
			return nil, providers, fmt.Errorf("failed to create introspection config factory: %w", err)
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
		TrackUsageInfo:  b.trackUsageInfo,
	}, providers, nil
}

func (b *ExecutorConfigurationBuilder) buildPlannerConfiguration(ctx context.Context, engineConfig *nodev1.EngineConfiguration, subgraphs []*nodev1.Subgraph, routerEngineCfg *RouterEngineConfiguration, pluginsEnabled bool) (*plan.Configuration, []pubsub_datasource.Provider, error) {
	// this loader is used to take the engine config and create a plan config
	// the plan config is what the engine uses to turn a GraphQL Request into an execution plan
	// the plan config is stateful as it carries connection pools and other things

	loader := NewLoader(ctx, b.trackUsageInfo, NewDefaultFactoryResolver(
		ctx,
		b.transportOptions,
		b.subscriptionClientOptions,
		b.baseTripper,
		b.subgraphTrippers,
		b.pluginHost,
		b.logger,
		routerEngineCfg.Execution.EnableSingleFlight,
		routerEngineCfg.Execution.EnableNetPoll,
		b.instanceData,
	), b.logger)

	// this generates the plan config using the data source factories from the config package
	planConfig, providers, err := loader.Load(engineConfig, subgraphs, routerEngineCfg, pluginsEnabled)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to load configuration: %w", err)
	}
	debug := &routerEngineCfg.Execution.Debug
	planConfig.Debug = plan.DebugConfiguration{
		PrintOperationTransformations: debug.PrintOperationTransformations,
		PrintOperationEnableASTRefs:   debug.PrintOperationEnableASTRefs,
		PrintPlanningPaths:            debug.PrintPlanningPaths,
		PrintQueryPlans:               debug.PrintIntermediateQueryPlans,
		PrintNodeSuggestions:          debug.PrintNodeSuggestions,
		ConfigurationVisitor:          debug.ConfigurationVisitor,
		PlanningVisitor:               debug.PlanningVisitor,
		DatasourceVisitor:             debug.DatasourceVisitor,
	}
	planConfig.MinifySubgraphOperations = routerEngineCfg.Execution.MinifySubgraphOperations

	planConfig.EnableOperationNamePropagation = routerEngineCfg.Execution.EnableSubgraphFetchOperationName

	planConfig.BuildFetchReasons = routerEngineCfg.Execution.EnableRequireFetchReasons

	return planConfig, providers, nil
}
