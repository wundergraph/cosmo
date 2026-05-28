package routerconfig

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/execution_config"
)

func VersionPath(version int) string {
	switch version {
	case 1:
		return ""
	default:
		return fmt.Sprintf("v%d/", version)
	}
}

// IsValidSplitConfigPath checks if the given path is a valid split config path.
// It checks if the path is a directory, and if it contains a mapper.json file.
// It does not support symlinks for now.
func IsValidSplitConfigPath(path string) bool {
	info, err := os.Lstat(path)
	if err != nil {
		return false
	}

	// We don't support symlinks for now
	if info.Mode()&os.ModeSymlink != 0 {
		return false
	}

	if !info.IsDir() {
		return false
	}

	mapperStat, err := os.Lstat(path + "/mapper.json")
	if err != nil {
		if os.IsNotExist(err) {
			return false
		}
		return false
	}

	return mapperStat.Mode().IsRegular()
}

// ReadMapperFile reads the mapper.json file from the given path and returns the mapper.
// The mapper file is a JSON object with the feature flag name as the key and the hash as the value.
func ReadMapperFile(path string) (map[string]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var mapper map[string]string
	if err := json.Unmarshal(data, &mapper); err != nil {
		return nil, err
	}

	return mapper, nil
}

type AssembleConfigRules struct {
	SkipMissingFeatureFlags bool
	IgnoredFeatureFlags     []string
}

// AssembleConfig assembles the router execution config from the base config and the feature flag configs.
// The base config is the latest.json file in the manifest directory.
// The feature flag configs are the feature-flags/<feature-flag-name>.json files in the manifest directory.
// The rules are the rules for skipping missing feature flags and ignored feature flags.
func AssembleConfig(basePath string, mapper map[string]string, rules AssembleConfigRules) (*nodev1.RouterConfig, error) {

	baseConfigPath := filepath.Join(basePath, "latest.json")

	_, err := os.Stat(baseConfigPath)
	if err != nil {
		return nil, fmt.Errorf("failed to stat base config path: %w", err)
	}

	baseConfig, err := execution_config.FromFile(baseConfigPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read base config: %w", err)
	}

	featureFlagPath := filepath.Join(basePath, "feature-flags")
	_, err = os.Stat(featureFlagPath)
	if err != nil {
		return nil, fmt.Errorf("failed to stat feature flag path: %w", err)
	}

	// pre-allocation hint for the feature flag configs map
	baseConfig.FeatureFlagConfigs = &nodev1.FeatureFlagRouterExecutionConfigs{
		ConfigByFeatureFlagName: make(map[string]*nodev1.FeatureFlagRouterExecutionConfig, max(len(mapper)-1, 0)),
	}

	ignoredFeatureFlags := make(map[string]struct{})

	for _, ff := range rules.IgnoredFeatureFlags {
		ignoredFeatureFlags[ff] = struct{}{}
	}

	fsys := os.DirFS(featureFlagPath)
	for key := range mapper {
		// ignore base graph
		if key == "" {
			continue
		}

		// skip ignored feature flags
		if _, ok := ignoredFeatureFlags[key]; ok {
			continue
		}

		fileBytes, err := fs.ReadFile(fsys, key+".json")
		if err != nil {
			if os.IsNotExist(err) {
				if rules.SkipMissingFeatureFlags {
					continue
				}

				return nil, fmt.Errorf("feature flag config not found: %w", err)
			}

			return nil, fmt.Errorf("failed to read feature flag config %q: %w", key, err)
		}

		featureFlagConfig, err := execution_config.UnmarshalConfig(fileBytes)
		if err != nil {
			return nil, fmt.Errorf("failed to unmarshal feature flag config: %w", err)
		}

		baseConfig.FeatureFlagConfigs.ConfigByFeatureFlagName[key] = &nodev1.FeatureFlagRouterExecutionConfig{
			EngineConfig: featureFlagConfig.EngineConfig,
			Version:      featureFlagConfig.Version,
			Subgraphs:    featureFlagConfig.Subgraphs,
		}

	}

	return baseConfig, nil
}
