package testenv

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/hashicorp/consul/sdk/freeport"
	natsserver "github.com/nats-io/nats-server/v2/server"
	natstest "github.com/nats-io/nats-server/v2/test"
	"github.com/nats-io/nats.go"
	"github.com/ory/dockertest/v3"
	"github.com/ory/dockertest/v3/docker"
	"github.com/stretchr/testify/require"
	"github.com/twmb/franz-go/pkg/kgo"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

var (
	kafkaMux  sync.Mutex
	kafkaData *KafkaData
)

type KafkaData struct {
	Brokers []string
}

func setupKafkaServers(t testing.TB) (*KafkaData, error) {
	kafkaMux.Lock()
	defer kafkaMux.Unlock()

	if kafkaData != nil {
		return kafkaData, nil
	}

	kafkaData = &KafkaData{}

	kafkaPort := freeport.GetOne(t)
	kafkaPortDocker := fmt.Sprintf("%d/tcp", kafkaPort)

	dockerPool, err := dockertest.NewPool("")
	require.NoError(t, err, "could not connect to docker")
	require.NoError(t, dockerPool.Client.Ping(), "could not ping docker")

	kafkaResource, err := dockerPool.RunWithOptions(&dockertest.RunOptions{
		Repository: "confluentinc/confluent-local",
		Tag:        "7.5.0",
		PortBindings: map[docker.Port][]docker.PortBinding{
			"9092/tcp": {{HostIP: "localhost", HostPort: kafkaPortDocker}},
		},
		ExposedPorts: []string{"9092/tcp"},
		Hostname:     "broker",
		Env: []string{
			"KAFKA_BROKER_ID=1",
			"KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT,CONTROLLER:PLAINTEXT",
			"KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://broker:29092,PLAINTEXT_HOST://localhost:9092",
			"KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1",
			"KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0",
			"KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1",
			"KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1",
			"KAFKA_PROCESS_ROLES=broker,controller",
			"KAFKA_NODE_ID=1",
			"KAFKA_CONTROLLER_QUORUM_VOTERS=1@broker:29093",
			"KAFKA_LISTENERS=PLAINTEXT://broker:29092,CONTROLLER://broker:29093,PLAINTEXT_HOST://0.0.0.0:9092",
			"KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT",
			"KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER",
		},
	})

	require.NoError(t, err, "could not start kafka")

	t.Cleanup(func() {
		err := dockerPool.Purge(kafkaResource)
		if err != nil {
			panic(fmt.Errorf("could not purge kafka container, %w", err))
		}
	})

	kafkaData.Brokers = []string{fmt.Sprintf("localhost:%d", kafkaPort)}

	t.Logf("kafka has brokers: %v", kafkaData.Brokers)

	client, err := kgo.NewClient(
		kgo.SeedBrokers(kafkaData.Brokers...),
	)
	require.NoError(t, err, "could not create kafka client")

	require.Eventually(t, func() bool {
		err := client.Ping(context.Background())
		if err != nil {
			t.Logf("could not ping kafka: %s", err)
			return false
		}

		t.Logf("kafka is up")

		return true
	}, 60*time.Second, time.Second)

	return kafkaData, nil
}

var (
	natsMux    sync.Mutex
	natsServer *natsserver.Server
)

type NatsData struct {
	Connections []*nats.Conn
	Server      *natsserver.Server
}

func setupNatsData(t testing.TB) (*NatsData, error) {
	natsData := &NatsData{
		Server: natsServer,
	}
	natsData.Server = natsServer
	for range demoNatsProviders {
		natsConnection, err := nats.Connect(
			natsData.Server.ClientURL(),
			nats.MaxReconnects(10),
			nats.ReconnectWait(1*time.Second),
			nats.Timeout(5*time.Second),
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

func setupNatsServers(t testing.TB) (*NatsData, error) {
	natsMux.Lock()
	defer natsMux.Unlock()

	if natsServer != nil {
		return setupNatsData(t)
	}

	// get free port for nats and never frees it!
	// don't use Get!
	natsPorts, natsPortsErr := freeport.Take(1)
	if natsPortsErr != nil {
		t.Fatalf("could not get free port for nats: %s", natsPortsErr.Error())
	}
	natsPort := natsPorts[0]

	// create dir in tmp for nats server
	natsDir := filepath.Join(os.TempDir(), fmt.Sprintf("nats-%s", uuid.New()))
	err := os.MkdirAll(natsDir, os.ModePerm)
	if err != nil {
		t.Fatalf("could not create nats dir: %s", err)
	}

	//t.Cleanup(func() {
	//	err := os.RemoveAll(natsDir)
	//	if err != nil {
	//		panic(fmt.Errorf("could not remove temporary nats directory, %w", err))
	//	}
	//})

	opts := natsserver.Options{
		Host:      "localhost",
		NoLog:     true,
		NoSigs:    true,
		JetStream: true,
		Port:      natsPort,
		StoreDir:  natsDir,
	}

	natsServer = natstest.RunServer(&opts)
	if natsServer == nil {
		t.Fatalf("could not start NATS test server")
	}

	return setupNatsData(t)
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
