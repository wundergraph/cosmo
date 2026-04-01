package pqlmanifest

import (
	"context"
	"time"

	"go.uber.org/zap"
)

// ManifestReaderFunc reads and parses a PQL manifest from storage at the given path.
// When modifiedSince is non-zero, the implementation may skip the download if the
// object has not been modified (returning nil, nil). A zero modifiedSince means
// "fetch unconditionally".
type ManifestReaderFunc func(ctx context.Context, objectPath string, modifiedSince time.Time) (*Manifest, error)

// StorageFetcher adapts a ManifestReaderFunc (e.g. from an S3 or CDN
// storage client) to the ManifestFetcher interface used by the Poller.
// It uses If-Modified-Since for conditional requests when the underlying
// storage supports it, and falls back to revision comparison otherwise.
type StorageFetcher struct {
	readManifest  ManifestReaderFunc
	objectPath    string
	logger        *zap.Logger
	lastFetchedAt time.Time
}

func NewStorageFetcher(
	readManifest ManifestReaderFunc,
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
	manifest, err := f.readManifest(ctx, f.objectPath, f.lastFetchedAt)
	if err != nil {
		return nil, false, err
	}

	// nil manifest with no error means "not modified" (e.g. S3 returned 304).
	if manifest == nil {
		return nil, false, nil
	}

	f.lastFetchedAt = time.Now()

	if manifest.Revision == currentRevision {
		return nil, false, nil
	}

	return manifest, true, nil
}
