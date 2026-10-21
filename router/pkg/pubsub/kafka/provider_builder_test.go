package kafka

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap/zaptest"
)

func TestBuildKafkaOptions(t *testing.T) {
	t.Run("basic configuration", func(t *testing.T) {
		cfg := config.KafkaEventSource{
			Brokers: []string{"localhost:9092"},
		}

		opts, err := buildKafkaOptions(cfg, zaptest.NewLogger(t))
		require.NoError(t, err)
		require.NotEmpty(t, opts)
	})

	t.Run("with TLS", func(t *testing.T) {
		cfg := config.KafkaEventSource{
			Brokers: []string{"localhost:9092"},
			TLS: &config.KafkaTLSConfiguration{
				Enabled: true,
			},
		}

		opts, err := buildKafkaOptions(cfg, zaptest.NewLogger(t))
		require.NoError(t, err)
		require.NotEmpty(t, opts)
		// Can't directly check for TLS options, but we can verify more options are present
		require.Equal(t, len(opts), 5)
	})

	t.Run("with sasl plain auth", func(t *testing.T) {
		username := "user"
		password := "pass"
		cfg := config.KafkaEventSource{
			Brokers: []string{"localhost:9092"},
			Authentication: &config.KafkaAuthentication{
				SASLPlain: config.KafkaSASLPlainAuthentication{
					Username: &username,
					Password: &password,
				},
			},
		}

		opts, err := buildKafkaOptions(cfg, zaptest.NewLogger(t))
		require.NoError(t, err)
		require.NotEmpty(t, opts)
		// Can't directly check for SASL options, but we can verify more options are present
		require.Greater(t, len(opts), 1)
	})

	t.Run("with sasl scram auth", func(t *testing.T) {
		username := "user"
		password := "pass"
		cfg := config.KafkaEventSource{
			Brokers: []string{"localhost:9092"},
			Authentication: &config.KafkaAuthentication{
				SASLSCRAM: config.KafkaSASLSCRAMAuthentication{
					Username: &username,
					Password: &password,
				},
			},
		}

		opts, err := buildKafkaOptions(cfg, zaptest.NewLogger(t))
		require.NoError(t, err)
		require.NotEmpty(t, opts)
		// Can't directly check for SASL options, but we can verify more options are present
		require.Greater(t, len(opts), 1)
	})
}

func TestPubSubProviderBuilderFactory(t *testing.T) {
	t.Run("creates provider with configured adapters", func(t *testing.T) {
		providerId := "test-provider"

		cfg := config.KafkaEventSource{
			ID:      providerId,
			Brokers: []string{"localhost:9092"},
		}

		logger := zaptest.NewLogger(t)

		ctx := context.Background()

		builder := NewProviderBuilder(ctx, logger, "host", "addr")
		require.NotNil(t, builder)
		provider, err := builder.BuildProvider(cfg, datasource.ProviderOpts{})
		require.NoError(t, err)

		// Check the returned provider
		kafkaProvider, ok := provider.(*datasource.PubSubProvider)
		require.True(t, ok)
		assert.NotNil(t, kafkaProvider.Logger)
		assert.NotNil(t, kafkaProvider.Adapter)
	})
}

func TestBuildEngineDataSourceFactoryDeliveryGuaranteeMode(t *testing.T) {
	providerId := "test-provider"
	providers := map[string]datasource.Provider{
		providerId: datasource.NewPubSubProvider(providerId, providerTypeID, nil, zaptest.NewLogger(t), nil),
	}

	tests := []struct {
		name               string
		deliveryGuarantees *nodev1.DeliveryGuarantees
		want               datasource.DeliveryGuaranteeMode
	}{
		{
			name:               "defaults to off if no delivery guarantees are declared",
			deliveryGuarantees: nil,
			want:               datasource.DeliveryGuaranteeModeOff,
		},
		{
			name:               "off",
			deliveryGuarantees: &nodev1.DeliveryGuarantees{Mode: nodev1.DeliveryGuaranteeMode_DELIVERY_GUARANTEE_MODE_OFF},
			want:               datasource.DeliveryGuaranteeModeOff,
		},
		{
			name:               "cursor",
			deliveryGuarantees: &nodev1.DeliveryGuarantees{Mode: nodev1.DeliveryGuaranteeMode_DELIVERY_GUARANTEE_MODE_CURSOR},
			want:               datasource.DeliveryGuaranteeModeCursor,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			builder := NewProviderBuilder(context.Background(), zaptest.NewLogger(t), "host", "addr")
			factory, err := builder.BuildEngineDataSourceFactory(&nodev1.KafkaEventConfiguration{
				EngineEventConfiguration: &nodev1.EngineEventConfiguration{
					ProviderId:         providerId,
					Type:               nodev1.EventType_SUBSCRIBE,
					TypeName:           "Subscription",
					FieldName:          "testField",
					DeliveryGuarantees: tt.deliveryGuarantees,
				},
				Topics: []string{"test-topic"},
			}, providers)
			require.NoError(t, err)

			input, err := factory.ResolveDataSourceSubscriptionInput()
			require.NoError(t, err)

			var subscriptionConfig SubscriptionEventConfiguration
			require.NoError(t, json.Unmarshal([]byte(input), &subscriptionConfig))
			assert.Equal(t, tt.want, subscriptionConfig.GuaranteeMode)
		})
	}
}
