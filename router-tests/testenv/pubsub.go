package testenv

import (
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/ory/dockertest/v3"
	"github.com/twmb/franz-go/pkg/kgo"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

type KafkaData struct {
	Client   *kgo.Client
	Brokers  []string
	Resource *dockertest.Resource
}

type NatsData struct {
	Connections []*nats.Conn
}

func setupNatsClients(t testing.TB) (*NatsData, error) {
	natsData := &NatsData{}
	for range demoNatsProviders {
		natsConnection, err := nats.Connect(
			"nats://localhost:4222",
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
		}
	}
}
