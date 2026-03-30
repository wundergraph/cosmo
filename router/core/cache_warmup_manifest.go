package core

import (
	"context"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation/pqlmanifest"
	"go.uber.org/zap"
)

var _ CacheWarmupSource = (*ManifestWarmupSource)(nil)

type ManifestWarmupSource struct {
	store *pqlmanifest.Store
}

func NewManifestWarmupSource(store *pqlmanifest.Store) *ManifestWarmupSource {
	return &ManifestWarmupSource{
		store: store,
	}
}

func (s *ManifestWarmupSource) LoadItems(ctx context.Context, log *zap.Logger) ([]*nodev1.Operation, error) {
	ops := s.store.AllOperations()
	if len(ops) == 0 {
		log.Debug("No operations in PQL manifest for warmup")
		return nil, nil
	}

	items := make([]*nodev1.Operation, 0, len(ops))
	for sha256Hash, body := range ops {
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

	log.Debug("Loaded PQL manifest operations for warmup", zap.Int("count", len(items)))
	return items, nil
}
