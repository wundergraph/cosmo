package responsecaching

import (
	"context"
	"errors"
	"time"

	"github.com/cep21/circuit/v4"
	"github.com/cep21/circuit/v4/closers/simplelogic"
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
	inner   Store
	opts    BreakerOptions
	circuit *circuit.Circuit

	// probeCtx is cancelled on Close, stopping the probe.
	probeCtx    context.Context
	cancelProbe context.CancelFunc
	probeDone   chan struct{}
}

// NewBreakerStore bypasses inner while it is down: calls fail fast with
// ErrUnavailable and a background ping brings it back.
func NewBreakerStore(inner Store, opts BreakerOptions) Store {
	if opts.Logger == nil {
		opts.Logger = zap.NewNop()
	}
	s := &breakerStore{inner: inner, opts: opts}
	s.probeCtx, s.cancelProbe = context.WithCancel(context.Background())
	s.circuit = circuit.NewCircuitFromConfig("response_cache_storage", circuit.Config{
		General: circuit.GeneralConfig{
			ClosedToOpenFactory: simplelogic.ConsecutiveErrOpenerFactory(simplelogic.ConfigConsecutiveErrOpener{
				ErrorThreshold: int64(max(opts.FailureThreshold, 1)),
			}),
			// OpenToClosed left at its default, which lets no request through:
			// only the probe closes the circuit.
		},
		Execution: circuit.ExecutionConfig{
			// The timeout store bounds calls; nothing to cap here.
			Timeout:               -1,
			MaxConcurrentRequests: -1,
		},
		Metrics: circuit.MetricsCollectors{
			Circuit: []circuit.Metrics{stateListener{s}},
		},
	})
	if opts.StartDown {
		s.circuit.OpenCircuit(context.Background())
	}
	s.probeDone = make(chan struct{})
	go s.probe()
	return s
}

func (s *breakerStore) GetMany(ctx context.Context, keys []string) (found map[string]caching.Item, err error) {
	err = s.run(ctx, func(ctx context.Context) error {
		found, err = s.inner.GetMany(ctx, keys)
		return err
	})
	return found, err
}

func (s *breakerStore) SetMany(ctx context.Context, items []caching.Item) error {
	return s.run(ctx, func(ctx context.Context) error {
		return s.inner.SetMany(ctx, items)
	})
}

func (s *breakerStore) InvalidateByTags(ctx context.Context, tags []string) (removed int, err error) {
	err = s.run(ctx, func(ctx context.Context) error {
		removed, err = s.inner.InvalidateByTags(ctx, tags)
		return err
	})
	return removed, err
}

func (s *breakerStore) Close() error {
	s.cancelProbe()
	<-s.probeDone
	return s.inner.Close()
}

// run calls fn through the circuit. A cancelled caller counts as an
// interrupt, not a failure.
func (s *breakerStore) run(ctx context.Context, fn func(ctx context.Context) error) error {
	err := s.circuit.Run(ctx, func(ctx context.Context) error {
		err := fn(ctx)
		if err != nil && !s.opts.IsFailure(err) {
			return notFailure{err}
		}
		return err
	})

	var (
		nf      notFailure
		circErr circuit.Error
	)
	switch {
	case errors.As(err, &nf):
		return nf.err
	case errors.As(err, &circErr) && circErr.CircuitOpen():
		return ErrUnavailable
	default:
		return err
	}
}

// notFailure is an error the circuit must not count against the store.
type notFailure struct{ err error }

func (e notFailure) Error() string    { return e.err.Error() }
func (e notFailure) Unwrap() error    { return e.err }
func (e notFailure) BadRequest() bool { return true }

// probe pings while the circuit is open and closes it once the store answers.
// One for the store's lifetime: the circuit can fire Opened twice.
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
		if !s.circuit.IsOpen() {
			continue
		}

		ctx, cancel := context.WithTimeout(s.probeCtx, s.opts.ProbeInterval)
		err := s.opts.Ping(ctx)
		cancel()
		if err == nil {
			s.circuit.CloseCircuit(s.probeCtx)
		}
	}
}

// stateListener logs the circuit opening and closing.
type stateListener struct{ s *breakerStore }

func (l stateListener) Opened(context.Context, time.Time) {
	l.s.opts.Logger.Warn("Response cache storage is down, bypassing it until it answers a ping",
		zap.Duration("probe_interval", l.s.opts.ProbeInterval))
}

func (l stateListener) Closed(context.Context, time.Time) {
	l.s.opts.Logger.Info("Response cache storage is back, no longer bypassing it")
}
