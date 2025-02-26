package testenv

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
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
	"github.com/twmb/franz-go/pkg/kgo"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

type KafkaData struct {
	Client   *kgo.Client
	Brokers  []string
	Resource *dockertest.Resource
}

var (
	kafkaMux       sync.Mutex
	kafkaRefs      int32
	kafkaData      *KafkaData
	kafkaContainer *dockertest.Resource
)

func getHostPort(resource *dockertest.Resource, id string) string {
	dockerURL := os.Getenv("DOCKER_HOST")
	if dockerURL == "" {
		return resource.GetHostPort(id)
	}
	u, err := url.Parse(dockerURL)
	if err != nil {
		panic(err)
	}
	return u.Hostname() + ":" + resource.GetPort(id)
}

func setupKafkaServer(t testing.TB) (*KafkaData, error) {
	kafkaMux.Lock()
	defer kafkaMux.Unlock()

	kafkaRefs += 1
	t.Logf("Adds kafka: %d", kafkaRefs)

	t.Cleanup(func() {
		kafkaMux.Lock()
		defer kafkaMux.Unlock()

		if kafkaRefs > 1 {
			kafkaRefs -= 1
			t.Logf("Removes kafka: %d", kafkaRefs)
		} else {
			if err := kafkaContainer.Close(); err != nil {
				t.Fatalf("could not purge kafka container: %s", err.Error())
			}
			t.Logf("Cleans kafka: %d", kafkaRefs)
			// This shouldn't be needed, but just in case
			kafkaData = nil
			kafkaContainer = nil
			kafkaRefs = 0
		}
	})

	if kafkaData != nil {
		return kafkaData, nil
	}

	kafkaData = &KafkaData{}

	pool, err := dockertest.NewPool("")
	if err != nil {
		return nil, err
	}

	if err := pool.Client.Ping(); err != nil {
		return nil, err
	}

	port := freeport.GetOne(t)

	container, err := pool.RunWithOptions(&dockertest.RunOptions{
		Repository: "bitnami/kafka",
		Tag:        "3.7.0",
		PortBindings: map[docker.Port][]docker.PortBinding{
			"9092/tcp": {docker.PortBinding{HostIP: "localhost", HostPort: strconv.Itoa(port)}},
		},
		Env: []string{
			"KAFKA_ENABLE_KRAFT=yes",
			"KAFKA_CFG_PROCESS_ROLES=controller,broker",
			"KAFKA_CFG_CONTROLLER_LISTENER_NAMES=CONTROLLER",
			"KAFKA_CFG_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093",
			"KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT",
			"KAFKA_CFG_CONTROLLER_QUORUM_VOTERS=1@localhost:9093",
			"KAFKA_CFG_TRANSACTION_PARTITION_VERIFICATION_ENABLE=false",
			fmt.Sprintf("KAFKA_CFG_ADVERTISED_LISTENERS=PLAINTEXT://localhost:%d", port),
			"KAFKA_CFG_NODE_ID=1",
			"ALLOW_PLAINTEXT_LISTENER=yes",
			"KAFKA_KRAFT_CLUSTER_ID=XkpGZQ27R3eTl3OdTm2LYA",
		},
	})
	if err != nil {
		return nil, err
	}

	client, err := kgo.NewClient(
		kgo.SeedBrokers(getHostPort(container, "9092/tcp")),
	)
	if err != nil {
		return nil, err
	}

	err = pool.Retry(func() error {
		return client.Ping(context.Background())
	})
	if err != nil {
		t.Fatalf("could not ping kafka: %s", err.Error())
	}

	kafkaData.Client = client
	kafkaData.Brokers = []string{getHostPort(container, "9092/tcp")}
	kafkaContainer = container

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
