package core

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

	// Ignore fields that are not in the proto definition
	ms := protojson.UnmarshalOptions{
		DiscardUnknown: true,
	}

	var cfg nodev1.RouterConfig
	if err := ms.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}
