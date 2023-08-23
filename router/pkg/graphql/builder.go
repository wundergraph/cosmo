package graphql

import (
	"context"
	"fmt"
	"github.com/dgraph-io/ristretto"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/factoryresolver"
	"github.com/wundergraph/cosmo/router/pkg/pool"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/introspection_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
	"net/http"
)

type BuilderOption func(b *HandlerBuilder)

type HandlerBuilder struct {
	introspection bool
	baseURL       string
	transport     *http.Transport
	logger        *zap.Logger
	planCache     *ristretto.Cache
}

func NewGraphQLHandlerBuilder(opts ...BuilderOption) *HandlerBuilder {
	b := &HandlerBuilder{}
	for _, opt := range opts {
		opt(b)
	}

	if b.logger == nil {
		b.logger = zap.NewNop()
	}

	return b
}

func (b *HandlerBuilder) Build(ctx context.Context, routerConfig *nodev1.RouterConfig) (*GraphQLHandler, error) {
	planConfig, err := b.buildPlannerConfiguration(routerConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to build planner configuration: %w", err)
	}

	// this is the resolver, it's stateful and manages all the client connections, etc...
	resolver := resolve.New(ctx, resolve.NewFetcher(true), true)

	// this is the GraphQL Schema that we will expose from our API
	definition, report := astparser.ParseGraphqlDocumentString(routerConfig.EngineConfig.GraphqlSchema)
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

	// finally, we can create the GraphQL Handler and mount it on the router
	graphQLHandler := NewGraphQLHandler(HandlerOptions{
		PlanConfig:      *planConfig,
		Definition:      &definition,
		Resolver:        resolver,
		RenameTypeNames: renameTypeNames,
		Pool:            pool.New(),
		Cache:           b.planCache,
		Log:             b.logger,
	})

	return graphQLHandler, nil
}

func (b *HandlerBuilder) buildPlannerConfiguration(routerCfg *nodev1.RouterConfig) (*plan.Configuration, error) {
	// this loader is used to take the engine config and create a plan config
	// the plan config is what the engine uses to turn a GraphQL Request into an execution plan
	// the plan config is stateful as it carries connection pools and other things
	loader := factoryresolver.NewLoader(factoryresolver.NewDefaultFactoryResolver(
		factoryresolver.New(),
		b.transport,
		b.logger,
	))

	// this generates the plan config using the data source factories from the config package
	planConfig, err := loader.Load(routerCfg.EngineConfig, b.baseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to load configuration: %w", err)
	}
	//planConfig.Debug = plan.DebugConfiguration{
	//	PrintOperationWithRequiredFields: true,
	//	PrintPlanningPaths:               true,
	//	PrintQueryPlans:                  true,
	//	ConfigurationVisitor:             false,
	//	PlanningVisitor:                  false,
	//	DatasourceVisitor:                false,
	//}
	return planConfig, nil
}

func WithIntrospection() BuilderOption {
	return func(b *HandlerBuilder) {
		b.introspection = true
	}
}

func WithBaseURL(baseURL string) BuilderOption {
	return func(b *HandlerBuilder) {
		b.baseURL = baseURL
	}
}

func WithTransport(transport *http.Transport) BuilderOption {
	return func(b *HandlerBuilder) {
		b.transport = transport
	}
}

func WithLogger(logger *zap.Logger) BuilderOption {
	return func(b *HandlerBuilder) {
		b.logger = logger
	}
}

func WithPlanCache(planCache *ristretto.Cache) BuilderOption {
	return func(b *HandlerBuilder) {
		b.planCache = planCache
	}
}
