package core

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"

	log "github.com/jensneuse/abstractlogger"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/introspection_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/postprocess"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/config"

	"github.com/jensneuse/abstractlogger"
	"github.com/wundergraph/cosmo/router/pkg/execution_config"
)

type PlanGenerator struct {
	planConfiguration *plan.Configuration
	planner           *plan.Planner
	definition        *ast.Document
}

func NewPlanGenerator(configFilePath string, logger *zap.Logger) (*PlanGenerator, error) {
	pg := &PlanGenerator{}
	if err := pg.loadConfiguration(configFilePath); err != nil {
		return nil, err
	}

	if logger != nil {
		pg.planConfiguration.Logger = abstractlogger.NewZapLogger(logger, abstractlogger.DebugLevel)
	}

	planner, err := plan.NewPlanner(*pg.planConfiguration)
	if err != nil {
		return nil, fmt.Errorf("failed to create planner: %w", err)
	}
	pg.planner = planner

	return pg, nil
}

func (pg *PlanGenerator) PlanOperation(operationFilePath string) (string, error) {
	operation, err := pg.parseOperation(operationFilePath)
	if err != nil {
		return "", fmt.Errorf("failed to parse operation: %w", err)
	}

	rawPlan, err := pg.planOperation(operation)
	if err != nil {
		return "", fmt.Errorf("failed to plan operation: %w", err)
	}

	return rawPlan.PrettyPrint(), nil
}

func (pg *PlanGenerator) planOperation(operation *ast.Document) (*resolve.FetchTreeQueryPlanNode, error) {
	report := operationreport.Report{}

	var operationName []byte

	for i := range operation.RootNodes {
		if operation.RootNodes[i].Kind == ast.NodeKindOperationDefinition {
			operationName = operation.OperationDefinitionNameBytes(operation.RootNodes[i].Ref)
			break
		}
	}

	if operationName == nil {
		return nil, errors.New("operation name not found")
	}

	astnormalization.NormalizeNamedOperation(operation, pg.definition, operationName, &report)

	// create and postprocess the plan
	preparedPlan := pg.planner.Plan(operation, pg.definition, string(operationName), &report, plan.IncludeQueryPlanInResponse())
	if report.HasErrors() {
		return nil, errors.New(report.Error())
	}
	post := postprocess.NewProcessor()
	post.Process(preparedPlan)

	if p, ok := preparedPlan.(*plan.SynchronousResponsePlan); ok {
		return p.Response.Fetches.QueryPlan(), nil
	}

	return &resolve.FetchTreeQueryPlanNode{}, nil
}

func (pg *PlanGenerator) parseOperation(operationFilePath string) (*ast.Document, error) {
	content, err := os.ReadFile(operationFilePath)
	if err != nil {
		return nil, err
	}

	doc, report := astparser.ParseGraphqlDocumentBytes(content)
	if report.HasErrors() {
		return nil, errors.New(report.Error())
	}

	return &doc, nil
}

func (pg *PlanGenerator) loadConfiguration(configFilePath string) error {
	routerConfig, err := execution_config.FromFile(configFilePath)
	if err != nil {
		return err
	}

	natSources := map[string]pubsub_datasource.NatsPubSub{}
	kafkaSources := map[string]pubsub_datasource.KafkaPubSub{}
	for _, ds := range routerConfig.GetEngineConfig().GetDatasourceConfigurations() {
		if ds.GetKind() != nodev1.DataSourceKind_PUBSUB || ds.GetCustomEvents() == nil {
			continue
		}
		for _, natConfig := range ds.GetCustomEvents().GetNats() {
			providerId := natConfig.GetEngineEventConfiguration().GetProviderId()
			if _, ok := natSources[providerId]; !ok {
				natSources[providerId] = nil
			}
		}
		for _, kafkaConfig := range ds.GetCustomEvents().GetKafka() {
			providerId := kafkaConfig.GetEngineEventConfiguration().GetProviderId()
			if _, ok := kafkaSources[providerId]; !ok {
				kafkaSources[providerId] = nil
			}
		}
	}
	pubSubFactory := pubsub_datasource.NewFactory(context.Background(), natSources, kafkaSources)

	var netPollConfig graphql_datasource.NetPollConfiguration
	netPollConfig.ApplyDefaults()

	subscriptionClient := graphql_datasource.NewGraphQLSubscriptionClient(
		http.DefaultClient,
		http.DefaultClient,
		context.Background(),
		graphql_datasource.WithLogger(log.NoopLogger),
		graphql_datasource.WithNetPollConfiguration(netPollConfig),
	)

	loader := NewLoader(false, &DefaultFactoryResolver{
		engineCtx:          context.Background(),
		httpClient:         http.DefaultClient,
		streamingClient:    http.DefaultClient,
		subscriptionClient: subscriptionClient,
		transportOptions:   &TransportOptions{SubgraphTransportOptions: NewSubgraphTransportOptions(config.TrafficShapingRules{})},
		pubsub:             pubSubFactory,
	})

	// this generates the plan configuration using the data source factories from the config package
	planConfig, err := loader.Load(routerConfig.GetEngineConfig(), routerConfig.GetSubgraphs(), &RouterEngineConfiguration{})
	if err != nil {
		return fmt.Errorf("failed to load configuration: %w", err)
	}

	planConfig.Debug = plan.DebugConfiguration{
		PrintOperationTransformations: false,
		PrintOperationEnableASTRefs:   false,
		PrintPlanningPaths:            false,
		PrintQueryPlans:               false,
		PrintNodeSuggestions:          false,
		ConfigurationVisitor:          false,
		PlanningVisitor:               false,
		DatasourceVisitor:             false,
	}

	// this is the GraphQL Schema that we will expose from our API
	definition, report := astparser.ParseGraphqlDocumentString(routerConfig.EngineConfig.GraphqlSchema)
	if report.HasErrors() {
		return fmt.Errorf("failed to parse graphql schema from engine config: %w", report)
	}

	// we need to merge the base schema, it contains the __schema and __type queries
	// these are not usually part of a regular GraphQL schema
	// the engine needs to have them defined, otherwise it cannot resolve such fields
	err = asttransform.MergeDefinitionWithBaseSchema(&definition)
	if err != nil {
		return fmt.Errorf("failed to merge graphql schema with base schema: %w", err)
	}

	// by default, the engine doesn't understand how to resolve the __schema and __type queries
	// we need to add a special datasource for that
	// it takes the definition as the input and generates introspection data
	// datasource is attached to Query.__schema, Query.__type, __Type.fields and __Type.enumValues fields
	introspectionFactory, err := introspection_datasource.NewIntrospectionConfigFactory(&definition)
	if err != nil {
		return fmt.Errorf("failed to create introspection config factory: %w", err)
	}
	dataSources := introspectionFactory.BuildDataSourceConfigurations()

	fieldConfigs := introspectionFactory.BuildFieldConfigurations()
	// we need to add these fields to the config
	// otherwise the engine wouldn't know how to resolve them
	planConfig.Fields = append(planConfig.Fields, fieldConfigs...)
	// finally, we add our data source for introspection to the existing data sources
	planConfig.DataSources = append(planConfig.DataSources, dataSources...)

	pg.planConfiguration = planConfig
	pg.definition = &definition
	return nil
}
