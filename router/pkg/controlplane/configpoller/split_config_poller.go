package configpoller

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/cespare/xxhash/v2"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/controlplane"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
)

// SplitConfigFetcher fetches individual graph configs from CDN using the split-config strategy.
type SplitConfigFetcher interface {
	// FetchMapper fetches the mapper file listing all active graphs and their hashes.
	FetchMapper(ctx context.Context) (*nodev1.ActiveGraphs, error)
	// FetchConfig fetches the router config for the given feature flag name.
	// featureFlagName="" fetches the base graph (manifest/latest.json).
	// featureFlagName="X" fetches the feature flag config (manifest/feature-flags/X.json).
	FetchConfig(ctx context.Context, featureFlagName string) (*nodev1.RouterConfig, error)
}

// SplitConfigPollerOption configures a splitConfigPoller.
type SplitConfigPollerOption func(*splitConfigPoller)

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
func (p *splitConfigPoller) fetchAndAssembleAll(ctx context.Context, activeGraphs *nodev1.ActiveGraphs) (*nodev1.RouterConfig, error) {
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

	// Fetch feature flag configs.
	for name := range activeGraphs.GetGraphConfigs() {
		if name == "" {
			continue // base graph already handled above
		}
		ffConfig, err := p.fetcher.FetchConfig(ctx, name)
		if err != nil {
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

	graphConfigs := activeGraphs.GetGraphConfigs()
	if len(graphConfigs) == 0 {
		return nil, fmt.Errorf("mapper returned empty graph configs")
	}

	config, err := p.fetchAndAssembleAll(ctx, activeGraphs)
	if err != nil {
		return nil, err
	}

	p.knownHashes = graphConfigs
	p.currentConfig = config
	p.latestVersion = computeCompositeVersion(graphConfigs)

	return &routerconfig.Response{Config: config}, nil
}

// Subscribe starts the polling loop and calls handler whenever the assembled config changes.
func (p *splitConfigPoller) Subscribe(ctx context.Context, handler func(newConfig *nodev1.RouterConfig, oldVersion string) error) {
	p.poller.Subscribe(ctx, func() {
		fetchStart := time.Now()

		activeGraphs, err := p.fetcher.FetchMapper(ctx)
		if err != nil {
			p.logger.Error("Failed to fetch mapper during poll, keeping existing config", zap.Error(err))
			return
		}

		graphConfigs := activeGraphs.GetGraphConfigs()
		if len(graphConfigs) == 0 {
			p.logger.Warn("Mapper returned empty graph configs, keeping existing config")
			return
		}

		newVersion := computeCompositeVersion(graphConfigs)
		if newVersion == p.latestVersion {
			p.logger.Debug("No changes detected in engine config, keeping existing config")
			return
		}

		p.logger.Info("Router execution config has changed, hot reloading server",
			zap.String("old_version", p.latestVersion),
			zap.String("new_version", newVersion),
			zap.String("fetch_time", time.Since(fetchStart).String()),
		)

		// Determine what changed, was added, or was removed.
		changed := make(map[string]bool)
		added := make(map[string]bool)
		removed := make(map[string]bool)

		for name, hash := range graphConfigs {
			if oldHash, exists := p.knownHashes[name]; !exists {
				added[name] = true
			} else if oldHash != hash {
				changed[name] = true
			}
		}
		for name := range p.knownHashes {
			if _, exists := graphConfigs[name]; !exists {
				removed[name] = true
			}
		}

		// Clone the in-use config before mutating.
		patched := proto.Clone(p.currentConfig).(*nodev1.RouterConfig)

		// Apply changes and additions.
		toFetch := make(map[string]bool, len(changed)+len(added))
		for name := range changed {
			toFetch[name] = true
		}
		for name := range added {
			toFetch[name] = true
		}

		for name := range toFetch {
			fetchedConfig, err := p.fetcher.FetchConfig(ctx, name)
			if err != nil {
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
		for name := range removed {
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

		oldVersion := p.latestVersion

		handlerStart := time.Now()
		if err := handler(patched, oldVersion); err != nil {
			p.logger.Error("Error invoking config poll handler", zap.Error(err))
			return
		}

		p.logger.Debug("New graph server swapped",
			zap.String("duration", time.Since(handlerStart).String()),
			zap.String("config_version", newVersion),
		)

		// Only update internal state after the handler succeeds.
		p.knownHashes = graphConfigs
		p.currentConfig = patched
		p.latestVersion = newVersion
	})
}
