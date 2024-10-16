package persistedoperation

import (
	"context"
	"fmt"
	"github.com/wundergraph/cosmo/router/pkg/clientinfo"
	"go.opentelemetry.io/otel/attribute"
)

type PersistentOperationNotFoundError struct {
	ClientName string
	Sha256Hash string
}

func (e *PersistentOperationNotFoundError) Error() string {
	return fmt.Sprintf("operation %s for client %s not found", e.Sha256Hash, e.ClientName)
}

type Client interface {
	PersistedOperation(ctx context.Context, clientInfo clientinfo.DetailedClientInfo, sha256Hash string, attributes []attribute.KeyValue) ([]byte, error)
	Close()
}
