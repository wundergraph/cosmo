package nats

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/jensneuse/abstractlogger"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/utils"
	"go.uber.org/zap"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/argument_templates"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

const (
	fwc  = '>'
	tsep = "."
)

// A variable template has form $$number$$ where the number can range from one to multiple digits
var (
	variableTemplateRegex = regexp.MustCompile(`\$\$\d+\$\$`)
)

func GetDataSource(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger) (plan.DataSource, error) {
	if natsData := in.GetCustomEvents().GetNats(); natsData != nil {
		k := NewPubSub(logger)
		err := k.PrepareProviders(ctx, in, dsMeta, config)
		if err != nil {
			return nil, err
		}
		factory := k.GetFactory(ctx, config, k.providers)
		ds, err := plan.NewDataSourceConfiguration[Configuration](
			in.Id,
			factory,
			dsMeta,
			Configuration{
				EventConfiguration: natsData,
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

func buildNatsOptions(eventSource config.NatsEventSource, logger *zap.Logger) ([]nats.Option, error) {
	opts := []nats.Option{
		nats.Name(fmt.Sprintf("cosmo.router.edfs.nats.%s", eventSource.ID)),
		nats.ReconnectJitter(500*time.Millisecond, 2*time.Second),
		nats.ClosedHandler(func(conn *nats.Conn) {
			logger.Info("NATS connection closed", zap.String("provider_id", eventSource.ID), zap.Error(conn.LastError()))
		}),
		nats.ConnectHandler(func(nc *nats.Conn) {
			logger.Info("NATS connection established", zap.String("provider_id", eventSource.ID), zap.String("url", nc.ConnectedUrlRedacted()))
		}),
		nats.DisconnectErrHandler(func(nc *nats.Conn, err error) {
			if err != nil {
				logger.Error("NATS disconnected; will attempt to reconnect", zap.Error(err), zap.String("provider_id", eventSource.ID))
			} else {
				logger.Info("NATS disconnected", zap.String("provider_id", eventSource.ID))
			}
		}),
		nats.ErrorHandler(func(conn *nats.Conn, subscription *nats.Subscription, err error) {
			if errors.Is(err, nats.ErrSlowConsumer) {
				logger.Warn(
					"NATS slow consumer detected. Events are being dropped. Please consider increasing the buffer size or reducing the number of messages being sent.",
					zap.Error(err),
					zap.String("provider_id", eventSource.ID),
				)
			} else {
				logger.Error("NATS error", zap.Error(err))
			}
		}),
		nats.ReconnectHandler(func(conn *nats.Conn) {
			logger.Info("NATS reconnected", zap.String("provider_id", eventSource.ID), zap.String("url", conn.ConnectedUrlRedacted()))
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

type Nats struct {
	providers        map[string]*NatsPubSub
	logger           *zap.Logger
	hostName         string // How to get it here?
	routerListenAddr string // How to get it here?
}

func (n *Nats) PrepareProviders(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration) error {
	definedProviders := make(map[string]bool)
	for _, provider := range config.Providers.Nats {
		definedProviders[provider.ID] = true
	}
	usedProviders := make(map[string]bool)
	for _, event := range in.CustomEvents.GetNats() {
		if _, found := definedProviders[event.EngineEventConfiguration.ProviderId]; !found {
			return fmt.Errorf("failed to find Nats provider with ID %s", event.EngineEventConfiguration.ProviderId)
		}
		usedProviders[event.EngineEventConfiguration.ProviderId] = true
	}
	n.providers = map[string]*NatsPubSub{}
	for _, provider := range config.Providers.Nats {
		if !usedProviders[provider.ID] {
			continue
		}
		options, err := buildNatsOptions(provider, n.logger)
		if err != nil {
			return fmt.Errorf("failed to build options for Nats provider with ID \"%s\": %w", provider.ID, err)
		}
		natsConnection, err := nats.Connect(provider.URL, options...)
		if err != nil {
			return fmt.Errorf("failed to create connection for Nats provider with ID \"%s\": %w", provider.ID, err)
		}
		js, err := jetstream.New(natsConnection)
		if err != nil {
			return err
		}

		n.providers[provider.ID] = NewConnector(n.logger, natsConnection, js, n.hostName, n.routerListenAddr).New(ctx)
	}
	return nil
}

func (n *Nats) GetFactory(executionContext context.Context, config config.EventsConfiguration, providers map[string]*NatsPubSub) *Factory {
	return NewFactory(executionContext, config, providers)
}

func NewPubSub(logger *zap.Logger) Nats {
	return Nats{
		logger: logger,
	}
}

type Configuration struct {
	Data               string `json:"data"`
	EventConfiguration []*nodev1.NatsEventConfiguration
	Logger             *zap.Logger
}

type Planner struct {
	id              int
	config          Configuration
	providers       map[string]*NatsPubSub
	rootFieldRef    int
	variables       resolve.Variables
	visitor         *plan.Visitor
	eventConfig     *nodev1.NatsEventConfiguration
	publishConfig   *PublishAndRequestEventConfiguration
	requestConfig   *PublishAndRequestEventConfiguration
	subscribeConfig *SubscriptionEventConfiguration
}

func (p *Planner) addContextVariableByArgumentRef(argumentRef int, argumentPath []string) (string, error) {
	variablePath, err := p.visitor.Operation.VariablePathByArgumentRefAndArgumentPath(argumentRef, argumentPath, p.visitor.Walker.Ancestors[0].Ref)
	if err != nil {
		return "", err
	}
	/* The definition is passed as both definition and operation below because getJSONRootType resolves the type
	 * from the first argument, but finalInputValueTypeRef comes from the definition
	 */
	contextVariable := &resolve.ContextVariable{
		Path:     variablePath,
		Renderer: resolve.NewPlainVariableRenderer(),
	}
	variablePlaceHolder, _ := p.variables.AddVariable(contextVariable)
	return variablePlaceHolder, nil
}

func (p *Planner) extractEventSubject(fieldRef int, subject string) (string, error) {
	matches := argument_templates.ArgumentTemplateRegex.FindAllStringSubmatch(subject, -1)
	// If no argument templates are defined, there are only static values
	if len(matches) < 1 {
		if isValidNatsSubject(subject) {
			return subject, nil
		}
		return "", fmt.Errorf(`subject "%s" is not a valid NATS subject`, subject)
	}
	fieldNameBytes := p.visitor.Operation.FieldNameBytes(fieldRef)
	// TODO: handling for interfaces and unions
	fieldDefinitionRef, ok := p.visitor.Definition.ObjectTypeDefinitionFieldWithName(p.visitor.Walker.EnclosingTypeDefinition.Ref, fieldNameBytes)
	if !ok {
		return "", fmt.Errorf(`expected field definition to exist for field "%s"`, fieldNameBytes)
	}
	subjectWithVariableTemplateReplacements := subject
	for templateNumber, groups := range matches {
		// The first group is the whole template; the second is the period delimited argument path
		if len(groups) != 2 {
			return "", fmt.Errorf(`argument template #%d defined on field "%s" is invalid: expected 2 matching groups but received %d`, templateNumber+1, fieldNameBytes, len(groups)-1)
		}
		validationResult, err := argument_templates.ValidateArgumentPath(p.visitor.Definition, groups[1], fieldDefinitionRef)
		if err != nil {
			return "", fmt.Errorf(`argument template #%d defined on field "%s" is invalid: %w`, templateNumber+1, fieldNameBytes, err)
		}
		argumentNameBytes := []byte(validationResult.ArgumentPath[0])
		argumentRef, ok := p.visitor.Operation.FieldArgument(fieldRef, argumentNameBytes)
		if !ok {
			return "", fmt.Errorf(`operation field "%s" does not define argument "%s"`, fieldNameBytes, argumentNameBytes)
		}
		// variablePlaceholder has the form $$0$$, $$1$$, etc.
		variablePlaceholder, err := p.addContextVariableByArgumentRef(argumentRef, validationResult.ArgumentPath)
		if err != nil {
			return "", fmt.Errorf(`failed to retrieve variable placeholder for argument ""%s" defined on operation field "%s": %w`, argumentNameBytes, fieldNameBytes, err)
		}
		// Replace the template literal with the variable placeholder (and reuse the variable if it already exists)
		subjectWithVariableTemplateReplacements = strings.ReplaceAll(subjectWithVariableTemplateReplacements, groups[0], variablePlaceholder)
	}
	// Substitute the variable templates for dummy values to check naïvely that the string is a valid NATS subject
	if isValidNatsSubject(variableTemplateRegex.ReplaceAllLiteralString(subjectWithVariableTemplateReplacements, "a")) {
		return subjectWithVariableTemplateReplacements, nil
	}
	return "", fmt.Errorf(`subject "%s" is not a valid NATS subject`, subject)
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
	var evtCfg PublishEventConfiguration
	var dataSource resolve.DataSource

	event, eventErr := utils.BuildEventDataBytes(p.rootFieldRef, p.visitor, &p.variables)
	if eventErr != nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to build event data bytes: %w", eventErr))
		return resolve.FetchConfiguration{}
	}

	if p.publishConfig != nil {
		pubsub, ok := p.providers[p.publishConfig.ProviderID]
		if !ok {
			p.visitor.Walker.StopWithInternalErr(fmt.Errorf("no pubsub connection exists with provider id \"%s\"", p.subscribeConfig.ProviderID))
			return resolve.FetchConfiguration{}
		}
		evtCfg = PublishEventConfiguration{
			ProviderID: p.publishConfig.ProviderID,
			Subject:    p.publishConfig.Subject,
			Data:       event,
		}
		dataSource = &NatsPublishDataSource{
			pubSub: pubsub,
		}
	} else if p.requestConfig != nil {
		pubsub, ok := p.providers[p.requestConfig.ProviderID]
		if !ok {
			p.visitor.Walker.StopWithInternalErr(fmt.Errorf("no pubsub connection exists with provider id \"%s\"", p.requestConfig.ProviderID))
			return resolve.FetchConfiguration{}
		}
		dataSource = &NatsRequestDataSource{
			pubSub: pubsub,
		}
		evtCfg = PublishEventConfiguration{
			ProviderID: p.requestConfig.ProviderID,
			Subject:    p.requestConfig.Subject,
			Data:       event,
		}
	} else {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to configure fetch: event config is nil"))
		return resolve.FetchConfiguration{}
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
	if p.subscribeConfig == nil {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("failed to configure subscription: event manager is nil"))
		return plan.SubscriptionConfiguration{}
	}
	pubsub, ok := p.providers[p.subscribeConfig.ProviderID]
	if !ok {
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("no pubsub connection exists with provider id \"%s\"", p.subscribeConfig.ProviderID))
		return plan.SubscriptionConfiguration{}
	}
	evtCfg := SubscriptionEventConfiguration{
		ProviderID:          p.subscribeConfig.ProviderID,
		Subjects:            p.subscribeConfig.Subjects,
		StreamConfiguration: p.subscribeConfig.StreamConfiguration,
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

	var eventConfig *nodev1.NatsEventConfiguration
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

	switch v := eventConfig.GetEngineEventConfiguration().GetType(); v {
	case nodev1.EventType_PUBLISH, nodev1.EventType_REQUEST:
		if len(p.eventConfig.GetSubjects()) != 1 {
			p.visitor.Walker.StopWithInternalErr(fmt.Errorf("publish events should define one subject but received %d", len(p.eventConfig.GetSubjects())))
			return
		}
		_, found := p.providers[providerId]
		if !found {
			p.visitor.Walker.StopWithInternalErr(fmt.Errorf("unable to publish events of provider with id %s", providerId))
		}
		extractedSubject, err := p.extractEventSubject(ref, eventConfig.GetSubjects()[0])
		if err != nil {
			p.visitor.Walker.StopWithInternalErr(fmt.Errorf("unable to parse subject with id %s", eventConfig.GetSubjects()[0]))
		}
		cfg := &PublishAndRequestEventConfiguration{
			ProviderID: providerId,
			Subject:    extractedSubject,
			Data:       json.RawMessage("[]"),
		}
		if v == nodev1.EventType_REQUEST {
			p.requestConfig = cfg
		} else {
			p.publishConfig = cfg
		}
	case nodev1.EventType_SUBSCRIBE:
		if len(p.eventConfig.Subjects) == 0 {
			p.visitor.Walker.StopWithInternalErr(fmt.Errorf("expected at least one subscription subject but received %d", len(p.eventConfig.Subjects)))
			return
		}
		extractedSubjects := make([]string, 0, len(p.eventConfig.Subjects))
		for _, rawSubject := range p.eventConfig.Subjects {
			extractedSubject, err := p.extractEventSubject(ref, rawSubject)
			if err != nil {
				p.visitor.Walker.StopWithInternalErr(fmt.Errorf("could not extract subscription event subjects: %w", err))
				return
			}
			extractedSubjects = append(extractedSubjects, extractedSubject)
		}
		var streamConf *StreamConfiguration
		if p.eventConfig.StreamConfiguration != nil {
			streamConf = &StreamConfiguration{}
			streamConf.Consumer = p.eventConfig.StreamConfiguration.ConsumerName
			streamConf.ConsumerInactiveThreshold = p.eventConfig.StreamConfiguration.ConsumerInactiveThreshold
			streamConf.StreamName = p.eventConfig.StreamConfiguration.StreamName
		}

		slices.Sort(extractedSubjects)
		p.subscribeConfig = &SubscriptionEventConfiguration{
			ProviderID:          providerId,
			Subjects:            extractedSubjects,
			StreamConfiguration: streamConf,
		}
	default:
		p.visitor.Walker.StopWithInternalErr(fmt.Errorf("invalid EventType \"%s\" for Kafka", eventConfig.GetEngineEventConfiguration().GetType()))
	}
}

type Source struct{}

func (Source) Load(ctx context.Context, input []byte, out *bytes.Buffer) (err error) {
	_, err = out.Write(input)
	return
}

func (Source) LoadWithFiles(ctx context.Context, input []byte, files []*httpclient.FileUpload, out *bytes.Buffer) (err error) {
	panic("not implemented")
}

func NewFactory(executionContext context.Context, config config.EventsConfiguration, providers map[string]*NatsPubSub) *Factory {
	return &Factory{
		executionContext:    executionContext,
		eventsConfiguration: config,
		providers:           providers,
	}
}

type Factory struct {
	config              Configuration
	eventsConfiguration config.EventsConfiguration
	executionContext    context.Context
	providers           map[string]*NatsPubSub
}

func (f *Factory) Planner(_ abstractlogger.Logger) plan.DataSourcePlanner[Configuration] {
	return &Planner{
		config:    f.config,
		providers: f.providers,
	}
}

func (f *Factory) Context() context.Context {
	return f.executionContext
}

func (f *Factory) UpstreamSchema(dataSourceConfig plan.DataSourceConfiguration[Configuration]) (*ast.Document, bool) {
	return nil, false
}

func isValidNatsSubject(subject string) bool {
	if subject == "" {
		return false
	}
	sfwc := false
	tokens := strings.Split(subject, tsep)
	for _, t := range tokens {
		length := len(t)
		if length == 0 || sfwc {
			return false
		}
		if length > 1 {
			if strings.ContainsAny(t, "\t\n\f\r ") {
				return false
			}
			continue
		}
		switch t[0] {
		case fwc:
			sfwc = true
		case ' ', '\t', '\n', '\r', '\f':
			return false
		}
	}
	return true
}
