package fs

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
)

type client struct {
	path    string
	options *Options
}

var _ persistedoperation.StorageClient = (*client)(nil)

type Options struct {
	ObjectPathPrefix string
}

// NewClient creates a new FileStorage client that can be used to retrieve persisted operations
func NewClient(path string, options *Options) (*client, error) {
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("failed to get absolute storage path: %w", err)
	}

	client := &client{
		path:    absolutePath,
		options: options,
	}

	return client, nil
}

func (c client) PersistedOperation(ctx context.Context, clientName, sha256Hash string) ([]byte, error) {
	content, err := c.persistedOperation(clientName, sha256Hash)
	if err != nil {
		return nil, err
	}

	return content, nil
}

func (c client) persistedOperation(clientName string, sha256Hash string) ([]byte, error) {
	operationName := fmt.Sprintf("%s.json", sha256Hash)
	objectPath := filepath.Join(c.path, c.options.ObjectPathPrefix, operationName)

	content, err := os.ReadFile(objectPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, &persistedoperation.PersistentOperationNotFoundError{
				ClientName: clientName,
				Sha256Hash: sha256Hash,
			}
		}
		return nil, fmt.Errorf("failed to read persisted operation: %w", err)
	}

	var po persistedoperation.PersistedOperation
	err = json.Unmarshal(content, &po)
	if err != nil {
		return nil, err
	}

	return []byte(po.Body), nil
}

func (c client) Close() {}
