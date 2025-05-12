package nats

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/nats-io/nats.go"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"
)

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

func transformEventConfig(cfg *nodev1.NatsEventConfiguration, fn datasource.ArgumentTemplateCallback) (*nodev1.NatsEventConfiguration, error) {
	switch v := cfg.GetEngineEventConfiguration().GetType(); v {
	case nodev1.EventType_PUBLISH, nodev1.EventType_REQUEST:
		extractedSubject, err := fn(cfg.GetSubjects()[0])
		if err != nil {
			return cfg, fmt.Errorf("unable to parse subject with id %s", cfg.GetSubjects()[0])
		}
		if !isValidNatsSubject(extractedSubject) {
			return cfg, fmt.Errorf("invalid subject: %s", extractedSubject)
		}
		cfg.Subjects = []string{extractedSubject}
	case nodev1.EventType_SUBSCRIBE:
		extractedSubjects := make([]string, 0, len(cfg.Subjects))
		for _, rawSubject := range cfg.Subjects {
			extractedSubject, err := fn(rawSubject)
			if err != nil {
				return cfg, nil
			}
			if !isValidNatsSubject(extractedSubject) {
				return cfg, fmt.Errorf("invalid subject: %s", extractedSubject)
			}
			extractedSubjects = append(extractedSubjects, extractedSubject)
		}
		slices.Sort(extractedSubjects)
		cfg.Subjects = extractedSubjects
	}
	return cfg, nil
}

type PubSubProvider struct {
	id                 string
	EventConfiguration []*nodev1.NatsEventConfiguration
	Logger             *zap.Logger
	Adapter            AdapterInterface
}

func (c *PubSubProvider) Id() string {
	return c.id
}

func GetProviderDataSources(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) ([]datasource.PubSubProvider, []plan.DataSource, error) {
	providers := make(map[string]AdapterInterface)
	pubSubProviders := []datasource.PubSubProvider{}
	definedProviders := make(map[string]bool)
	for _, provider := range config.Providers.Nats {
		definedProviders[provider.ID] = true
	}
	if natsData := in.GetCustomEvents().GetNats(); natsData != nil {
		// prepare providers and root fields
		usedProviders := make(map[string]bool)
		rootFields := make(map[string][]string)
		for _, event := range natsData {
			providerId := event.EngineEventConfiguration.ProviderId
			if !definedProviders[providerId] {
				return nil, nil, fmt.Errorf("failed to find Nats provider with ID %s", providerId)
			}
			usedProviders[providerId] = true
			typeName := event.GetEngineEventConfiguration().GetTypeName()
			fieldName := event.GetEngineEventConfiguration().GetFieldName()
			if _, ok := rootFields[typeName]; !ok {
				rootFields[typeName] = []string{}
			}
			rootFields[typeName] = append(rootFields[typeName], fieldName)
		}

		// create providers only if they are used
		for _, provider := range config.Providers.Nats {
			if !usedProviders[provider.ID] {
				continue
			}
			options, err := buildNatsOptions(provider, logger)
			if err != nil {
				return nil, nil, fmt.Errorf("failed to build options for Nats provider with ID \"%s\": %w", provider.ID, err)
			}
			adapter, err := NewAdapter(ctx, logger, provider.URL, options, hostName, routerListenAddr)
			if err != nil {
				return nil, nil, fmt.Errorf("failed to create adapter for Nats provider with ID \"%s\": %w", provider.ID, err)
			}
			providers[provider.ID] = adapter
			pubSubProvider := &PubSubProvider{
				id:      provider.ID,
				Adapter: adapter,
			}
			pubSubProviders = append(pubSubProviders, pubSubProvider)
		}

		// create data sources
		ds := &PubSubDataSource{
			EventConfigurations: natsData,
			NatsAdapters:        providers,
		}
		// filter dsMeta.RootNodes
		newRootNodes := []plan.TypeField{}
		for _, node := range dsMeta.RootNodes {
			newRootNode := plan.TypeField{
				TypeName:           node.TypeName,
				FieldNames:         []string{},
				ExternalFieldNames: node.ExternalFieldNames,
			}
			for _, fieldName := range node.FieldNames {
				if slices.Contains(rootFields[node.TypeName], fieldName) {
					newRootNode.FieldNames = append(newRootNode.FieldNames, fieldName)
				}
			}
			newRootNodes = append(newRootNodes, newRootNode)
		}
		newDsMets := *dsMeta
		newDsMets.RootNodes = newRootNodes

		out, err := plan.NewDataSourceConfiguration(
			in.Id+"-nats",
			datasource.NewFactory(ctx, datasource.PubSubDataSource(ds)),
			&newDsMets,
			datasource.PubSubDataSource(ds),
		)
		if err != nil {
			return nil, nil, err
		}

		return pubSubProviders, []plan.DataSource{out}, nil
	}

	return nil, nil, nil
}

func GetProvider(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) ([]datasource.PubSubProvider, []plan.DataSource, error) {
	return GetProviderDataSources(ctx, in, dsMeta, config, logger, hostName, routerListenAddr)
}

func (c *PubSubProvider) Startup(ctx context.Context) error {
	return c.Adapter.Startup(ctx)
}

func (c *PubSubProvider) Shutdown(ctx context.Context) error {
	return c.Adapter.Shutdown(ctx)
}
