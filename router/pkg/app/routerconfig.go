package app

import (
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"os"
)

// SerializeConfigFromFile returns the router config read from the file.
func SerializeConfigFromFile(path string) (*nodev1.RouterConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg nodev1.RouterConfig
	if err := protojson.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}
