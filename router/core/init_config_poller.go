package core

import (
	"errors"
	"fmt"

	rjwt "github.com/wundergraph/cosmo/router/internal/jwt"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/execution_config"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	configCDNProvider "github.com/wundergraph/cosmo/router/pkg/routerconfig/cdn"
	configs3Provider "github.com/wundergraph/cosmo/router/pkg/routerconfig/s3"
	"go.uber.org/zap"
)

func getConfigClient(r *Router, registry *ProviderRegistry, providerID string, isFallbackClient bool) (client *routerconfig.Client, err error) {
	// CDN Providers
	if provider, ok := registry.CDN(providerID); ok {
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
	if provider, ok := registry.S3(providerID); ok {
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
func InitializeConfigPoller(r *Router, registry *ProviderRegistry) (*configpoller.ConfigPoller, error) {
	if r.staticExecutionConfig != nil || r.routerConfigPollerConfig == nil || r.configPoller != nil {
		return nil, nil
	}

	// Check whether the router JWT requests the split-config-loading strategy.
	// Split config is only supported with the default Cosmo CDN (no custom storage provider).
	hasSplitCfgFeature, err := hasSplitConfigFeature(r)
	if err != nil {
		return nil, err
	}

	if hasSplitCfgFeature {
		providerID := r.routerConfigPollerConfig.Storage.ProviderID
		if providerID == "" {
			r.logger.Debug("Use split-config poller to fetch execution config")
			return newSplitConfigPoller(r)
		}
		r.logger.Info("split-config-loading feature is enabled but a custom storage provider is configured; falling back to regular config polling",
			zap.String("provider_id", providerID))
	}

	primaryClient, err := getConfigClient(r, registry, r.routerConfigPollerConfig.Storage.ProviderID, false)
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

		fallbackClient, err = getConfigClient(r, registry, r.routerConfigPollerConfig.FallbackStorage.ProviderID, true)
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

func hasSplitConfigFeature(r *Router) (bool, error) {
	if r.graphApiToken == "" {
		return false, nil
	}

	claims, err := rjwt.ExtractFederatedGraphTokenClaims(r.graphApiToken)
	if err != nil {
		return false, fmt.Errorf("failed to parse graph API token: %w", err)
	}

	return claims.HasFeature(rjwt.FeatureSplitConfigLoading), nil
}

func newSplitConfigPoller(r *Router) (*configpoller.ConfigPoller, error) {
	fetcher, err := configCDNProvider.NewSplitFetcher(
		r.cdnConfig.URL,
		r.graphApiToken,
		&configCDNProvider.Options{
			Logger:       r.logger,
			SignatureKey: r.routerConfigPollerConfig.GraphSignKey,
		},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create split config fetcher: %w", err)
	}

	ignoredFeatureFlags := make(map[string]struct{})
	for _, featureFlag := range r.routerConfigPollerConfig.SplitConfigPoller.IgnoredFeatureFlags {
		ignoredFeatureFlags[featureFlag] = struct{}{}
	}

	splitPoller := configpoller.NewSplitConfigPoller(
		fetcher,
		configpoller.WithSplitLogger(r.logger),
		configpoller.WithSplitPolling(r.routerConfigPollerConfig.PollInterval, r.routerConfigPollerConfig.PollJitter),
		configpoller.WithConfigRules(configpoller.ConfigRules{
			SkipMissingFeatureFlags: r.routerConfigPollerConfig.SplitConfigPoller.SkipMissingFeatureFlags,
			IgnoredFeatureFlags:     ignoredFeatureFlags,
		}),
	)
	return &splitPoller, nil
}
