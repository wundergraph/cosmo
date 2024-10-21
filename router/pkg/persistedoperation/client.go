package persistedoperation

import (
	"context"
	"fmt"
	"github.com/wundergraph/cosmo/router/pkg/client"
)

type PersistentOperationNotFoundError struct {
	ClientName string
	Sha256Hash string
}

func (e *PersistentOperationNotFoundError) Error() string {
	return fmt.Sprintf("operation %s for client %s not found", e.Sha256Hash, e.ClientName)
}

type Client interface {
	PersistedOperation(ctx context.Context, clientInfo client.Info, sha256Hash string) ([]byte, error)
	Close()
}
