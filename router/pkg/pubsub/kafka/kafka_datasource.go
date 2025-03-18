package kafka

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jensneuse/abstractlogger"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sasl/plain"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/utils"
	"go.uber.org/zap"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func GetDataSource(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger) (plan.DataSource, error) {
	if kafkaData := in.GetCustomEvents().GetKafka(); kafkaData != nil {
		k := NewPubSub(logger)
		err := k.PrepareProviders(ctx, in, dsMeta, config)
		if err != nil {
			return nil, err
		}
		factory := k.GetFactory(ctx, config)
		ds, err := plan.NewDataSourceConfiguration[Configuration](
			in.Id,
			factory,
			dsMeta,
			Configuration{
				EventConfiguration: kafkaData,
				Logger:             logger,
			},
		)

		if err != nil {
			return nil, err
		}

		return ds, nil
	}

	return nil, nil
}

func init() {
	datasource.RegisterPubSub(GetDataSource)
}

type Kafka struct {
	logger    *zap.Logger
	providers map[string]*kafkaPubSub
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

func (k *Kafka) PrepareProviders(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration) error {
	definedProviders := make(map[string]bool)
	for _, provider := range config.Providers.Kafka {
		definedProviders[provider.ID] = true
	}
	usedProviders := make(map[string]bool)
	for _, event := range in.CustomEvents.GetKafka() {
		if !definedProviders[event.EngineEventConfiguration.ProviderId] {
			return fmt.Errorf("failed to find Kafka provider with ID %s", event.EngineEventConfiguration.ProviderId)
		}
		usedProviders[event.EngineEventConfiguration.ProviderId] = true
	}
	for _, provider := range config.Providers.Kafka {
		if !usedProviders[provider.ID] {
			continue
		}
		options, err := buildKafkaOptions(provider)
		if err != nil {
			return fmt.Errorf("failed to build options for Kafka provider with ID \"%s\": %w", provider.ID, err)
		}
		ps, err := NewConnector(k.logger, options)
		if err != nil {
			return fmt.Errorf("failed to create connection for Kafka provider with ID \"%s\": %w", provider.ID, err)
		}
		k.providers[provider.ID] = ps.New(ctx)
	}
	return nil
}

func (k *Kafka) GetFactory(executionContext context.Context, config config.EventsConfiguration) *Factory {
	return NewFactory(executionContext, config, k.providers)
}

func NewPubSub(logger *zap.Logger) Kafka {
	return Kafka{
		providers: map[string]*kafkaPubSub{},
		logger:    logger,
	}
}

type Configuration struct {
	Data               string `json:"data"`
	EventConfiguration []*nodev1.KafkaEventConfiguration
	Logger             *zap.Logger
}

type Planner struct {
	id           int
	config       Configuration
	eventsConfig config.EventsConfiguration
	eventConfig  *nodev1.KafkaEventConfiguration
	rootFieldRef int
	variables    resolve.Variables
	visitor      *plan.Visitor
	providers    map[string]*kafkaPubSub
}

func (p *Planner) SetID(id int) {
	p.id = id
}

func (p *Planner) ID() (id int) {
	return p.id
}

func (p *Planner) DownstreamResponseFieldAlias(downstreamFieldRef int) (alias string, exists bool) {
	// skip, not required
	return
}

func (p *Planner) DataSourcePlanningBehavior() plan.DataSourcePlanningBehavior {
	return plan.DataSourcePlanningBehavior{
		MergeAliasedRootNodes:      false,
		OverrideFieldPathFromAlias: false,
	}
}

func (p *Planner) Register(visitor *plan.Visitor, configuration plan.DataSourceConfiguration[Configuration], _ plan.DataSourcePlannerConfiguration) error {
	p.visitor = visitor
	visitor.Walker.RegisterEnterFieldVisitor(p)
	visitor.Walker.RegisterEnterDocumentVisitor(p)
	p.config = configuration.CustomConfiguration()
	return nil
}

func (p *Planner) ConfigureFetch() resolve.FetchConfiguration {
	if p.eventConfig == nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to configure fetch: event config is nil"))
		return resolve.FetchConfiguration{}
	}

	var dataSource resolve.DataSource
	providerId := p.eventConfig.GetEngineEventConfiguration().GetProviderId()
	typeName := p.eventConfig.GetEngineEventConfiguration().GetType()
	topics := p.eventConfig.GetTopics()
	pubsub, ok := p.providers[providerId]
	if !ok {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("no pubsub connection exists with provider id \"%s\"", providerId))
		return resolve.FetchConfiguration{}
	}

	switch p.eventConfig.GetEngineEventConfiguration().GetType() {
	case nodev1.EventType_PUBLISH:
		dataSource = &KafkaPublishDataSource{
			pubSub: pubsub,
		}
	default:
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to configure fetch: invalid event type \"%s\" for Kafka", typeName.String()))
		return resolve.FetchConfiguration{}
	}

	if len(topics) != 1 {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("publish and request events should define one subject but received %d", len(topics)))
		return resolve.FetchConfiguration{}
	}

	topic := topics[0]

	event, eventErr := utils.BuildEventDataBytes(p.rootFieldRef, p.visitor, p.variables)
	if eventErr != nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to build event data bytes: %w", eventErr))
		return resolve.FetchConfiguration{}
	}

	evtCfg := PublishEventConfiguration{
		ProviderID: providerId,
		Topic:      topic,
		Data:       event,
	}

	return resolve.FetchConfiguration{
		Input:      evtCfg.MarshalJSONTemplate(),
		Variables:  p.variables,
		DataSource: dataSource,
		PostProcessing: resolve.PostProcessingConfiguration{
			MergePath: []string{p.eventConfig.GetEngineEventConfiguration().GetFieldName()},
		},
	}
}

func (p *Planner) ConfigureSubscription() plan.SubscriptionConfiguration {
	if p.eventConfig == nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to configure subscription: event manager is nil"))
		return plan.SubscriptionConfiguration{}
	}
	providerId := p.eventConfig.GetEngineEventConfiguration().GetProviderId()
	pubsub, ok := p.providers[providerId]
	if !ok {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("no pubsub connection exists with provider id \"%s\"", providerId))
		return plan.SubscriptionConfiguration{}
	}
	evtCfg := SubscriptionEventConfiguration{
		ProviderID: providerId,
		Topics:     p.eventConfig.GetTopics(),
	}
	object, err := json.Marshal(evtCfg)
	if err != nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to marshal event subscription streamConfiguration"))
		return plan.SubscriptionConfiguration{}
	}

	return plan.SubscriptionConfiguration{
		Input:     string(object),
		Variables: p.variables,
		DataSource: &SubscriptionSource{
			pubSub: pubsub,
		},
		PostProcessing: resolve.PostProcessingConfiguration{
			MergePath: []string{p.eventConfig.GetEngineEventConfiguration().GetFieldName()},
		},
	}
}

func (p *Planner) EnterDocument(_, _ *ast.Document) {
	p.rootFieldRef = -1
	p.eventConfig = nil
}

func (p *Planner) EnterField(ref int) {
	if p.rootFieldRef != -1 {
		// This is a nested field; nothing needs to be done
		return
	}
	p.rootFieldRef = ref

	fieldName := p.visitor.Operation.FieldNameString(ref)
	typeName := p.visitor.Walker.EnclosingTypeDefinition.NameString(p.visitor.Definition)

	var eventConfig *nodev1.KafkaEventConfiguration
	for _, cfg := range p.config.EventConfiguration {
		if cfg.GetEngineEventConfiguration().GetTypeName() == typeName && cfg.GetEngineEventConfiguration().GetFieldName() == fieldName {
			eventConfig = cfg
			break
		}
	}

	if eventConfig == nil {
		return
	}

	p.eventConfig = eventConfig

	providerId := eventConfig.GetEngineEventConfiguration().GetProviderId()

	switch eventConfig.GetEngineEventConfiguration().GetType() {
	case nodev1.EventType_PUBLISH:
		if len(p.eventConfig.GetTopics()) != 1 {
			p.visitor.Walker.StopWithInternalErr(fmt.Errorf("publish events should define one subject but received %d", len(p.eventConfig.GetTopics())))
			return
		}
		_, found := p.providers[providerId]
		if !found {
			p.visitor.Walker.StopWithInternalErr(fmt.Errorf("unable to publish events of provider %d", len(p.eventConfig.GetTopics())))
		}
		_ = PublishEventConfiguration{
			ProviderID: providerId,
			Topic:      eventConfig.GetTopics()[0],
			Data:       json.RawMessage("[]"),
		}
		p.config.Logger.Warn("Publishing!")
		// provider.Publish(provider.ctx, pubCfg)
	case nodev1.EventType_SUBSCRIBE:
		p.config.Logger.Warn("Subscribing!")
	default:
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("invalid EventType \"%s\" for Kafka", eventConfig.GetEngineEventConfiguration().GetType()))
	}
}

type Source struct{}

func (s *Source) Load(ctx context.Context, input []byte, out *bytes.Buffer) (err error) {
	_, err = out.Write(input)
	return
}

func (s *Source) LoadWithFiles(ctx context.Context, input []byte, files []*httpclient.FileUpload, out *bytes.Buffer) (err error) {
	panic("not implemented")
}

func NewFactory(executionContext context.Context, config config.EventsConfiguration, providers map[string]*kafkaPubSub) *Factory {
	return &Factory{
		providers:        providers,
		executionContext: executionContext,
		config:           config,
	}
}

type Factory struct {
	providers        map[string]*kafkaPubSub
	executionContext context.Context
	config           config.EventsConfiguration
}

func (f *Factory) Planner(_ abstractlogger.Logger) plan.DataSourcePlanner[Configuration] {
	return &Planner{
		providers: f.providers,
	}
}

func (f *Factory) Context() context.Context {
	return f.executionContext
}

func (f *Factory) UpstreamSchema(dataSourceConfig plan.DataSourceConfiguration[Configuration]) (*ast.Document, bool) {
	return nil, false
}
