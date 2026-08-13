package querygen

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"

	"connectrpc.com/connect"
	"go.uber.org/zap"

	yokov1 "github.com/wundergraph/cosmo/router/gen/proto/yoko/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/yoko/v1/yokov1connect"
)

var (
	// ErrIndexNotReady means that no address is adopted yet. The first build is
	// still in flight, or the first build failed.
	ErrIndexNotReady = errors.New("schema index is not ready")
)

// Address computes the content address of an SDL. The service uses the same
// rule, so the router never has to ask for it.
func Address(sdl string) string {
	sum := sha256.Sum256([]byte(sdl))
	return "sha256:" + hex.EncodeToString(sum[:])
}

// Indexer keeps one schema indexed in the discovery service.
//
// The indexer adopts a new address only when that address is READY. The
// previous address keeps serving until then, so a router config reload never
// breaks a working tool.
type Indexer struct {
	client yokov1connect.YokoServiceClient
	cfg    Config
	logger *zap.Logger

	mu sync.RWMutex
	// address is the adopted READY address. It is empty until the first
	// successful build.
	address string
	// pending is the address of the build in flight, if any.
	pending string
	// lastErr records why the most recent build did not finish.
	lastErr error
	// cancelPoll stops the poll goroutine of the previous Sync.
	cancelPoll context.CancelFunc
	// sdl and baseCtx let Resync rebuild an index that the service dropped.
	sdl     string
	baseCtx context.Context
}

// NewIndexer builds an indexer. The caller must call Validate on the config
// first.
func NewIndexer(cfg Config) *Indexer {
	cfg = cfg.withDefaults()
	return &Indexer{
		client: newClient(cfg),
		cfg:    cfg,
		logger: cfg.Logger,
	}
}

// Sync makes the discovery service hold an index for this SDL.
//
// Sync never blocks on the network. It compares the local hash and returns. All
// calls to the service happen in a goroutine, so a slow or unreachable service
// cannot delay a router config reload.
func (i *Indexer) Sync(ctx context.Context, sdl string) {
	want := Address(sdl)

	i.mu.Lock()
	if i.address == want && i.pending == "" {
		// The schema did not change and the index already serves. Make no
		// network call at all.
		i.mu.Unlock()
		return
	}
	if i.pending == want {
		// A build for this exact schema is already in flight.
		i.mu.Unlock()
		return
	}
	// A different schema arrived. Stop the previous poll.
	if i.cancelPoll != nil {
		i.cancelPoll()
	}
	pollCtx, cancel := context.WithCancel(ctx)
	i.cancelPoll = cancel
	i.pending = want
	i.sdl = sdl
	i.baseCtx = ctx
	i.mu.Unlock()

	go i.build(pollCtx, sdl, want)
}

// Resync rebuilds the index after the service reports that it is gone.
//
// The service deletes an index that nothing uses for 30 days. The schema then
// produces the same address again, so this recovers without any operator
// action. Resync does nothing while another build is in flight.
func (i *Indexer) Resync() {
	i.mu.Lock()
	if i.sdl == "" || i.pending != "" {
		i.mu.Unlock()
		return
	}
	sdl, baseCtx := i.sdl, i.baseCtx
	// Drop the adopted address. It no longer exists in the service.
	i.address = ""
	want := Address(sdl)
	if i.cancelPoll != nil {
		i.cancelPoll()
	}
	pollCtx, cancel := context.WithCancel(baseCtx)
	i.cancelPoll = cancel
	i.pending = want
	i.mu.Unlock()

	go i.build(pollCtx, sdl, want)
}

// build sends the schema and then waits for the index to become servable.
func (i *Indexer) build(ctx context.Context, sdl, want string) {
	log := i.logger.With(zap.String("index_id", want))

	res, err := i.client.EnsureIndex(ctx, connect.NewRequest(&yokov1.EnsureIndexRequest{Sdl: sdl}))
	if err != nil {
		if ctx.Err() != nil {
			return // a newer Sync replaced this build
		}
		i.fail(want, fmt.Errorf("failed to send the schema: %w", err))
		log.Error("failed to send the schema to the discovery service", zap.Error(err))
		return
	}

	idx := res.Msg.GetIndex()
	if got := idx.GetIndexId(); got != want {
		// The service disagrees about the address. Trust the service, because
		// it holds the index, but record the difference.
		log.Warn("the discovery service returned a different address",
			zap.String("returned_index_id", got))
		want = got
	}

	if idx.GetStatus() == yokov1.IndexStatus_INDEX_STATUS_READY {
		i.adopt(want, idx)
		log.Info("schema index is ready",
			zap.Int64("symbol_count", idx.GetSymbolCount()))
		return
	}

	log.Info("schema index is building")
	i.poll(ctx, want, log)
}

// poll waits for a final status, or gives up at IndexTimeout.
func (i *Indexer) poll(ctx context.Context, want string, log *zap.Logger) {
	deadline := time.NewTimer(i.cfg.IndexTimeout)
	defer deadline.Stop()

	ticker := time.NewTicker(i.cfg.IndexPollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return // shutdown, or a newer Sync replaced this build
		case <-deadline.C:
			i.fail(want, fmt.Errorf("the index did not become ready within %s", i.cfg.IndexTimeout))
			log.Error("gave up waiting for the schema index",
				zap.Duration("index_timeout", i.cfg.IndexTimeout))
			return
		case <-ticker.C:
			res, err := i.client.GetIndex(ctx, connect.NewRequest(&yokov1.GetIndexRequest{IndexId: want}))
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				// A single read failure is not final. Keep polling until the
				// deadline.
				log.Debug("failed to read the index status", zap.Error(err))
				continue
			}

			idx := res.Msg.GetIndex()
			switch idx.GetStatus() {
			case yokov1.IndexStatus_INDEX_STATUS_READY:
				i.adopt(want, idx)
				log.Info("schema index is ready",
					zap.Int64("symbol_count", idx.GetSymbolCount()))
				return
			case yokov1.IndexStatus_INDEX_STATUS_FAILED:
				i.fail(want, fmt.Errorf("the index build failed: %s", idx.GetError()))
				log.Error("the schema index build failed",
					zap.String("service_error", idx.GetError()))
				return
			}
		}
	}
}

// adopt makes an address serve requests.
func (i *Indexer) adopt(address string, idx *yokov1.Index) {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.address = address
	i.pending = ""
	i.lastErr = nil

	if idx.GetStale() {
		// The service schedules the rebuild itself. The index still serves.
		i.logger.Info("the schema index is stale and the service will rebuild it",
			zap.String("index_id", address))
	}
}

// fail records why a build did not finish. It leaves any adopted address in
// place, so an older index keeps serving.
func (i *Indexer) fail(address string, err error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.pending == address {
		i.pending = ""
	}
	i.lastErr = err
}

// CurrentAddress returns the address that serves requests.
//
// It returns ErrIndexNotReady when no address is adopted yet. The error names
// the reason when a build failed.
func (i *Indexer) CurrentAddress() (string, error) {
	i.mu.RLock()
	defer i.mu.RUnlock()

	if i.address != "" {
		return i.address, nil
	}
	if i.lastErr != nil {
		return "", fmt.Errorf("%w: %w", ErrIndexNotReady, i.lastErr)
	}
	return "", ErrIndexNotReady
}
