package core

import (
	"errors"
	"fmt"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	configCDNProvider "github.com/wundergraph/cosmo/router/pkg/routerconfig/cdn"
	configs3Provider "github.com/wundergraph/cosmo/router/pkg/routerconfig/s3"
	"go.uber.org/zap"
)

func getConfigClient(
	r *Router,
	cdnProviders map[string]config.CDNStorageProvider,
	s3Providers map[string]config.S3StorageProvider,
	providerID string,
	primaryClientUsesCosmoCDN bool,
	isFallbackClient bool,
) (client *routerconfig.Client, usedCosmoCDN bool, err error) {
	// CDN Providers
	if provider, ok := cdnProviders[providerID]; ok {
		if r.graphApiToken == "" {
			return nil, false, errors.New(
				"graph token is required to fetch execution config from CDN. " +
					"Alternatively, configure a custom storage provider or specify a static execution config",
			)
		}

		c, err := configCDNProvider.NewClient(
			provider.URL,
			r.graphApiToken,
			&configCDNProvider.Options{
				Logger:       r.logger,
				SignatureKey: r.routerConfigPollerConfig.GraphSignKey,
			})
		if err != nil {
			return nil, false, err
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

		return &c, false, nil
	}

	// S3 Providers
	if provider, ok := s3Providers[providerID]; ok {
		c, err := configs3Provider.NewClient(provider.Endpoint, &configs3Provider.ClientOptions{
			AccessKeyID:     provider.AccessKey,
			SecretAccessKey: provider.SecretKey,
			BucketName:      provider.Bucket,
			Region:          provider.Region,
			ObjectPath:      r.routerConfigPollerConfig.Storage.ObjectPath,
			Secure:          provider.Secure,
		})
		if err != nil {
			return nil, false, err
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

		return &c, false, nil
	}

	if providerID != "" {
		return nil, false, fmt.Errorf("unknown storage provider id '%s' for execution config", providerID)
	}

	// Avoid using Cosmo CDN as both primary and backup provider
	if primaryClientUsesCosmoCDN {
		return nil, false, nil
	}

	if r.graphApiToken == "" {
		return nil, false, errors.New(
			"graph token is required to fetch execution config from CDN. " +
				"Alternatively, configure a custom storage provider or specify a static execution config",
		)
	}

	c, err := configCDNProvider.NewClient(r.cdnConfig.URL, r.graphApiToken, &configCDNProvider.Options{
		Logger:       r.logger,
		SignatureKey: r.routerConfigPollerConfig.GraphSignKey,
	})
	if err != nil {
		return nil, false, err
	}

	if isFallbackClient {
		r.logger.Info("Using Cosmo CDN as fallback execution config provider")
	} else {
		r.logger.Info("Polling for execution config updates from Cosmo CDN in the background",
			zap.String("interval", r.routerConfigPollerConfig.PollInterval.String()),
		)
	}

	return &c, true, nil
}

// InitializeConfigPoller creates a poller to fetch execution config. It is only initialized when a config poller is configured and the router is not started with a static config
func InitializeConfigPoller(r *Router, cdnProviders map[string]config.CDNStorageProvider, s3Providers map[string]config.S3StorageProvider) (*configpoller.ConfigPoller, error) {
	if r.staticExecutionConfig != nil || r.routerConfigPollerConfig == nil || r.configPoller != nil {
		return nil, nil
	}

	primaryClient, primaryClientUsesCosmoCDN, err := getConfigClient(r, cdnProviders, s3Providers, r.routerConfigPollerConfig.Storage.ProviderID, false, false)
	if err != nil {
		return nil, err
	}

	if primaryClient == nil {
		return nil, nil
	}

	var fallbackClient *routerconfig.Client
	if r.routerConfigPollerConfig.FallbackStorage.ProviderID != "" {
		fallbackClient, _, err = getConfigClient(r, cdnProviders, s3Providers, r.routerConfigPollerConfig.Storage.ProviderID, primaryClientUsesCosmoCDN, true)
		if err != nil {
			return nil, err
		}
	}

	configPoller := configpoller.New(r.graphApiToken,
		configpoller.WithLogger(r.logger),
		configpoller.WithPollInterval(r.routerConfigPollerConfig.PollInterval),
		configpoller.WithClient(*primaryClient),
		configpoller.WithFallbackClient(fallbackClient),
	)

	return &configPoller, nil
}
