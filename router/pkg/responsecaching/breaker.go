package responsecaching

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
	"go.uber.org/zap"
)

// ErrUnavailable is returned, without reaching the store, while it is down.
var ErrUnavailable = errors.New("response cache storage is down")

type BreakerOptions struct {
	// FailureThreshold consecutive failures mark the store down.
	FailureThreshold int
	// ProbeInterval is how often a down store is pinged; it also bounds each ping.
	ProbeInterval time.Duration
	// Ping reaches the store; success marks it up.
	Ping func(ctx context.Context) error
	// IsFailure reports whether err means the store is unreachable, not that one call failed.
	IsFailure func(err error) bool
	// StartDown starts the store down, e.g. after a failed startup ping.
	StartDown bool
	Logger    *zap.Logger
}

type breakerStore struct {
	inner    Store
	opts     BreakerOptions
	down     atomic.Bool
	failures atomic.Int64

	// probeCtx is cancelled on Close, stopping the probe.
	probeCtx    context.Context
	cancelProbe context.CancelFunc
	// mu orders starting a probe against Close.
	mu     sync.Mutex
	closed bool
	probes sync.WaitGroup
}

// NewBreakerStore bypasses inner while it is down: calls fail fast with
// ErrUnavailable and a background ping brings it back.
func NewBreakerStore(inner Store, opts BreakerOptions) Store {
	if opts.Logger == nil {
		opts.Logger = zap.NewNop()
	}
	if opts.FailureThreshold < 1 {
		opts.FailureThreshold = 1
	}
	s := &breakerStore{inner: inner, opts: opts}
	s.probeCtx, s.cancelProbe = context.WithCancel(context.Background())
	if opts.StartDown {
		s.trip()
	}
	return s
}

func (s *breakerStore) GetMany(ctx context.Context, keys []string) (map[string]caching.Item, error) {
	if s.down.Load() {
		return nil, ErrUnavailable
	}
	found, err := s.inner.GetMany(ctx, keys)
	s.observe(ctx, err)
	return found, err
}

func (s *breakerStore) SetMany(ctx context.Context, items []caching.Item) error {
	if s.down.Load() {
		return ErrUnavailable
	}
	err := s.inner.SetMany(ctx, items)
	s.observe(ctx, err)
	return err
}

func (s *breakerStore) InvalidateByTags(ctx context.Context, tags []string) (int, error) {
	if s.down.Load() {
		return 0, ErrUnavailable
	}
	removed, err := s.inner.InvalidateByTags(ctx, tags)
	s.observe(ctx, err)
	return removed, err
}

func (s *breakerStore) Close() error {
	s.mu.Lock()
	s.closed = true
	s.cancelProbe()
	s.mu.Unlock()
	s.probes.Wait()
	return s.inner.Close()
}

func (s *breakerStore) observe(ctx context.Context, err error) {
	switch {
	case err == nil:
		// Load first: a store on every success contends the hot path.
		if s.failures.Load() != 0 {
			s.failures.Store(0)
		}
	case ctx.Err() != nil:
		// The caller is gone, which says nothing about the store.
	case s.opts.IsFailure(err):
		if s.failures.Add(1) >= int64(s.opts.FailureThreshold) {
			s.trip()
		}
	}
}

// trip marks the store down and starts probing it.
func (s *breakerStore) trip() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || !s.down.CompareAndSwap(false, true) {
		return
	}
	s.opts.Logger.Warn("Response cache storage is down, bypassing it until it answers a ping",
		zap.Duration("probe_interval", s.opts.ProbeInterval))
	s.probes.Add(1)
	go s.probe()
}

func (s *breakerStore) probe() {
	defer s.probes.Done()
	ticker := time.NewTicker(s.opts.ProbeInterval)
	defer ticker.Stop()

	for {
		select {
		case <-s.probeCtx.Done():
			return
		case <-ticker.C:
		}

		ctx, cancel := context.WithTimeout(s.probeCtx, s.opts.ProbeInterval)
		err := s.opts.Ping(ctx)
		cancel()
		if err != nil {
			continue
		}

		s.failures.Store(0)
		s.down.Store(false)
		s.opts.Logger.Info("Response cache storage is back, no longer bypassing it")
		return
	}
}
