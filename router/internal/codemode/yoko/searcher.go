package yoko

import (
	"context"

	yokov1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/code_mode/yoko/v1"
)

type Searcher interface {
	Search(ctx context.Context, prompts []string) (*yokov1.Resolution, error)
	SetSchema(string)
	Schema() string
	// EnsureIndexed proactively warms the schema_id cache so the first
	// Search after a (re)load doesn't pay the IndexSchema round-trip.
	EnsureIndexed(ctx context.Context) error
}

var _ Searcher = (*Client)(nil)
