// Package custom_rate_limiter is an example custom module: a Redis-backed GCRA
// rate limiter (same redis_rate limiter as router/core/ratelimiter.go) with
// per-customer limits. The customer is identified by the value of a request
// header, and the limits are hot reloaded from a JSON file:
//
//	{
//	  "header": "X-Customer-ID",
//	  "default": {"rate": 10, "burst": 10, "period": "1s"},
//	  "customers": {
//	    "acme":      {"rate": 100, "burst": 200, "period": "1s"},
//	    "free-tier": {"rate": 5,   "burst": 5,   "period": "1m"}
//	  }
//	}
//
// "header" falls back to key_header from the module config. Requests whose
// header value is not listed in "customers" (or have no header) use "default";
// without a "default" they are not limited. Each customer value gets its own
// Redis key, so customers never share a budget.
//
// Three kinds of "reload" reach a module differently:
//
//  1. Its own limits file (LimitsFile): the module polls it and swaps the whole
//     policy (header, default, customers) atomically. No router restart.
//  2. Execution config / schema hot reload (CDN poller, execution_config file
//     watch): the router swaps the graph server only. Modules are NOT
//     re-provisioned, so this instance keeps running untouched.
//  3. Router config reload (SIGHUP, watch_config): the supervisor shuts the
//     whole Router down (Cleanup is called) and builds a new one, so a fresh
//     instance is provisioned from the new `modules:` config.
//
// Because the counters live in Redis, they survive all three.
package custom_rate_limiter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-redis/redis_rate/v10"
	"github.com/redis/go-redis/v9"
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

type limitSpec struct {
	Rate   int    `json:"rate"`
	Burst  int    `json:"burst"`
	Period string `json:"period"`
}

// limitsFile is the hot-reloadable policy; see the package doc for an example.
type limitsFile struct {
	Header    string               `json:"header"`
	Default   *limitSpec           `json:"default"`
	Customers map[string]limitSpec `json:"customers"`
}

// policy is the compiled, immutable form of limitsFile. It is swapped as a
// whole so a request never sees a header from one version and limits from another.
type policy struct {
	header       string
	defaultLimit *redis_rate.Limit // nil: unknown customers are not limited
	customers    map[string]redis_rate.Limit
}

// limitFor returns the limit for a header value and whether one applies.
func (p *policy) limitFor(customer string) (redis_rate.Limit, bool) {
	if l, ok := p.customers[customer]; ok && customer != "" {
		return l, true
	}
	if p.defaultLimit != nil {
		return *p.defaultLimit, true
	}
	return redis_rate.Limit{}, false
}

type RateLimiter struct {
	// Configured via `modules.customRateLimiter` in the router config.
	RedisURL     string `mapstructure:"redis_url"`  // e.g. redis://localhost:6379
	KeyPrefix    string `mapstructure:"key_prefix"` // defaults to cosmo_custom_rate_limit
	Rate         int    `mapstructure:"rate"`       // default limit when no limits_file is set
	Burst        int    `mapstructure:"burst"`
	Period       string `mapstructure:"period"`        // Go duration string, e.g. "1s"
	KeyHeader    string `mapstructure:"key_header"`    // defaults to X-Client-ID
	LimitsFile   string `mapstructure:"limits_file"`   // optional per-customer policy, overrides rate/burst/period and is hot reloaded
	PollInterval string `mapstructure:"poll_interval"` // defaults to 1s
	StatsKey     string `mapstructure:"stats_key"`

	stats   *Stats
	logger  *zap.Logger
	client  *redis.Client
	limiter *redis_rate.Limiter
	policy  atomic.Pointer[policy]
	lastMod time.Time
	cancel  context.CancelFunc
	done    chan struct{}
}

func (s limitSpec) compile() (redis_rate.Limit, error) {
	p, err := time.ParseDuration(s.Period)
	if err != nil {
		return redis_rate.Limit{}, fmt.Errorf("invalid period %q: %w", s.Period, err)
	}
	if s.Rate <= 0 || s.Burst <= 0 || p <= 0 {
		return redis_rate.Limit{}, errors.New("rate, burst and period must be positive")
	}
	return redis_rate.Limit{Rate: s.Rate, Burst: s.Burst, Period: p}, nil
}

func (f limitsFile) compile(fallbackHeader string) (*policy, error) {
	p := &policy{
		header:    f.Header,
		customers: make(map[string]redis_rate.Limit, len(f.Customers)),
	}
	if p.header == "" {
		p.header = fallbackHeader
	}
	if f.Default != nil {
		l, err := f.Default.compile()
		if err != nil {
			return nil, fmt.Errorf("default: %w", err)
		}
		p.defaultLimit = &l
	}
	for name, spec := range f.Customers {
		if name == "" {
			return nil, errors.New("customer name must not be empty")
		}
		l, err := spec.compile()
		if err != nil {
			return nil, fmt.Errorf("customer %q: %w", name, err)
		}
		p.customers[name] = l
	}
	return p, nil
}

func (m *RateLimiter) Provision(ctx *core.ModuleContext) error {
	m.logger = ctx.Logger
	m.stats = StatsFor(m.StatsKey)
	m.stats.Provisions.Add(1)

	if m.KeyHeader == "" {
		m.KeyHeader = "X-Client-ID"
	}
	if m.KeyPrefix == "" {
		m.KeyPrefix = "cosmo_custom_rate_limit"
	}
	if m.RedisURL == "" {
		return errors.New("redis_url is required")
	}

	if m.LimitsFile != "" {
		if err := m.reloadLimits(); err != nil {
			return fmt.Errorf("failed to load limits file: %w", err)
		}
	} else {
		p, err := limitsFile{Default: &limitSpec{Rate: m.Rate, Burst: m.Burst, Period: m.Period}}.compile(m.KeyHeader)
		if err != nil {
			return err
		}
		m.policy.Store(p)
	}

	opts, err := redis.ParseURL(m.RedisURL)
	if err != nil {
		return fmt.Errorf("invalid redis_url: %w", err)
	}
	m.client = redis.NewClient(opts)
	if err := m.client.Ping(ctx).Err(); err != nil {
		_ = m.client.Close()
		return fmt.Errorf("failed to connect to redis: %w", err)
	}
	m.limiter = redis_rate.NewLimiter(m.client)

	if m.LimitsFile != "" {
		interval := time.Second
		if m.PollInterval != "" {
			d, err := time.ParseDuration(m.PollInterval)
			if err != nil {
				_ = m.client.Close()
				return fmt.Errorf("invalid poll_interval: %w", err)
			}
			interval = d
		}
		// Don't tie the watcher to ctx: Cleanup stops it explicitly.
		watchCtx, cancel := context.WithCancel(context.Background())
		m.cancel = cancel
		m.done = make(chan struct{})
		go m.watch(watchCtx, interval)
	}

	m.logPolicy("rate limiter provisioned", m.policy.Load())
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
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields() // catch typos like "custmers" instead of silently dropping them
	if err := dec.Decode(&lf); err != nil {
		return err
	}
	p, err := lf.compile(m.KeyHeader)
	if err != nil {
		return err
	}
	m.lastMod = fi.ModTime()
	old := m.policy.Swap(p)
	m.stats.FileReload.Add(1)
	if old != nil {
		m.logPolicy("rate limits reloaded", p)
	}
	return nil
}

func (m *RateLimiter) logPolicy(msg string, p *policy) {
	def := "unlimited"
	if p.defaultLimit != nil {
		def = p.defaultLimit.String()
	}
	m.logger.Info(msg,
		zap.String("header", p.header),
		zap.String("default", def),
		zap.Int("customers", len(p.customers)),
	)
}

func (m *RateLimiter) RouterOnRequest(ctx core.RequestContext, next http.Handler) {
	r := ctx.Request()
	p := m.policy.Load()
	customer := r.Header.Get(p.header)

	limit, ok := p.limitFor(customer)
	if !ok {
		next.ServeHTTP(ctx.ResponseWriter(), r)
		return
	}

	// Distinct namespaces so a customer literally named "anonymous" can't share
	// a budget with requests that have no header at all.
	key := m.KeyPrefix + ":anonymous"
	if customer != "" {
		key = m.KeyPrefix + ":c:" + customer
	}

	res, err := m.limiter.Allow(r.Context(), key, limit)
	if err != nil {
		// Fail closed, like the built-in limiter which surfaces the Redis error.
		m.logger.Error("rate limiter redis error", zap.Error(err))
		core.WriteResponseError(ctx, fmt.Errorf("rate limiter unavailable: %w", err))
		return
	}

	if res.Allowed == 0 {
		ctx.ResponseWriter().Header().Set("Retry-After", strconv.Itoa(int(res.RetryAfter.Round(time.Second).Seconds())))
		core.WriteResponseError(ctx, core.NewHttpGraphqlError("rate limit exceeded", "RATE_LIMIT_EXCEEDED", http.StatusTooManyRequests))
		return
	}

	next.ServeHTTP(ctx.ResponseWriter(), r)
}

func (m *RateLimiter) Cleanup() error {
	m.stats.Cleanups.Add(1)
	if m.cancel != nil {
		m.cancel()
		<-m.done
	}
	if m.client != nil {
		return m.client.Close()
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
