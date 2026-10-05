package operationmanifest

import (
	"context"
	"time"

	"go.uber.org/zap"
)

// Loader fetches the manifest for the Poller.
type Loader interface {
	Fetch(ctx context.Context, currentRevision string) (*Manifest, bool, error)
}

type Poller struct {
	loader       Loader
	pollInterval time.Duration
	logger       *zap.Logger
	store        *Store
}

func NewPoller(loader Loader, store *Store, pollInterval time.Duration, logger *zap.Logger) *Poller {
	if pollInterval <= 0 {
		pollInterval = 10 * time.Second
	}
	if logger == nil {
		logger = zap.NewNop()
	}
	return &Poller{
		loader:       loader,
		store:        store,
		pollInterval: pollInterval,
		logger:       logger,
	}
}

// FetchInitial performs a blocking initial fetch, called at startup.
func (p *Poller) FetchInitial(ctx context.Context) error {
	manifest, changed, err := p.loader.Fetch(ctx, "")
	if err != nil {
		return err
	}

	if changed && manifest != nil {
		p.store.Load(manifest)
	}

	return nil
}

// Poll runs a background goroutine loop that periodically fetches the manifest.
// It sleeps for pollInterval, fetches, and if changed updates the store.
// It exits when ctx is cancelled.
func (p *Poller) Poll(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(p.pollInterval):
		}

		currentRevision := p.store.Revision()
		manifest, changed, err := p.loader.Fetch(ctx, currentRevision)
		if err != nil {
			p.logger.Warn("Failed to fetch manifest", zap.Error(err))
			continue
		}

		if changed && manifest != nil {
			p.store.Load(manifest)
			p.logger.Debug("Updated manifest",
				zap.String("revision", manifest.Revision),
				zap.String("previous_revision", currentRevision),
				zap.Int("operation_count", len(manifest.Operations)),
			)
		} else {
			p.logger.Debug("Manifest unchanged, skipping update",
				zap.String("previous_revision", currentRevision),
			)
		}
	}
}
