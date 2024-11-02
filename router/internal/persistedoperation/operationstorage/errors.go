package operationstorage

import "fmt"

var PoNotFoundErr *PersistentOperationNotFoundError

type PersistentOperationNotFoundError struct {
	ClientName string
	Sha256Hash string
}

func (e PersistentOperationNotFoundError) Error() string {
	return fmt.Sprintf("operation %s for client %s not found", e.Sha256Hash, e.ClientName)
}
