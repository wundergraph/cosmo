// Package custom_rate_limiter is an example custom module: a fixed-window rate
// limiter keyed by a request header, whose limit can be hot reloaded.
//
// Three kinds of "reload" reach a module differently:
//
//  1. Its own limits file (LimitsFile): the module polls it and swaps the limit
//     atomically. No router restart; counters are kept.
//  2. Execution config / schema hot reload (CDN poller, execution_config file
//     watch): the router swaps the graph server only. Modules are NOT
//     re-provisioned, so this instance and its counters survive untouched.
//  3. Router config reload (SIGHUP, watch_config): the supervisor shuts the
//     whole Router down (Cleanup is called) and builds a new one, so a fresh
//     instance is provisioned from the new `modules:` config. In-memory
//     counters are lost unless kept outside the instance.
package custom_rate_limiter

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
)

const ModuleID = "customRateLimiter"

// Stats lets tests observe the module lifecycle across router reloads.
// It is looked up by StatsKey because mapstructure deep-copies pointer fields
// from the modules config, so a *Stats passed there never reaches the instance.
type Stats struct {
	Provisions atomic.Int32
	Cleanups   atomic.Int32
	FileReload atomic.Int32
}

var statsRegistry sync.Map

// StatsFor returns the Stats shared by every instance configured with key.
func StatsFor(key string) *Stats {
	v, _ := statsRegistry.LoadOrStore(key, &Stats{})
	return v.(*Stats)
}

type limitsFile struct {
	Limit int64 `json:"limit"`
}

type window struct {
	start time.Time
	count int64
}

type RateLimiter struct {
	// Configured via `modules.customRateLimiter` in the router config.
	Limit        int64  `mapstructure:"limit"`
	Window       string `mapstructure:"window"`        // e.g. "1m"; Go duration string
	KeyHeader    string `mapstructure:"key_header"`    // defaults to X-Client-ID
	LimitsFile   string `mapstructure:"limits_file"`   // optional JSON {"limit": N}, hot reloaded
	PollInterval string `mapstructure:"poll_interval"` // defaults to 1s
	StatsKey     string `mapstructure:"stats_key"`

	stats    *Stats
	logger   *zap.Logger
	limit    atomic.Int64
	window   time.Duration
	mu       sync.Mutex
	counters map[string]*window
	lastMod  time.Time
	cancel   context.CancelFunc
	done     chan struct{}
}

func (m *RateLimiter) Provision(ctx *core.ModuleContext) error {
	m.logger = ctx.Logger
	m.stats = StatsFor(m.StatsKey)
	m.stats.Provisions.Add(1)

	if m.KeyHeader == "" {
		m.KeyHeader = "X-Client-ID"
	}
	m.window = time.Minute
	if m.Window != "" {
		d, err := time.ParseDuration(m.Window)
		if err != nil {
			return fmt.Errorf("invalid window: %w", err)
		}
		m.window = d
	}
	m.limit.Store(m.Limit)
	m.counters = make(map[string]*window)

	if m.LimitsFile != "" {
		interval := time.Second
		if m.PollInterval != "" {
			d, err := time.ParseDuration(m.PollInterval)
			if err != nil {
				return fmt.Errorf("invalid poll_interval: %w", err)
			}
			interval = d
		}
		if err := m.reloadLimits(); err != nil {
			return err
		}
		// Don't tie the watcher to ctx: it is the router's lifetime context and
		// may outlive or predate the instance; Cleanup stops it explicitly.
		watchCtx, cancel := context.WithCancel(context.Background())
		m.cancel = cancel
		m.done = make(chan struct{})
		go m.watch(watchCtx, interval)
	}

	m.logger.Info("rate limiter provisioned", zap.Int64("limit", m.limit.Load()), zap.Duration("window", m.window))
	return nil
}

func (m *RateLimiter) watch(ctx context.Context, interval time.Duration) {
	defer close(m.done)
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := m.reloadLimits(); err != nil {
				// Keep the last good limit on a bad file.
				m.logger.Warn("failed to reload rate limits, keeping previous", zap.Error(err))
			}
		}
	}
}

func (m *RateLimiter) reloadLimits() error {
	fi, err := os.Stat(m.LimitsFile)
	if err != nil {
		return err
	}
	if !fi.ModTime().After(m.lastMod) {
		return nil
	}
	b, err := os.ReadFile(m.LimitsFile)
	if err != nil {
		return err
	}
	var lf limitsFile
	if err := json.Unmarshal(b, &lf); err != nil {
		return err
	}
	m.lastMod = fi.ModTime()
	old := m.limit.Swap(lf.Limit)
	m.stats.FileReload.Add(1)
	m.logger.Info("rate limit reloaded", zap.Int64("old", old), zap.Int64("new", lf.Limit))
	return nil
}

func (m *RateLimiter) allow(key string) bool {
	limit := m.limit.Load()
	if limit <= 0 {
		return true
	}
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	w, ok := m.counters[key]
	if !ok || now.Sub(w.start) >= m.window {
		w = &window{start: now}
		m.counters[key] = w
	}
	if w.count >= limit {
		return false
	}
	w.count++
	return true
}

func (m *RateLimiter) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
	key := ctx.Request().Header.Get(m.KeyHeader)
	if key == "" {
		key = "anonymous"
	}
	if !m.allow(key) {
		core.WriteResponseError(ctx, core.NewHttpGraphqlError("rate limit exceeded", "RATE_LIMIT_EXCEEDED", http.StatusTooManyRequests))
		return
	}
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

func (m *RateLimiter) Cleanup() error {
	m.stats.Cleanups.Add(1)
	if m.cancel != nil {
		m.cancel()
		<-m.done
	}
	return nil
}

func (m *RateLimiter) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       ModuleID,
		Priority: 1,
		New: func() core.Module {
			return &RateLimiter{}
		},
	}
}

var (
	_ core.RouterOnRequestHandler = (*RateLimiter)(nil)
	_ core.Provisioner            = (*RateLimiter)(nil)
	_ core.Cleaner                = (*RateLimiter)(nil)
)
