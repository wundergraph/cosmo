package persistedoperation

import (
	"context"
	"go.opentelemetry.io/otel/attribute"
)

type PersistentOperationNotFoundError interface {
	error
	ClientName() string
	Sha256Hash() string
}

type Client interface {
	PersistedOperation(ctx context.Context, clientName string, sha256Hash string, attributes []attribute.KeyValue) ([]byte, error)
	Close()
}
