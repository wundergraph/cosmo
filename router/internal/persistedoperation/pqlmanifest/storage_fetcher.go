package pqlmanifest

import (
	"context"

	"go.uber.org/zap"
)

// StorageFetcher adapts a ReadManifest-style function (e.g. from an S3 or CDN
// storage client) to the ManifestFetcher interface used by the Poller.
// Unlike the CDN Fetcher which uses HTTP ETags for conditional requests,
// StorageFetcher always downloads the manifest and compares the revision field
// to determine whether it changed.
type StorageFetcher struct {
	readManifest func(ctx context.Context, objectPath string) (*Manifest, error)
	objectPath   string
	logger       *zap.Logger
}

func NewStorageFetcher(
	readManifest func(ctx context.Context, objectPath string) (*Manifest, error),
	objectPath string,
	logger *zap.Logger,
) *StorageFetcher {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &StorageFetcher{
		readManifest: readManifest,
		objectPath:   objectPath,
		logger:       logger.With(zap.String("component", "pql_storage_fetcher")),
	}
}

func (f *StorageFetcher) Fetch(ctx context.Context, currentRevision string) (*Manifest, bool, error) {
	manifest, err := f.readManifest(ctx, f.objectPath)
	if err != nil {
		return nil, false, err
	}

	if manifest.Revision == currentRevision {
		return nil, false, nil
	}

	return manifest, true, nil
}
