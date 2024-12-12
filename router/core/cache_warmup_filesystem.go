package core

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"go.uber.org/zap"
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

func (f *FileSystemSource) LoadItems(_ context.Context, log *zap.Logger) ([]*CacheWarmupItem, error) {

	var items []*CacheWarmupItem

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
			items = append(items, &CacheWarmupItem{
				Request: GraphQLRequest{
					Query: string(data),
				},
			})
		default:
			log.Warn("Ignoring file with unknown extension", zap.String("path", path))
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return items, nil
}

func (f *FileSystemSource) readJSON(data []byte) (*CacheWarmupItem, error) {
	item := &CacheWarmupItem{}
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
	err = json.Unmarshal(data, &item)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON: %w", err)
	}
	return item, nil
}
