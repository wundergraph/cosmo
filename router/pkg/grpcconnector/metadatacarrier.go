package grpcconnector

import (
	"google.golang.org/grpc/metadata"
	"strings"
)

type metadataCarrier struct {
	metadata.MD
}

func (mc metadataCarrier) Get(key string) string {
	values := mc.MD.Get(strings.ToLower(key))
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func (mc metadataCarrier) Set(key string, value string) {
	mc.MD.Set(strings.ToLower(key), value)
}

func (mc metadataCarrier) Keys() []string {
	keys := make([]string, 0, len(mc.MD))
	for k := range mc.MD {
		keys = append(keys, k)
	}
	return keys
}
