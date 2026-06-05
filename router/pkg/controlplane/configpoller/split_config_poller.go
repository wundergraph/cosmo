package configpoller

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"
	"time"

	"github.com/cespare/xxhash/v2"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/controlplane"
	"github.com/wundergraph/cosmo/router/pkg/errs"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
)

// SplitConfigFetcher fetches individual graph configs from CDN using the split-config strategy.
type SplitConfigFetcher interface {
	// FetchMapper fetches the mapper file listing all active graphs and their hashes.
	// The returned has the flags name as key, and it's hash as value.
	FetchMapper(ctx context.Context) (map[string]string, error)
	// FetchConfig fetches the router config for the given feature flag name.
	// featureFlagName="" fetches the base graph (manifest/latest.json).
	// featureFlagName="X" fetches the feature flag config (manifest/feature-flags/X.json).
	FetchConfig(ctx context.Context, featureFlagName string) (*nodev1.RouterConfig, error)
}

// SplitConfigPollerOption configures a splitConfigPoller.
type SplitConfigPollerOption func(*splitConfigPoller)

type ConfigRules struct {
	SkipMissingFeatureFlags bool
	IgnoredFeatureFlags     map[string]struct{}
}

type splitConfigPoller struct {
	logger       *zap.Logger
	poller       controlplane.Poller
	pollInterval time.Duration
	pollJitter   time.Duration
	fetcher      SplitConfigFetcher

	// Internal state – not safe for concurrent access.
	knownHashes   map[string]string    // name -> hash from last successful mapper fetch ("" = base)
	currentConfig *nodev1.RouterConfig // last successfully assembled full config
	latestVersion string               // composite hash used for change detection
	configRules   ConfigRules          // config rules to apply to the config
}

// NewSplitConfigPoller creates a ConfigPoller that uses the split-config strategy.
func NewSplitConfigPoller(fetcher SplitConfigFetcher, opts ...SplitConfigPollerOption) ConfigPoller {
	p := &splitConfigPoller{
		fetcher:     fetcher,
		knownHashes: make(map[string]string),
	}
	for _, opt := range opts {
		opt(p)
	}
	if p.logger == nil {
		p.logger = zap.NewNop()
	}
	p.poller = controlplane.NewPoll(p.pollInterval, p.pollJitter)
	return p
}

// WithSplitLogger sets the logger for the split config poller.
func WithSplitLogger(logger *zap.Logger) SplitConfigPollerOption {
	return func(p *splitConfigPoller) {
		p.logger = logger
	}
}

// WithSplitPolling sets the polling interval and jitter for the split config poller.
func WithSplitPolling(interval time.Duration, jitter time.Duration) SplitConfigPollerOption {
	return func(p *splitConfigPoller) {
		p.pollInterval = interval
		p.pollJitter = jitter
	}
}

func WithConfigRules(rules ConfigRules) SplitConfigPollerOption {
	return func(p *splitConfigPoller) {
		p.configRules = rules
	}
}

// computeCompositeVersion returns a deterministic version string derived from all mapper entries.
func computeCompositeVersion(graphConfigs map[string]string) string {
	keys := make([]string, 0, len(graphConfigs))
	for k := range graphConfigs {
		keys = append(keys, k)
	}
	slices.Sort(keys)

	h := xxhash.New()
	for _, k := range keys {
		_, _ = h.Write([]byte(k + ":" + graphConfigs[k] + ";"))
	}
	return fmt.Sprintf("split-%x", h.Sum64())
}

// fetchAndAssembleAll fetches every config listed in activeGraphs and assembles a full RouterConfig.
func (p *splitConfigPoller) fetchAndAssembleAll(ctx context.Context, activeGraphs map[string]string) (*nodev1.RouterConfig, error) {
	// Fetch base graph.
	baseConfig, err := p.fetcher.FetchConfig(ctx, "")
	if err != nil {
		return nil, fmt.Errorf("failed to fetch base config: %w", err)
	}

	assembled := &nodev1.RouterConfig{
		EngineConfig:         baseConfig.EngineConfig,
		Version:              baseConfig.Version,
		Subgraphs:            baseConfig.Subgraphs,
		CompatibilityVersion: baseConfig.CompatibilityVersion,
	}

	hasIgnoredFeatureFlags := len(p.configRules.IgnoredFeatureFlags) > 0

	// Fetch feature flag configs.
	for name := range activeGraphs {
		if name == "" {
			continue // base graph already handled above
		}

		if hasIgnoredFeatureFlags {
			if _, ok := p.configRules.IgnoredFeatureFlags[name]; ok {
				p.logger.Info("Feature flag is ignored, skipping", zap.String("feature_flag", name))
				continue
			}
		}

		ffConfig, err := p.fetcher.FetchConfig(ctx, name)
		if err != nil {
			if p.shouldIgnoreMissingFeatureFlag(err) {
				p.logger.Warn("Feature flag config not found, skipping", zap.String("feature_flag", name))
				continue
			}
			return nil, fmt.Errorf("failed to fetch config for feature flag %q: %w", name, err)
		}

		if assembled.FeatureFlagConfigs == nil {
			assembled.FeatureFlagConfigs = &nodev1.FeatureFlagRouterExecutionConfigs{
				ConfigByFeatureFlagName: make(map[string]*nodev1.FeatureFlagRouterExecutionConfig),
			}
		}

		assembled.FeatureFlagConfigs.ConfigByFeatureFlagName[name] = &nodev1.FeatureFlagRouterExecutionConfig{
			EngineConfig: ffConfig.EngineConfig,
			Version:      ffConfig.Version,
			Subgraphs:    ffConfig.Subgraphs,
		}
	}

	return assembled, nil
}

// GetRouterConfig performs the initial fetch: mapper + all individual configs.
func (p *splitConfigPoller) GetRouterConfig(ctx context.Context) (*routerconfig.Response, error) {
	activeGraphs, err := p.fetcher.FetchMapper(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch mapper: %w", err)
	}

	if len(activeGraphs) == 0 {
		return nil, fmt.Errorf("empty graph configs")
	}

	if _, exists := activeGraphs[""]; !exists {
		return nil, fmt.Errorf("mapper missing base graph entry")
	}

	config, err := p.fetchAndAssembleAll(ctx, activeGraphs)
	if err != nil {
		return nil, err
	}

	p.knownHashes = activeGraphs
	p.currentConfig = config
	p.latestVersion = computeCompositeVersion(activeGraphs)

	response := &routerconfig.Response{
		Config:  config,
		Changes: nil, // purposefully nil to tell callers to rebuild everything since this is the initial fetch
	}

	return response, nil
}

// Subscribe starts the polling loop and calls handler whenever the assembled config changes.
func (p *splitConfigPoller) Subscribe(ctx context.Context, handler func(response *routerconfig.Response) error) {
	p.poller.Subscribe(ctx, func() {
		fetchStart := time.Now()

		hasIgnoredFeatureFlags := len(p.configRules.IgnoredFeatureFlags) > 0

		mapperGraphs, err := p.fetcher.FetchMapper(ctx)
		if err != nil {
			p.logger.Error("Failed to fetch mapper during poll, keeping existing config", zap.Error(err))
			return
		}

		if hasIgnoredFeatureFlags {
			for name := range p.configRules.IgnoredFeatureFlags {
				delete(mapperGraphs, name)
				p.logger.Info("Feature flag is ignored, skipping", zap.String("feature_flag", name))
			}
		}

		if _, ok := mapperGraphs[""]; !ok {
			p.logger.Warn("Mapper missing base graph entry, keeping existing config")
			return
		}

		// Determine what changed, was added, or was removed.
		changes := routerconfig.Changes{
			AddedConfigs:   make(map[string]struct{}),
			RemovedConfigs: make(map[string]struct{}),
			ChangedConfigs: make(map[string]struct{}),
		}

		for name, hash := range mapperGraphs {
			if oldHash, exists := p.knownHashes[name]; !exists {
				changes.AddedConfigs[name] = struct{}{}
			} else if oldHash != hash {
				changes.ChangedConfigs[name] = struct{}{}
			}
		}
		for name := range p.knownHashes {
			if _, exists := mapperGraphs[name]; !exists {
				changes.RemovedConfigs[name] = struct{}{}
			}
		}

		// Clone the in-use config before mutating.
		patched := proto.Clone(p.currentConfig).(*nodev1.RouterConfig)

		// Apply changes and additions.
		toFetch := make(map[string]struct{}, len(changes.ChangedConfigs)+len(changes.AddedConfigs))
		maps.Copy(toFetch, changes.ChangedConfigs)
		maps.Copy(toFetch, changes.AddedConfigs)

		for name := range toFetch {
			fetchedConfig, err := p.fetcher.FetchConfig(ctx, name)
			if err != nil {
				if p.shouldIgnoreMissingFeatureFlag(err) {
					p.logger.Warn("Feature flag config not found, skipping fetch", zap.String("feature_flag", name))
					// Remove the feature flag from the mapper and changes so that it is not included in the new config.
					// This prevents the graph server from tearing down its old mux when it thinks the flag changed (or was added).
					delete(mapperGraphs, name)
					delete(changes.ChangedConfigs, name)
					delete(changes.AddedConfigs, name)

					continue
				}

				p.logger.Error("Failed to fetch config, skipping entire update",
					zap.String("name", name),
					zap.Error(err),
				)
				return
			}

			if name == "" {
				// Base graph update.
				patched.EngineConfig = fetchedConfig.EngineConfig
				patched.Version = fetchedConfig.Version
				patched.Subgraphs = fetchedConfig.Subgraphs
				patched.CompatibilityVersion = fetchedConfig.CompatibilityVersion
			} else {
				if patched.FeatureFlagConfigs == nil {
					patched.FeatureFlagConfigs = &nodev1.FeatureFlagRouterExecutionConfigs{
						ConfigByFeatureFlagName: make(map[string]*nodev1.FeatureFlagRouterExecutionConfig),
					}
				}
				patched.FeatureFlagConfigs.ConfigByFeatureFlagName[name] = &nodev1.FeatureFlagRouterExecutionConfig{
					EngineConfig: fetchedConfig.EngineConfig,
					Version:      fetchedConfig.Version,
					Subgraphs:    fetchedConfig.Subgraphs,
				}
			}
		}

		// Remove deleted feature flags.
		for name := range changes.RemovedConfigs {
			if name == "" {
				continue // base graph cannot be removed
			}
			if patched.FeatureFlagConfigs != nil {
				delete(patched.FeatureFlagConfigs.ConfigByFeatureFlagName, name)
				if len(patched.FeatureFlagConfigs.ConfigByFeatureFlagName) == 0 {
					patched.FeatureFlagConfigs = nil
				}
			}
		}

		newVersion := computeCompositeVersion(mapperGraphs)
		if newVersion == p.latestVersion {
			p.logger.Debug("No changes detected in engine config, keeping existing config")
			return
		}

		response := &routerconfig.Response{
			Config:  patched,
			Changes: &changes,
		}

		handlerStart := time.Now()
		if err := handler(response); err != nil {
			p.logger.Error("Error invoking config poll handler", zap.Error(err))
			return
		}

		p.logger.Info("Router execution config has changed, hot reloading server",
			zap.String("old_version", p.latestVersion),
			zap.String("new_version", newVersion),
			zap.String("fetch_time", time.Since(fetchStart).String()),
		)

		p.logger.Debug("New graph server swapped",
			zap.String("duration", time.Since(handlerStart).String()),
			zap.String("config_version", newVersion),
		)

		// Only update internal state after the handler succeeds,
		// i.e. the newly created engine config is actually used by the graph server.
		p.knownHashes = mapperGraphs
		p.currentConfig = patched
		p.latestVersion = newVersion
	})
}

func (p *splitConfigPoller) shouldIgnoreMissingFeatureFlag(err error) bool {
	return p.configRules.SkipMissingFeatureFlags && errors.Is(err, errs.ErrFileNotFound)
}
