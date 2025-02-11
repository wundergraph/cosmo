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
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/kafka"
	"github.com/testcontainers/testcontainers-go/wait"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

var (
	kafkaMux  sync.Mutex
	kafkaData *KafkaData
)

type KafkaData struct {
	Brokers   []string
	Container *kafka.KafkaContainer
}

func setupKafkaServers(t testing.TB) (*KafkaData, error) {
	kafkaMux.Lock()
	defer kafkaMux.Unlock()

	if kafkaData != nil {
		return kafkaData, nil
	}

	kafkaData = &KafkaData{}

	var err error

	ctx := context.Background()
	require.Eventually(t, func() bool {
		// when using Docker Desktop on Mac, it's possible that it takes 2 attempts to get the network port of the container
		// I've debugged this extensively and the issue is not with the testcontainers-go library, but with the Docker Desktop
		// Error message: container logs (port not found)
		// This is an internal issue coming from the Docker pkg
		// It seems like Docker Desktop on Mac is not always capable of providing a port mapping
		// The solution is to retry the container creation until we get the network port
		// Please don't try to improve this code as this workaround allows running the tests without any issues

		kafkaData.Container, err = kafka.Run(ctx, "confluentinc/confluent-local:7.6.1",
			testcontainers.WithWaitStrategyAndDeadline(time.Second*10, wait.ForListeningPort("9093/tcp")),
		)
		return err == nil && kafkaData.Container != nil
	}, time.Second*60, time.Second)

	require.NoError(t, err)
	if err != nil {
		return nil, err
	}

	require.NotNil(t, kafkaData.Container)
	require.NoError(t, kafkaData.Container.Start(ctx))

	kafkaData.Brokers, err = kafkaData.Container.Brokers(ctx)
	require.NoError(t, err)
	if err != nil {
		return nil, err
	}

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
