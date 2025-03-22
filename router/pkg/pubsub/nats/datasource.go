package nats

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"

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
		ds, err := plan.NewDataSourceConfiguration[datasource.Implementer[*nodev1.NatsEventConfiguration, *NatsPubSub]](
			in.Id,
			factory,
			dsMeta,
			&Configuration{
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

func (n *Nats) GetFactory(executionContext context.Context, config config.EventsConfiguration, providers map[string]*NatsPubSub) *datasource.Factory[*nodev1.NatsEventConfiguration, *NatsPubSub] {
	return datasource.NewFactory[*nodev1.NatsEventConfiguration](executionContext, config, n.providers)
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
	requestConfig      *PublishAndRequestEventConfiguration
	publishConfig      *PublishAndRequestEventConfiguration
	subscribeConfig    *SubscriptionEventConfiguration
}

func (c *Configuration) GetEventsDataConfigurations() []*nodev1.NatsEventConfiguration {
	return c.EventConfiguration
}

func (c *Configuration) GetResolveDataSource(eventConfig *nodev1.NatsEventConfiguration, pubsub *NatsPubSub) (resolve.DataSource, error) {
	var dataSource resolve.DataSource

	typeName := eventConfig.GetEngineEventConfiguration().GetType()
	switch typeName {
	case nodev1.EventType_PUBLISH, nodev1.EventType_REQUEST:
		dataSource = &NatsPublishDataSource{
			pubSub: pubsub,
		}
	default:
		return nil, fmt.Errorf("failed to configure fetch: invalid event type \"%s\" for Nats", typeName.String())
	}

	return dataSource, nil
}

func (c *Configuration) GetResolveDataSourceSubscription(eventConfig *nodev1.NatsEventConfiguration, pubsub *NatsPubSub) (resolve.SubscriptionDataSource, error) {
	return &SubscriptionSource{
		pubSub: pubsub,
	}, nil
}

func (c *Configuration) GetResolveDataSourceSubscriptionInput(eventConfig *nodev1.NatsEventConfiguration, pubsub *NatsPubSub) (string, error) {
	providerId := c.GetProviderId(eventConfig)

	evtCfg := SubscriptionEventConfiguration{
		ProviderID: providerId,
		Subjects:   eventConfig.GetSubjects(),
	}
	if eventConfig.StreamConfiguration != nil {
		evtCfg.StreamConfiguration = &StreamConfiguration{
			Consumer:                  eventConfig.StreamConfiguration.ConsumerName,
			StreamName:                eventConfig.StreamConfiguration.StreamName,
			ConsumerInactiveThreshold: eventConfig.StreamConfiguration.ConsumerInactiveThreshold,
		}
	}
	object, err := json.Marshal(evtCfg)
	if err != nil {
		return "", fmt.Errorf("failed to marshal event subscription streamConfiguration")
	}
	return string(object), nil
}

func (c *Configuration) GetResolveDataSourceInput(eventConfig *nodev1.NatsEventConfiguration, event []byte) (string, error) {
	subjects := eventConfig.GetSubjects()

	if len(subjects) != 1 {
		return "", fmt.Errorf("publish and request events should define one subject but received %d", len(subjects))
	}

	subject := subjects[0]

	providerId := c.GetProviderId(eventConfig)

	evtCfg := PublishEventConfiguration{
		ProviderID: providerId,
		Subject:    subject,
		Data:       event,
	}

	return evtCfg.MarshalJSONTemplate(), nil
}

func (c *Configuration) GetProviderId(eventConfig *nodev1.NatsEventConfiguration) string {
	return eventConfig.GetEngineEventConfiguration().GetProviderId()
}

func (c *Configuration) transformEventConfig(cfg *nodev1.NatsEventConfiguration, fn datasource.ArgumentTemplateCallback) (*nodev1.NatsEventConfiguration, error) {
	switch v := cfg.GetEngineEventConfiguration().GetType(); v {
	case nodev1.EventType_PUBLISH, nodev1.EventType_REQUEST:
		extractedSubject, err := fn(cfg.GetSubjects()[0])
		if err != nil {
			return cfg, fmt.Errorf("unable to parse subject with id %s", cfg.GetSubjects()[0])
		}
		cfg.Subjects = []string{extractedSubject}
	case nodev1.EventType_SUBSCRIBE:
		extractedSubjects := make([]string, 0, len(cfg.Subjects))
		for _, rawSubject := range cfg.Subjects {
			extractedSubject, err := fn(rawSubject)
			if err != nil {
				return cfg, nil
			}
			extractedSubjects = append(extractedSubjects, extractedSubject)
		}
		slices.Sort(extractedSubjects)
		cfg.Subjects = extractedSubjects
	}
	return cfg, nil
}

func (c *Configuration) FindEventConfig(eventConfigs []*nodev1.NatsEventConfiguration, typeName string, fieldName string, fn datasource.ArgumentTemplateCallback) (*nodev1.NatsEventConfiguration, error) {
	for _, cfg := range eventConfigs {
		if cfg.GetEngineEventConfiguration().GetTypeName() == typeName && cfg.GetEngineEventConfiguration().GetFieldName() == fieldName {
			return c.transformEventConfig(cfg, fn)
		}
	}
	return nil, fmt.Errorf("failed to find event config for type name \"%s\" and field name \"%s\"", typeName, fieldName)
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
