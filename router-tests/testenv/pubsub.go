package testenv

import (
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

type NatsParams struct {
	Opts []nats.Option
	Url  string
}

type NatsData struct {
	Connections []*nats.Conn
	Params      []*NatsParams
}

func setupNatsClients(t testing.TB) (*NatsData, error) {
	natsData := &NatsData{}
	for range DemoNatsProviders {
		param := &NatsParams{
			Url: nats.DefaultURL,
			Opts: []nats.Option{
				nats.MaxReconnects(10),
				nats.ReconnectWait(1 * time.Second),
				nats.Timeout(5 * time.Second),
				nats.ErrorHandler(func(conn *nats.Conn, subscription *nats.Subscription, err error) {
					t.Log(err)
				}),
			},
		}
		natsConnection, err := nats.Connect(
			nats.DefaultURL,
			nats.MaxReconnects(10),
			nats.ReconnectWait(1*time.Second),
			nats.Timeout(10*time.Second),
			nats.ErrorHandler(func(conn *nats.Conn, subscription *nats.Subscription, err error) {
				t.Log(err)
			}),
		)
		if err != nil {
			return nil, err
		}

		natsData.Params = append(natsData.Params, param)
		natsData.Connections = append(natsData.Connections, natsConnection)
	}
	return natsData, nil
}

func addPubSubPrefixToEngineConfiguration(engineConfig *nodev1.EngineConfiguration, getPubSubName func(string) string) {
	for _, datasource := range engineConfig.DatasourceConfigurations {
		if customEvents := datasource.CustomEvents; customEvents != nil {
			for natConfig := range customEvents.Nats {
				var prefixedSubjects []string
				for _, subject := range customEvents.Nats[natConfig].Subjects {
					prefixedSubjects = append(prefixedSubjects, getPubSubName(subject))
				}
				customEvents.Nats[natConfig].Subjects = prefixedSubjects

				if customEvents.Nats[natConfig].StreamConfiguration != nil {
					if customEvents.Nats[natConfig].StreamConfiguration.StreamName != "" {
						customEvents.Nats[natConfig].StreamConfiguration.StreamName = getPubSubName(customEvents.Nats[natConfig].StreamConfiguration.StreamName)
					}
					if customEvents.Nats[natConfig].StreamConfiguration.ConsumerName != "" {
						customEvents.Nats[natConfig].StreamConfiguration.ConsumerName = getPubSubName(customEvents.Nats[natConfig].StreamConfiguration.ConsumerName)
					}
				}
			}
			for kafkaConfig := range customEvents.Kafka {
				var prefixedTopics []string
				for _, subject := range customEvents.Kafka[kafkaConfig].Topics {
					prefixedTopics = append(prefixedTopics, getPubSubName(subject))
				}
				customEvents.Kafka[kafkaConfig].Topics = prefixedTopics
			}
			for redisConfig := range customEvents.Redis {
				var prefixedChannels []string
				for _, channel := range customEvents.Redis[redisConfig].Channels {
					prefixedChannels = append(prefixedChannels, getPubSubName(channel))
				}
				customEvents.Redis[redisConfig].Channels = prefixedChannels
			}
		}
	}
}
