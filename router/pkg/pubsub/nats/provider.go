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

const providerId = "nats"

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

func BuildProvidersAndDataSources(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) ([]datasource.PubSubProvider, []plan.DataSource, error) {
	natsData := make([]datasource.EngineEventConfiguration, 0, len(in.GetCustomEvents().GetNats()))
	for _, natsEvent := range in.GetCustomEvents().GetNats() {
		natsData = append(natsData, natsEvent)
	}
	providerBuilder := &PubSubProviderBuilder{
		ctx:              ctx,
		config:           config,
		logger:           logger,
		hostName:         hostName,
		routerListenAddr: routerListenAddr,
	}
	return datasource.BuildProvidersAndDataSources(providerBuilder, ctx, in, dsMeta, config, logger, hostName, routerListenAddr, natsData)
}

type PubSubProvider struct {
	id      string
	Adapter AdapterInterface
	Logger  *zap.Logger
}

func (c *PubSubProvider) ID() string {
	return c.id
}

func (c *PubSubProvider) Startup(ctx context.Context) error {
	return c.Adapter.Startup(ctx)
}

func (c *PubSubProvider) Shutdown(ctx context.Context) error {
	return c.Adapter.Shutdown(ctx)
}
