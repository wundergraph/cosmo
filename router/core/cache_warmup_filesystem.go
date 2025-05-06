package core

import (
	"context"
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
			var warmupOperations nodev1.CacheWarmerOperations
			unmarshalOpts := protojson.UnmarshalOptions{DiscardUnknown: true}
			if err := unmarshalOpts.Unmarshal(data, &warmupOperations); err != nil {
				return err
			}
			items = append(items, warmupOperations.GetOperations()...)
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
