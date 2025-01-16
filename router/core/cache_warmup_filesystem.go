package core

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"
)

type FileSystemSourceConfig struct {
	RootPath string
}

func NewFileSystemSource(cfg *FileSystemSourceConfig) CacheWarmupSource {
	return &FileSystemSource{
		RootPath: cfg.RootPath,
	}
}

type FileSystemSource struct {
	RootPath string
}

func (f *FileSystemSource) LoadItems(_ context.Context, log *zap.Logger) ([]*nodev1.Operation, error) {

	var items []*nodev1.Operation

	err := filepath.Walk(f.RootPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		ext := filepath.Ext(path)
		switch ext {
		case ".json":
			item, err := f.readJSON(data)
			if err != nil {
				log.Warn("Ignoring file with invalid JSON", zap.String("path", path), zap.Error(err))
				return nil
			}
			items = append(items, item)
		case ".gql", ".graphql", ".graphqls":
			items = append(items, &nodev1.Operation{
				Request: &nodev1.OperationRequest{
					Query: string(data),
				},
			})
		default:
			log.Debug("Ignoring file with unknown extension", zap.String("path", path))
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return items, nil
}

func (f *FileSystemSource) readJSON(data []byte) (*nodev1.Operation, error) {
	item := &nodev1.Operation{}
	iface := map[string]any{}
	err := json.Unmarshal(data, &iface)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON: %w", err)
	}
	if _, ok := iface["query"]; ok {
		err = json.Unmarshal(data, &item.Request)
		if err != nil {
			return nil, fmt.Errorf("failed to unmarshal JSON: %w", err)
		}
		return item, nil
	}
	err = protojson.Unmarshal(data, item)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON: %w", err)
	}
	return item, nil
}
