package pqlmanifest

import (
	"context"
	"math/rand"
	"time"

	"go.uber.org/zap"
)

type Poller struct {
	fetcher      *Fetcher
	pollInterval time.Duration
	pollJitter   time.Duration
	logger       *zap.Logger
}

func NewPoller(fetcher *Fetcher, pollInterval, pollJitter time.Duration, logger *zap.Logger) *Poller {
	if pollJitter <= 0 {
		pollJitter = 5 * time.Second
	}
	if pollInterval <= 0 {
		pollInterval = 10 * time.Second
	}
	if logger == nil {
		logger = zap.NewNop()
	}
	return &Poller{
		fetcher:      fetcher,
		pollInterval: pollInterval,
		pollJitter:   pollJitter,
		logger:       logger,
	}
}

// FetchInitial performs a blocking initial fetch, called at startup.
func (p *Poller) FetchInitial(ctx context.Context) error {
	manifest, changed, err := p.fetcher.Fetch(ctx, "")
	if err != nil {
		return err
	}

	if changed && manifest != nil {
		p.fetcher.Store().Load(manifest)
		p.logger.Info("Loaded initial PQL manifest",
			zap.String("revision", manifest.Revision),
			zap.Int("operation_count", len(manifest.Operations)),
		)
	}

	return nil
}

// Poll runs a background goroutine loop that periodically fetches the manifest.
// It sleeps for pollInterval + random jitter, fetches, and if changed updates the store.
// It exits when ctx is cancelled.
func (p *Poller) Poll(ctx context.Context) {
	store := p.fetcher.Store()
	for {
		jitter := time.Duration(rand.Int63n(int64(p.pollJitter + 1)))
		sleepDuration := p.pollInterval + jitter

		select {
		case <-ctx.Done():
			return
		case <-time.After(sleepDuration):
		}

		currentRevision := store.Revision()
		manifest, changed, err := p.fetcher.Fetch(ctx, currentRevision)
		if err != nil {
			p.logger.Warn("Failed to fetch PQL manifest", zap.Error(err))
			continue
		}

		if changed && manifest != nil {
			store.Load(manifest)
			p.logger.Debug("Updated PQL manifest",
				zap.String("revision", manifest.Revision),
				zap.String("previous_revision", currentRevision),
				zap.Int("operation_count", len(manifest.Operations)),
			)
		}
	}
}
