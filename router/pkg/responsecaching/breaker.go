package responsecaching

import (
	"context"
	"errors"
	"sync/atomic"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
	"go.uber.org/zap"
)

// ErrUnavailable is returned, without reaching the store, while it is down.
var ErrUnavailable = errors.New("response cache storage is down")

const (
	defaultProbeInterval = time.Second
	// maxProbeInterval caps how long a recovered store stays bypassed.
	maxProbeInterval = time.Minute
)

// probeKeys is what the probe looks up; a miss is a healthy answer.
var probeKeys = []string{"circuit_breaker_probe"}

type BreakerOptions struct {
	// FailureThreshold consecutive failures, of requests or probes, mark the store down.
	FailureThreshold int
	// ProbeInterval is how often the store is probed, up or down.
	ProbeInterval time.Duration
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
	probeDone   chan struct{}
}

// NewBreakerStore bypasses inner while it is down: calls fail fast with
// ErrUnavailable. A background lookup through inner, so bounded by its
// timeouts, marks it down early and brings it back.
func NewBreakerStore(inner Store, opts BreakerOptions) Store {
	if opts.Logger == nil {
		opts.Logger = zap.NewNop()
	}
	opts.FailureThreshold = max(opts.FailureThreshold, 1)
	if opts.ProbeInterval <= 0 {
		opts.ProbeInterval = defaultProbeInterval
	}
	opts.ProbeInterval = min(opts.ProbeInterval, maxProbeInterval)

	s := &breakerStore{inner: inner, opts: opts, probeDone: make(chan struct{})}
	s.probeCtx, s.cancelProbe = context.WithCancel(context.Background())
	if opts.StartDown {
		s.markDown()
	}
	go s.probe()
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
	s.cancelProbe()
	<-s.probeDone
	return s.inner.Close()
}

// observe counts a request's outcome. Only the probe brings the store back.
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
		s.fail()
	}
}

func (s *breakerStore) probe() {
	defer close(s.probeDone)
	ticker := time.NewTicker(s.opts.ProbeInterval)
	defer ticker.Stop()

	for {
		select {
		case <-s.probeCtx.Done():
			return
		case <-ticker.C:
		}

		_, err := s.inner.GetMany(s.probeCtx, probeKeys)
		switch {
		case s.probeCtx.Err() != nil:
			return
		case err != nil && s.opts.IsFailure(err):
			s.fail()
		default:
			s.failures.Store(0)
			s.markUp()
		}
	}
}

func (s *breakerStore) fail() {
	if s.failures.Add(1) >= int64(s.opts.FailureThreshold) {
		s.markDown()
	}
}

func (s *breakerStore) markDown() {
	if s.down.CompareAndSwap(false, true) {
		s.opts.Logger.Warn("Response cache storage is down, bypassing it until a probe succeeds",
			zap.Duration("probe_interval", s.opts.ProbeInterval))
	}
}

func (s *breakerStore) markUp() {
	if s.down.CompareAndSwap(true, false) {
		s.opts.Logger.Info("Response cache storage is back, no longer bypassing it")
	}
}
