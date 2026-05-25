package context

import (
	stdcontext "context"
	"sync/atomic"
)

type FetchTraceTimings struct {
	FetchStartUnixNano            atomic.Int64
	FetchPrepareSpanEmitted       atomic.Bool
	TransportDuration             atomic.Int64
	TransportEndUnixNano          atomic.Int64
	ResponseBodyReadStartUnixNano atomic.Int64
	ResponseBodyReadEndUnixNano   atomic.Int64

	ParentContext stdcontext.Context
	SubgraphID    string
	SubgraphName  string
}
