package apq

import (
	"context"
	"errors"
	"time"

	"github.com/wundergraph/cosmo/router/internal/persistedoperation/operationstorage"
)

type memoryStore struct {
	cache *operationstorage.OperationsCache
	ttl   time.Duration
}

func NewMemoryStore(cacheSize int64, ttl time.Duration) (*memoryStore, error) {
	if cacheSize <= 0 {
		return nil, errors.New("cache size must be positive")
	}

	cache, err := operationstorage.NewOperationsCache(cacheSize)
	if err != nil {
		return nil, err
	}
	return &memoryStore{
		cache: cache,
		ttl:   ttl,
	}, nil
}

func (m *memoryStore) Get(_ context.Context, operationHash string) ([]byte, error) {
	return m.cache.Get("", operationHash), nil
}

func (m *memoryStore) Set(_ context.Context, operationHash string, operationBody []byte) error {
	m.cache.Set("", operationHash, operationBody, m.ttl)
	return nil
}

func (m *memoryStore) Renew(_ context.Context, operationHash string) error {
	operationBody := m.cache.Get("", operationHash)
	if len(operationBody) > 0 {
		m.cache.Set("", operationHash, operationBody, m.ttl)
	}
	return nil
}

func (m *memoryStore) IsDistributed() bool {
	return false
}

func (m *memoryStore) Close() error {
	m.cache.Cache.Close()
	return nil
}
