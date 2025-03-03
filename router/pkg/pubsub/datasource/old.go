package datasource

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/jensneuse/abstractlogger"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type EventType string

const (
	EventTypePublish   EventType = "publish"
	EventTypeRequest   EventType = "request"
	EventTypeSubscribe EventType = "subscribe"
)

var eventSubjectRegex = regexp.MustCompile(`{{ args.([a-zA-Z0-9_]+) }}`)

func EventTypeFromString(s string) (EventType, error) {
	et := EventType(strings.ToLower(s))
	switch et {
	case EventTypePublish, EventTypeRequest, EventTypeSubscribe:
		return et, nil
	default:
		return "", fmt.Errorf("invalid event type: %q", s)
	}
}

type Configuration struct {
	pubSubs []Factory
}

type Planner struct {
	id           int
	pubSubs      []any
	eventManager any
	rootFieldRef int
	variables    resolve.Variables
	visitor      *plan.Visitor
	config       Configuration
}

func (p *Planner) SetID(id int) {
	p.id = id
}

func (p *Planner) ID() (id int) {
	return p.id
}

func (p *Planner) EnterField(ref int) {
	if p.rootFieldRef != -1 {
		// This is a nested field; nothing needs to be done
		return
	}
	p.rootFieldRef = ref

	fieldName := p.visitor.Operation.FieldNameString(ref)
	typeName := p.visitor.Walker.EnclosingTypeDefinition.NameString(p.visitor.Definition)

	p.visitor.Walker.StopWithInternalErr(fmt.Errorf("nope fieldName %s and typeName %s", fieldName, typeName))

	//switch v := eventConfig.Configuration.(type) {
	//case *NatsEventConfiguration:
	//	em := &NatsEventManager{
	//		visitor:            p.visitor,
	//		variables:          &p.variables,
	//		eventMetadata:      *eventConfig.Metadata,
	//		eventConfiguration: v,
	//	}
	//	p.eventManager = em
	//
	//	switch eventConfig.Metadata.Type {
	//	case EventTypePublish, EventTypeRequest:
	//		em.handlePublishAndRequestEvent(ref)
	//	case EventTypeSubscribe:
	//		em.handleSubscriptionEvent(ref)
	//	default:
	//		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("invalid EventType \"%s\" for Nats", eventConfig.Metadata.Type))
	//	}
	//case *KafkaEventConfiguration:
	//	em := &KafkaEventManager{
	//		visitor:            p.visitor,
	//		variables:          &p.variables,
	//		eventMetadata:      *eventConfig.Metadata,
	//		eventConfiguration: v,
	//	}
	//	p.eventManager = em
	//
	//	switch eventConfig.Metadata.Type {
	//	case EventTypePublish:
	//		em.handlePublishEvent(ref)
	//	case EventTypeSubscribe:
	//		em.handleSubscriptionEvent(ref)
	//	default:
	//		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("invalid EventType \"%s\" for Kafka", eventConfig.Metadata.Type))
	//	}
	//default:
	//	p.visitor.Walker.StopWithInternalErr(fmt.Errorf("invalid event configuration type: %T", v))
	//}
}

func (p *Planner) EnterDocument(_, _ *ast.Document) {
	p.rootFieldRef = -1
	p.eventManager = nil
}

func (p *Planner) Register(visitor *plan.Visitor, configuration plan.DataSourceConfiguration[Configuration], dataSourcePlannerConfiguration plan.DataSourcePlannerConfiguration) error {
	p.visitor = visitor
	visitor.Walker.RegisterEnterFieldVisitor(p)
	visitor.Walker.RegisterEnterDocumentVisitor(p)
	p.config = configuration.CustomConfiguration()
	return nil
}

func (p *Planner) ConfigureFetch() resolve.FetchConfiguration {
	if p.eventManager == nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to configure fetch: event manager is nil"))
		return resolve.FetchConfiguration{}
	}

	//var dataSource resolve.DataSource
	//
	//switch v := p.eventManager.(type) {
	//case *NatsEventManager:
	//	pubsub, ok := p.natsPubSubByProviderID[v.eventMetadata.ProviderID]
	//	if !ok {
	//		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("no pubsub connection exists with provider id \"%s\"", v.eventMetadata.ProviderID))
	//		return resolve.FetchConfiguration{}
	//	}
	//
	//	switch v.eventMetadata.Type {
	//	case EventTypePublish:
	//		dataSource = &NatsPublishDataSource{
	//			pubSub: pubsub,
	//		}
	//	case EventTypeRequest:
	//		dataSource = &NatsRequestDataSource{
	//			pubSub: pubsub,
	//		}
	//	default:
	//		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to configure fetch: invalid event type \"%s\" for Nats", v.eventMetadata.Type))
	//		return resolve.FetchConfiguration{}
	//	}
	//
	//	return resolve.FetchConfiguration{
	//		Input:      v.publishAndRequestEventConfiguration.MarshalJSONTemplate(),
	//		Variables:  p.variables,
	//		DataSource: dataSource,
	//		PostProcessing: resolve.PostProcessingConfiguration{
	//			MergePath: []string{v.eventMetadata.FieldName},
	//		},
	//	}
	//
	//case *KafkaEventManager:
	//	pubsub, ok := p.kafkaPubSubByProviderID[v.eventMetadata.ProviderID]
	//	if !ok {
	//		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("no pubsub connection exists with provider id \"%s\"", v.eventMetadata.ProviderID))
	//		return resolve.FetchConfiguration{}
	//	}
	//
	//	switch v.eventMetadata.Type {
	//	case EventTypePublish:
	//		dataSource = &KafkaPublishDataSource{
	//			pubSub: pubsub,
	//		}
	//	case EventTypeRequest:
	//		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("event type \"%s\" is not supported for Kafka", v.eventMetadata.Type))
	//		return resolve.FetchConfiguration{}
	//	default:
	//		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to configure fetch: invalid event type \"%s\" for Kafka", v.eventMetadata.Type))
	//		return resolve.FetchConfiguration{}
	//	}
	//
	//	return resolve.FetchConfiguration{
	//		Input:      v.publishEventConfiguration.MarshalJSONTemplate(),
	//		Variables:  p.variables,
	//		DataSource: dataSource,
	//		PostProcessing: resolve.PostProcessingConfiguration{
	//			MergePath: []string{v.eventMetadata.FieldName},
	//		},
	//	}
	//
	//default:
	//	p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to configure fetch: invalid event manager type: %T", p.eventManager))
	//}

	return resolve.FetchConfiguration{}
}

func (p *Planner) ConfigureSubscription() plan.SubscriptionConfiguration {
	if p.eventManager == nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to configure subscription: event manager is nil"))
		return plan.SubscriptionConfiguration{}
	}

	//switch v := p.eventManager.(type) {
	//case *NatsEventManager:
	//	pubsub, ok := p.natsPubSubByProviderID[v.eventMetadata.ProviderID]
	//	if !ok {
	//		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("no pubsub connection exists with provider id \"%s\"", v.eventMetadata.ProviderID))
	//		return plan.SubscriptionConfiguration{}
	//	}
	//	object, err := json.Marshal(v.subscriptionEventConfiguration)
	//	if err != nil {
	//		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to marshal event subscription streamConfiguration"))
	//		return plan.SubscriptionConfiguration{}
	//	}
	//	return plan.SubscriptionConfiguration{
	//		Input:     string(object),
	//		Variables: p.variables,
	//		DataSource: &NatsSubscriptionSource{
	//			pubSub: pubsub,
	//		},
	//		PostProcessing: resolve.PostProcessingConfiguration{
	//			MergePath: []string{v.eventMetadata.FieldName},
	//		},
	//	}
	//case *KafkaEventManager:
	//	pubsub, ok := p.kafkaPubSubByProviderID[v.eventMetadata.ProviderID]
	//	if !ok {
	//		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("no pubsub connection exists with provider id \"%s\"", v.eventMetadata.ProviderID))
	//		return plan.SubscriptionConfiguration{}
	//	}
	//	object, err := json.Marshal(v.subscriptionEventConfiguration)
	//	if err != nil {
	//		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to marshal event subscription streamConfiguration"))
	//		return plan.SubscriptionConfiguration{}
	//	}
	//	return plan.SubscriptionConfiguration{
	//		Input:     string(object),
	//		Variables: p.variables,
	//		DataSource: &KafkaSubscriptionSource{
	//			pubSub: pubsub,
	//		},
	//		PostProcessing: resolve.PostProcessingConfiguration{
	//			MergePath: []string{v.eventMetadata.FieldName},
	//		},
	//	}
	//default:
	//	p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to configure subscription: invalid event manager type: %T", p.eventManager))
	//}

	return plan.SubscriptionConfiguration{}
}

func (p *Planner) DataSourcePlanningBehavior() plan.DataSourcePlanningBehavior {
	return plan.DataSourcePlanningBehavior{
		MergeAliasedRootNodes:      false,
		OverrideFieldPathFromAlias: false,
		IncludeTypeNameFields:      true,
	}
}

func (p *Planner) DownstreamResponseFieldAlias(_ int) (alias string, exists bool) {
	return "", false
}

func NewFactory(executionContext context.Context, pubSubs []any) *Factory {
	return &Factory{
		executionContext: executionContext,
		pubSubs:          pubSubs,
	}
}

type Factory struct {
	executionContext context.Context
	pubSubs          []any
}

func (f *Factory) Planner(_ abstractlogger.Logger) plan.DataSourcePlanner[Configuration] {
	return &Planner{
		pubSubs: f.pubSubs,
	}
}

func (f *Factory) Context() context.Context {
	return f.executionContext
}

func (f *Factory) UpstreamSchema(dataSourceConfig plan.DataSourceConfiguration[Configuration]) (*ast.Document, bool) {
	return nil, false
}
