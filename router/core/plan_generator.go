package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/wundergraph/cosmo/router/pkg/metric"

	log "github.com/jensneuse/abstractlogger"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvalidation"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/introspection_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/postprocess"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
	"go.uber.org/zap"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/nats"

	"github.com/wundergraph/cosmo/router/pkg/execution_config"
)

type PlannerOperationValidationError struct {
	err error
}

func (e *PlannerOperationValidationError) Error() string {
	return e.err.Error()
}

type PlanGenerator struct {
	planConfiguration *plan.Configuration
	clientDefinition  *ast.Document
	definition        *ast.Document
}

type Planner struct {
	planner            *plan.Planner
	definition         *ast.Document
	clientDefinition   *ast.Document
	operationValidator *astvalidation.OperationValidator
}

type OperationTimes struct {
	ParseTime     time.Duration
	NormalizeTime time.Duration
	ValidateTime  time.Duration
	PlanTime      time.Duration
}

func (ot *OperationTimes) TotalTime() time.Duration {
	return ot.ParseTime + ot.NormalizeTime + ot.ValidateTime + ot.PlanTime
}

func (ot OperationTimes) Merge(other OperationTimes) OperationTimes {
	return OperationTimes{
		ParseTime:     ot.ParseTime + other.ParseTime,
		NormalizeTime: ot.NormalizeTime + other.NormalizeTime,
		ValidateTime:  ot.ValidateTime + other.ValidateTime,
		PlanTime:      ot.PlanTime + other.PlanTime,
	}
}

type PlanOutputFormat string

const (
	PlanOutputFormatUnset PlanOutputFormat = ""
	PlanOutputFormatText  PlanOutputFormat = "text"
	PlanOutputFormatJSON  PlanOutputFormat = "json"
)

func NewPlanner(planConfiguration *plan.Configuration, definition *ast.Document, clientDefinition *ast.Document) (*Planner, error) {
	planner, err := plan.NewPlanner(*planConfiguration)
	if err != nil {
		return nil, fmt.Errorf("failed to create planner: %w", err)
	}

	return &Planner{
		planner:          planner,
		definition:       definition,
		clientDefinition: clientDefinition,
	}, nil
}

// PlanOperation creates a query plan from an operation file in a pretty-printed text or JSON format
func (pl *Planner) PlanOperation(operationFilePath string, outputFormat PlanOutputFormat) (string, OperationTimes, error) {
	operation, opTimes, err := pl.ParseAndPrepareOperation(operationFilePath)
	if err != nil {
		return "", opTimes, err
	}

	rawPlan, opTimes2, err := pl.PlanPreparedOperation(operation)
	opTimes = opTimes.Merge(opTimes2)
	if err != nil {
		return "", opTimes, fmt.Errorf("failed to plan operation: %w", err)
	}

	switch outputFormat {
	case PlanOutputFormatText:
		return rawPlan.PrettyPrint(), opTimes, nil
	case PlanOutputFormatJSON:
		marshal, err := json.Marshal(rawPlan)
		if err != nil {
			return "", opTimes, fmt.Errorf("failed to marshal raw plan: %w", err)
		}
		return string(marshal), opTimes, nil
	}

	return "", opTimes, fmt.Errorf("invalid outputFormat specified: %q", outputFormat)
}

// ParseAndPrepareOperation parses, normalizes and validates the operation
func (pl *Planner) ParseAndPrepareOperation(operationFilePath string) (*ast.Document, OperationTimes, error) {
	start := time.Now()
	operation, err := pl.parseOperation(operationFilePath)
	parseTime := time.Since(start)
	if err != nil {
		return nil, OperationTimes{ParseTime: parseTime}, &PlannerOperationValidationError{err: err}
	}

	operation, opTimes, err := pl.PrepareOperation(operation)
	opTimes.ParseTime = parseTime
	if err != nil {
		return nil, opTimes, err
	}

	return operation, opTimes, nil
}

// PrepareOperation normalizes and validates the operation
func (pl *Planner) PrepareOperation(operation *ast.Document) (*ast.Document, OperationTimes, error) {
	operationName := findOperationName(operation)
	if operationName == nil {
		return nil, OperationTimes{}, &PlannerOperationValidationError{err: errors.New("operation name not found")}
	}

	opTimes := OperationTimes{}

	start := time.Now()
	err := pl.normalizeOperation(operation, operationName)
	opTimes.NormalizeTime = time.Since(start)
	if err != nil {
		return nil, opTimes, &PlannerOperationValidationError{err: err}
	}

	start = time.Now()
	err = pl.validateOperation(operation)
	opTimes.ValidateTime = time.Since(start)
	if err != nil {
		return nil, opTimes, &PlannerOperationValidationError{err: err}
	}

	return operation, opTimes, nil
}

func (pl *Planner) normalizeOperation(operation *ast.Document, operationName []byte) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic during operation normalization: %v", r)
		}
	}()

	report := operationreport.Report{}

	normalizer := astnormalization.NewWithOpts(
		astnormalization.WithRemoveNotMatchingOperationDefinitions(),
		astnormalization.WithExtractVariables(),
		astnormalization.WithRemoveFragmentDefinitions(),
		astnormalization.WithInlineFragmentSpreads(),
		astnormalization.WithRemoveUnusedVariables(),
		astnormalization.WithIgnoreSkipInclude(),
	)
	normalizer.NormalizeNamedOperation(operation, pl.definition, operationName, &report)
	if report.HasErrors() {
		return report
	}

	remapper := astnormalization.NewVariablesMapper()
	remapper.NormalizeOperation(operation, pl.definition, &report)
	if report.HasErrors() {
		return report
	}

	return nil
}

// PlanPreparedOperation creates a query plan from a normalized and validated operation
func (pl *Planner) PlanPreparedOperation(operation *ast.Document) (planNode *resolve.FetchTreeQueryPlanNode, opTimes OperationTimes, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic during plan generation: %v", r)
		}
	}()

	report := operationreport.Report{}

	operationName := findOperationName(operation)

	if operationName == nil {
		return nil, opTimes, errors.New("operation name not found")
	}

	// create and postprocess the plan
	start := time.Now()
	preparedPlan := pl.planner.Plan(operation, pl.definition, string(operationName), &report, plan.IncludeQueryPlanInResponse())
	opTimes.PlanTime = time.Since(start)
	if report.HasErrors() {
		return nil, opTimes, errors.New(report.Error())
	}

	post := postprocess.NewProcessor()
	post.Process(preparedPlan)
	// measure postprocessing time as part of planning time
	opTimes.PlanTime = time.Since(start)

	switch p := preparedPlan.(type) {
	case *plan.SynchronousResponsePlan:
		return p.Response.Fetches.QueryPlan(), opTimes, nil
	case *plan.SubscriptionResponsePlan:
		return p.Response.Response.Fetches.QueryPlan(), opTimes, nil
	}

	return &resolve.FetchTreeQueryPlanNode{}, opTimes, nil
}

func (pl *Planner) validateOperation(operation *ast.Document) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic during operation validation: %v", r)
		}
	}()

	pl.operationValidator = astvalidation.DefaultOperationValidator()

	report := operationreport.Report{}
	pl.operationValidator.Validate(operation, pl.clientDefinition, &report)
	if report.HasErrors() {
		return report
	}

	return nil
}

func (pl *Planner) parseOperation(operationFilePath string) (*ast.Document, error) {
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

func NewPlanGenerator(configFilePath string, logger *zap.Logger, maxDataSourceCollectorsConcurrency uint) (*PlanGenerator, error) {
	pg := &PlanGenerator{}
	routerConfig, err := pg.buildRouterConfig(configFilePath)
	if err != nil {
		return nil, err
	}

	if err := pg.loadConfiguration(
		routerConfig,
		logger,
		maxDataSourceCollectorsConcurrency,
	); err != nil {
		return nil, err
	}

	return pg, nil
}

func NewPlanGeneratorFromConfig(config *nodev1.RouterConfig, logger *zap.Logger, maxDataSourceCollectorsConcurrency uint) (*PlanGenerator, error) {
	pg := &PlanGenerator{}
	if err := pg.loadConfiguration(config, logger, maxDataSourceCollectorsConcurrency); err != nil {
		return nil, err
	}

	return pg, nil
}

func (pg *PlanGenerator) GetPlanner() (*Planner, error) {
	return NewPlanner(pg.planConfiguration, pg.definition, pg.clientDefinition)
}

func (pg *PlanGenerator) buildRouterConfig(configFilePath string) (*nodev1.RouterConfig, error) {
	routerConfig, err := execution_config.FromFile(configFilePath)
	if err != nil {
		return nil, err
	}

	return routerConfig, nil
}

func (pg *PlanGenerator) loadConfiguration(routerConfig *nodev1.RouterConfig, logger *zap.Logger, maxDataSourceCollectorsConcurrency uint) error {
	routerEngineConfig := RouterEngineConfiguration{
		StreamMetricStore: metric.NewNoopStreamMetricStore(),
	}
	natSources := map[string]*nats.ProviderAdapter{}
	kafkaSources := map[string]*kafka.ProviderAdapter{}
	for _, ds := range routerConfig.GetEngineConfig().GetDatasourceConfigurations() {
		if ds.GetKind() != nodev1.DataSourceKind_PUBSUB || ds.GetCustomEvents() == nil {
			continue
		}
		for _, natConfig := range ds.GetCustomEvents().GetNats() {
			providerId := natConfig.GetEngineEventConfiguration().GetProviderId()
			if _, ok := natSources[providerId]; !ok {
				natSources[providerId] = nil
				routerEngineConfig.Events.Providers.Nats = append(routerEngineConfig.Events.Providers.Nats, config.NatsEventSource{
					ID: providerId,
				})
			}
		}
		for _, kafkaConfig := range ds.GetCustomEvents().GetKafka() {
			providerId := kafkaConfig.GetEngineEventConfiguration().GetProviderId()
			if _, ok := kafkaSources[providerId]; !ok {
				kafkaSources[providerId] = nil
				routerEngineConfig.Events.Providers.Kafka = append(routerEngineConfig.Events.Providers.Kafka, config.KafkaEventSource{
					ID: providerId,
				})
			}
		}
	}

	var netPollConfig graphql_datasource.NetPollConfiguration
	netPollConfig.ApplyDefaults()

	subscriptionClient := graphql_datasource.NewGraphQLSubscriptionClient(
		http.DefaultClient,
		http.DefaultClient,
		context.Background(),
		graphql_datasource.WithLogger(log.NoopLogger),
		graphql_datasource.WithNetPollConfiguration(netPollConfig),
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	loader := NewLoader(ctx, false, &DefaultFactoryResolver{
		engineCtx:          ctx,
		httpClient:         http.DefaultClient,
		streamingClient:    http.DefaultClient,
		subscriptionClient: subscriptionClient,
	}, logger, subscriptionHooks{})

	// this generates the plan configuration using the data source factories from the config package
	planConfig, _, err := loader.Load(routerConfig.GetEngineConfig(), routerConfig.GetSubgraphs(), &routerEngineConfig, false) // TODO: configure plugins
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

	planConfig.MaxDataSourceCollectorsConcurrency = maxDataSourceCollectorsConcurrency

	if logger != nil {
		planConfig.Logger = log.NewZapLogger(logger, log.DebugLevel)
	}
	var clientSchemaDefinition *ast.Document

	// this is the GraphQL Schema that we will expose from our API
	definition, report := astparser.ParseGraphqlDocumentString(routerConfig.EngineConfig.GraphqlSchema)
	if report.HasErrors() {
		return fmt.Errorf("failed to parse graphql schema from engine config: %w", report)
	}

	// we need to merge the base schema, it contains the __schema and __type queries
	// these are not usually part of a regular GraphQL schema
	// the engine needs to have them defined, otherwise it cannot resolve such fields

	if err := asttransform.MergeDefinitionWithBaseSchema(&definition); err != nil {
		return fmt.Errorf("failed to merge graphql schema with base schema: %w", err)
	}

	if clientSchemaStr := routerConfig.GetEngineConfig().GetGraphqlClientSchema(); clientSchemaStr != "" {
		clientSchema, report := astparser.ParseGraphqlDocumentString(clientSchemaStr)
		if report.HasErrors() {
			return fmt.Errorf("failed to parse graphql client schema from engine config: %w", report)
		}
		err = asttransform.MergeDefinitionWithBaseSchema(&clientSchema)
		if err != nil {
			return fmt.Errorf("failed to merge graphql client schema with base schema: %w", err)
		}
		clientSchemaDefinition = &clientSchema
	} else {
		clientSchemaDefinition = &definition
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
	pg.clientDefinition = clientSchemaDefinition
	return nil
}

func (pg *PlanGenerator) GetPlanConfiguration() *plan.Configuration {
	return pg.planConfiguration
}

func findOperationName(operation *ast.Document) (operationName []byte) {
	for i := range operation.RootNodes {
		if operation.RootNodes[i].Kind == ast.NodeKindOperationDefinition {
			return operation.OperationDefinitionNameBytes(operation.RootNodes[i].Ref)
		}
	}
	// TODO: assign static operation name if we have single anonymous operation
	return nil
}
