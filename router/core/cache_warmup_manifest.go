package core

import (
	"context"
	"slices"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/pqlmanifest"
	"go.uber.org/zap"
)

var _ CacheWarmupSource = (*ManifestWarmupSource)(nil)

type ManifestWarmupSource struct {
	store                    *pqlmanifest.Store
	allowMismatchedSHA256IDs bool
}

func NewManifestWarmupSource(store *pqlmanifest.Store, allowMismatchedSHA256IDs bool) *ManifestWarmupSource {
	return &ManifestWarmupSource{
		store:                    store,
		allowMismatchedSHA256IDs: allowMismatchedSHA256IDs,
	}
}

func (s *ManifestWarmupSource) LoadItems(ctx context.Context, log *zap.Logger) ([]*nodev1.Operation, error) {
	ops := s.store.AllOperations()
	if len(ops) == 0 {
		log.Debug("No operations in PQL manifest for warmup")
		return nil, nil
	}

	items := make([]*nodev1.Operation, 0, len(ops))
	var mismatchedIDs []string
	for sha256Hash, body := range ops {
		matches := persistedoperation.OperationIDMatchesBody(sha256Hash, body)
		// Requests reject these at lookup, so warming them would let cache hits bypass that.
		if !matches && !s.allowMismatchedSHA256IDs {
			log.Warn("Skipping PQL manifest operation whose SHA256 ID doesn't match its body", zap.String("id", sha256Hash))
			continue
		}
		if !matches {
			mismatchedIDs = append(mismatchedIDs, sha256Hash)
		}
		items = append(items, &nodev1.Operation{
			Request: &nodev1.OperationRequest{
				Query: body,
				Extensions: &nodev1.Extension{
					PersistedQuery: &nodev1.PersistedQuery{
						Sha256Hash: sha256Hash,
						Version:    1,
					},
				},
			},
		})
	}

	if len(mismatchedIDs) > 0 {
		// One entry per warmup lists what is left to migrate without flooding the log.
		slices.Sort(mismatchedIDs)
		log.Warn("Serving PQL manifest operations whose SHA256 ID doesn't match their body",
			zap.Int("count", len(mismatchedIDs)), zap.Strings("ids", mismatchedIDs))
	}

	log.Debug("Loaded PQL manifest operations for warmup", zap.Int("count", len(items)))
	return items, nil
}
