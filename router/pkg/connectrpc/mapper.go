package connectrpc

import (
	"io"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

func readMapping(buf io.Reader) (*nodev1.GRPCMapping, error) {
	mapping := &nodev1.GRPCMapping{}
	data, err := io.ReadAll(buf)
	if err != nil {
		return nil, err
	}
	if err := protojson.Unmarshal(data, mapping); err != nil {
		return nil, err
	}

	return mapping, nil
}
