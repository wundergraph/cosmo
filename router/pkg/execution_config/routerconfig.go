package execution_config

import (
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"os"
)

// FromFile creates a new router config from the file at the given path.
func FromFile(path string) (*nodev1.RouterConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	return UnmarshalConfig(data)
}

// UnmarshalConfig deserializes the router config from the given byte slice.
func UnmarshalConfig(config []byte) (*nodev1.RouterConfig, error) {

	// Ignore fields that are not in the proto definition
	// This allows to add new fields to the proto without breaking the router
	// This is a recommendation according to the proto documentation
	ms := protojson.UnmarshalOptions{
		DiscardUnknown: true,
	}

	var cfg nodev1.RouterConfig
	if err := ms.Unmarshal(config, &cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}
