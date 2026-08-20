package rediscloser

import (
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// poolSettings mirrors the pool fields that redis.Options and redis.ClusterOptions declare
// separately, so the merge and logging logic exists once instead of per client kind.
type poolSettings struct {
	PoolSize        int
	MinIdleConns    int
	MaxIdleConns    int
	MaxActiveConns  int
	PoolTimeout     time.Duration
	ConnMaxIdleTime time.Duration
	ConnMaxLifetime time.Duration
}

// mergePoolConfiguration layers configured values over the ones parsed from the connection URL.
// Zero means "not configured", so URL parameters like ?pool_size=50 survive and go-redis still
// applies its defaults. Negative values pass through: go-redis uses them to disable a check.
func mergePoolConfiguration(parsed poolSettings, cfg *config.RedisConnectionPoolConfiguration) poolSettings {
	if cfg == nil {
		return parsed
	}
	if cfg.Size != 0 {
		parsed.PoolSize = cfg.Size
	}
	if cfg.MinIdleConns != 0 {
		parsed.MinIdleConns = cfg.MinIdleConns
	}
	if cfg.MaxIdleConns != 0 {
		parsed.MaxIdleConns = cfg.MaxIdleConns
	}
	if cfg.MaxActiveConns != 0 {
		parsed.MaxActiveConns = cfg.MaxActiveConns
	}
	if cfg.Timeout != 0 {
		parsed.PoolTimeout = cfg.Timeout
	}
	if cfg.ConnMaxIdleTime != 0 {
		parsed.ConnMaxIdleTime = cfg.ConnMaxIdleTime
	}
	if cfg.ConnMaxLifetime != 0 {
		parsed.ConnMaxLifetime = cfg.ConnMaxLifetime
	}
	// If MaxActiveConns is set and less than the pool size, set it to the pool size.
	if cfg.MaxActiveConns > 0 && cfg.MaxActiveConns < cfg.Size {
		parsed.MaxActiveConns = cfg.Size
	}

	return parsed
}

// applyPoolConfiguration writes the merged settings onto the single-node options and returns them.
func applyPoolConfiguration(opts *redis.Options, cfg *config.RedisConnectionPoolConfiguration) {
	merged := mergePoolConfiguration(poolSettings{
		PoolSize:        opts.PoolSize,
		MinIdleConns:    opts.MinIdleConns,
		MaxIdleConns:    opts.MaxIdleConns,
		MaxActiveConns:  opts.MaxActiveConns,
		PoolTimeout:     opts.PoolTimeout,
		ConnMaxIdleTime: opts.ConnMaxIdleTime,
		ConnMaxLifetime: opts.ConnMaxLifetime,
	}, cfg)

	opts.PoolSize = merged.PoolSize
	opts.MinIdleConns = merged.MinIdleConns
	opts.MaxIdleConns = merged.MaxIdleConns
	opts.MaxActiveConns = merged.MaxActiveConns
	opts.PoolTimeout = merged.PoolTimeout
	opts.ConnMaxIdleTime = merged.ConnMaxIdleTime
	opts.ConnMaxLifetime = merged.ConnMaxLifetime
}

// applyClusterPoolConfiguration is the cluster counterpart. The cluster client enforces these
// limits per node, not across the cluster.
func applyClusterPoolConfiguration(opts *redis.ClusterOptions, cfg *config.RedisConnectionPoolConfiguration) {
	merged := mergePoolConfiguration(poolSettings{
		PoolSize:        opts.PoolSize,
		MinIdleConns:    opts.MinIdleConns,
		MaxIdleConns:    opts.MaxIdleConns,
		MaxActiveConns:  opts.MaxActiveConns,
		PoolTimeout:     opts.PoolTimeout,
		ConnMaxIdleTime: opts.ConnMaxIdleTime,
		ConnMaxLifetime: opts.ConnMaxLifetime,
	}, cfg)

	opts.PoolSize = merged.PoolSize
	opts.MinIdleConns = merged.MinIdleConns
	opts.MaxIdleConns = merged.MaxIdleConns
	opts.MaxActiveConns = merged.MaxActiveConns
	opts.PoolTimeout = merged.PoolTimeout
	opts.ConnMaxIdleTime = merged.ConnMaxIdleTime
	opts.ConnMaxLifetime = merged.ConnMaxLifetime
}
