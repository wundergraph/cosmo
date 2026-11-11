package operationmanifest

import (
	"context"
	"math/rand"
	"time"

	"go.uber.org/zap"
)

// Loader fetches raw manifest data for the Poller. It returns changed=false
// when the storage reports the data unchanged since the last fetch.
type Loader interface {
	Fetch(ctx context.Context, currentRevision string) ([]byte, bool, error)
}

// ParseFunc parses and validates raw manifest data and returns its revision.
type ParseFunc[T any] func(data []byte) (T, string, error)

// Target holds the current manifest for the Poller.
type Target[T any] interface {
	Load(manifest T)
	Revision() string
}

type Poller[T any] struct {
	loader       Loader
	parse        ParseFunc[T]
	target       Target[T]
	pollInterval time.Duration
	pollJitter   time.Duration
	logger       *zap.Logger
}

// NewPoller creates a poller that fetches every pollInterval plus a random
// jitter of up to pollJitter. A pollJitter of zero disables the jitter.
func NewPoller[T any](loader Loader, parse ParseFunc[T], target Target[T], pollInterval, pollJitter time.Duration, logger *zap.Logger) *Poller[T] {
	if pollInterval <= 0 {
		pollInterval = 10 * time.Second
	}
	if logger == nil {
		logger = zap.NewNop()
	}
	return &Poller[T]{
		loader:       loader,
		parse:        parse,
		target:       target,
		pollInterval: pollInterval,
		pollJitter:   pollJitter,
		logger:       logger,
	}
}

// FetchInitial performs a blocking initial fetch, called at startup.
func (p *Poller[T]) FetchInitial(ctx context.Context) error {
	_, err := p.fetch(ctx)
	return err
}

// Poll runs a background goroutine loop that periodically fetches the manifest.
// It sleeps for pollInterval + random jitter, fetches, and if changed updates the target.
// A manifest that fails to fetch or parse leaves the current one in place.
// It exits when ctx is cancelled.
func (p *Poller[T]) Poll(ctx context.Context) {
	for {
		jitter := time.Duration(rand.Int63n(int64(p.pollJitter) + 1))
		sleepDuration := p.pollInterval + jitter

		select {
		case <-ctx.Done():
			return
		case <-time.After(sleepDuration):
		}

		previousRevision := p.target.Revision()
		changed, err := p.fetch(ctx)
		if err != nil {
			p.logger.Warn("Failed to fetch manifest", zap.Error(err))
			continue
		}

		if changed {
			p.logger.Debug("Updated manifest",
				zap.String("revision", p.target.Revision()),
				zap.String("previous_revision", previousRevision),
			)
		} else {
			p.logger.Debug("Manifest unchanged, skipping update",
				zap.String("previous_revision", previousRevision),
			)
		}
	}
}

func (p *Poller[T]) fetch(ctx context.Context) (bool, error) {
	currentRevision := p.target.Revision()
	data, changed, err := p.loader.Fetch(ctx, currentRevision)
	if err != nil || !changed {
		return false, err
	}

	manifest, revision, err := p.parse(data)
	if err != nil {
		return false, err
	}
	if revision == currentRevision {
		return false, nil
	}

	p.target.Load(manifest)
	return true, nil
}
