package core

import (
	"errors"
	"fmt"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/execution_config"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	configCDNProvider "github.com/wundergraph/cosmo/router/pkg/routerconfig/cdn"
	configs3Provider "github.com/wundergraph/cosmo/router/pkg/routerconfig/s3"
	"go.uber.org/zap"
)

func getConfigClient(r *Router, cdnProviders map[string]config.CDNStorageProvider, s3Providers map[string]config.S3StorageProvider, providerID string, isFallbackClient bool) (client *routerconfig.Client, err error) {
	// CDN Providers
	if provider, ok := cdnProviders[providerID]; ok {
		if r.graphApiToken == "" {
			return nil, errors.New(
				"graph token is required to fetch execution config from CDN. " +
					"Alternatively, configure a custom storage provider or specify a static execution config",
			)
		}

		c, err := configCDNProvider.NewClient(
			provider.URL,
			r.graphApiToken,
			&configCDNProvider.Options{
				Logger:                     r.logger,
				SignatureKey:               r.routerConfigPollerConfig.GraphSignKey,
				RouterCompatibilityVersion: execution_config.RouterCompatibilityVersionThreshold,
			})
		if err != nil {
			return nil, err
		}

		if isFallbackClient {
			r.logger.Info("Using CDN as fallback execution config provider",
				zap.String("provider_id", provider.ID),
			)
		} else {
			r.logger.Info("Polling for execution config updates from CDN in the background",
				zap.String("provider_id", provider.ID),
				zap.String("interval", r.routerConfigPollerConfig.PollInterval.String()),
			)
		}

		return &c, nil
	}

	// S3 Providers
	if provider, ok := s3Providers[providerID]; ok {
		clientOptions := &configs3Provider.ClientOptions{
			AccessKeyID:     provider.AccessKey,
			SecretAccessKey: provider.SecretKey,
			BucketName:      provider.Bucket,
			Region:          provider.Region,
			ObjectPath:      r.routerConfigPollerConfig.Storage.ObjectPath,
			Secure:          provider.Secure,
		}

		if isFallbackClient {
			clientOptions.ObjectPath = r.routerConfigPollerConfig.FallbackStorage.ObjectPath
		}

		c, err := configs3Provider.NewClient(provider.Endpoint, clientOptions)
		if err != nil {
			return nil, err
		}

		if isFallbackClient {
			r.logger.Info("Using S3 as fallback execution config provider",
				zap.String("provider_id", provider.ID),
			)
		} else {
			r.logger.Info("Polling for execution config updates from S3 storage in the background",
				zap.String("provider_id", provider.ID),
				zap.String("interval", r.routerConfigPollerConfig.PollInterval.String()),
			)
		}

		return &c, nil
	}

	if providerID != "" {
		return nil, fmt.Errorf("unknown storage provider id '%s' for execution config", providerID)
	}


	if r.graphApiToken == "" {
		// If the router is running in demo mode, we don't need a graph token
		// but the router will just never poll for execution config
		if r.demoMode {
			return nil, nil
		}

		return nil, errors.New(
			"graph token is required to fetch execution config from CDN. " +
				"Alternatively, configure a custom storage provider or specify a static execution config",
		)
	}

	c, err := configCDNProvider.NewClient(r.cdnConfig.URL, r.graphApiToken, &configCDNProvider.Options{
		Logger:                     r.logger,
		SignatureKey:               r.routerConfigPollerConfig.GraphSignKey,
		RouterCompatibilityVersion: execution_config.RouterCompatibilityVersionThreshold,
	})
	if err != nil {
		return nil, err
	}

	if isFallbackClient {
		r.logger.Info("Using Cosmo CDN as fallback execution config provider")
	} else {
		r.logger.Info("Polling for execution config updates from Cosmo CDN in the background",
			zap.String("interval", r.routerConfigPollerConfig.PollInterval.String()),
		)
	}

	return &c, nil
}

// InitializeConfigPoller creates a poller to fetch execution config. It is only initialized when a config poller is configured and the router is not started with a static config
func InitializeConfigPoller(r *Router, cdnProviders map[string]config.CDNStorageProvider, s3Providers map[string]config.S3StorageProvider) (*configpoller.ConfigPoller, error) {
	if r.staticExecutionConfig != nil || r.routerConfigPollerConfig == nil || r.configPoller != nil {
		return nil, nil
	}

	primaryClient, err := getConfigClient(r, cdnProviders, s3Providers, r.routerConfigPollerConfig.Storage.ProviderID, false)
	if err != nil {
		return nil, err
	}

	if primaryClient == nil && !r.demoMode {
		return nil, nil
	}

	var fallbackClient *routerconfig.Client
	if r.routerConfigPollerConfig.FallbackStorage.Enabled {
		if r.routerConfigPollerConfig.Storage.ProviderID == r.routerConfigPollerConfig.FallbackStorage.ProviderID {
			return nil, errors.New("cannot use the same storage as both primary and fallback provider for execution config")
		}

		fallbackClient, err = getConfigClient(r, cdnProviders, s3Providers, r.routerConfigPollerConfig.FallbackStorage.ProviderID, true)
		if err != nil {
			return nil, err
		}
	}
	opts := []configpoller.Option{
		configpoller.WithLogger(r.logger),
		configpoller.WithPolling(r.routerConfigPollerConfig.PollInterval, r.routerConfigPollerConfig.PollJitter),
		configpoller.WithFallbackClient(fallbackClient),
		configpoller.WithDemoMode(r.demoMode),
	}
	if primaryClient != nil {
		opts = append(opts, configpoller.WithClient(*primaryClient))
	}

	configPoller := configpoller.New(r.graphApiToken, opts...)

	return &configPoller, nil
}
