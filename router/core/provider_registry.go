package core

import (
	"fmt"

	"github.com/wundergraph/cosmo/router/pkg/config"
)

// ProviderRegistry indexes storage provider configurations by ID, providing
// typed lookups with clear error messages. It is built once during router
// initialization and shared across all subsystems that need to resolve a
// provider by its configured ID.
type ProviderRegistry struct {
	s3         map[string]config.S3StorageProvider
	cdn        map[string]config.CDNStorageProvider
	redis      map[string]config.RedisStorageProvider
	fileSystem map[string]config.FileSystemStorageProvider
}

// NewProviderRegistry builds lookup maps for every provider type and returns
// an error if any type contains duplicate IDs.
func NewProviderRegistry(providers config.StorageProviders) (*ProviderRegistry, error) {
	r := &ProviderRegistry{
		s3:         make(map[string]config.S3StorageProvider, len(providers.S3)),
		cdn:        make(map[string]config.CDNStorageProvider, len(providers.CDN)),
		redis:      make(map[string]config.RedisStorageProvider, len(providers.Redis)),
		fileSystem: make(map[string]config.FileSystemStorageProvider, len(providers.FileSystem)),
	}

	for _, p := range providers.S3 {
		if _, ok := r.s3[p.ID]; ok {
			return nil, fmt.Errorf("duplicate s3 storage provider with id '%s'", p.ID)
		}
		r.s3[p.ID] = p
	}
	for _, p := range providers.CDN {
		if _, ok := r.cdn[p.ID]; ok {
			return nil, fmt.Errorf("duplicate cdn storage provider with id '%s'", p.ID)
		}
		r.cdn[p.ID] = p
	}
	for _, p := range providers.Redis {
		if _, ok := r.redis[p.ID]; ok {
			return nil, fmt.Errorf("duplicate Redis storage provider with id '%s'", p.ID)
		}
		r.redis[p.ID] = p
	}
	for _, p := range providers.FileSystem {
		if _, ok := r.fileSystem[p.ID]; ok {
			return nil, fmt.Errorf("duplicate file system storage provider with id '%s'", p.ID)
		}
		r.fileSystem[p.ID] = p
	}

	return r, nil
}

// S3 looks up an S3 provider by ID.
func (r *ProviderRegistry) S3(id string) (config.S3StorageProvider, bool) {
	p, ok := r.s3[id]
	return p, ok
}

// CDN looks up a CDN provider by ID.
func (r *ProviderRegistry) CDN(id string) (config.CDNStorageProvider, bool) {
	p, ok := r.cdn[id]
	return p, ok
}

// Redis looks up a Redis provider by ID.
func (r *ProviderRegistry) Redis(id string) (config.RedisStorageProvider, bool) {
	p, ok := r.redis[id]
	return p, ok
}

// FileSystem looks up a filesystem provider by ID.
func (r *ProviderRegistry) FileSystem(id string) (config.FileSystemStorageProvider, bool) {
	p, ok := r.fileSystem[id]
	return p, ok
}

// IsFileSystem returns true if the given ID matches a filesystem provider.
func (r *ProviderRegistry) IsFileSystem(id string) bool {
	_, ok := r.fileSystem[id]
	return ok
}
