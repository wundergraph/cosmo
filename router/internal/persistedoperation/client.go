package persistedoperation

import "context"

type PersistentOperationNotFoundError interface {
	error
	ClientName() string
	Sha256Hash() string
}

type Client interface {
	PersistedOperation(ctx context.Context, clientName string, sha256Hash string) ([]byte, error)
	Close()
}
