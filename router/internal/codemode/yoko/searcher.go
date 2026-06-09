package yoko

import (
	"context"

	yokov1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/code_mode/yoko/v1"
)

type Searcher interface {
	Search(ctx context.Context, sessionID string, prompts []string) (*yokov1.SearchResponse, error)
	SetSchema(string)
	Schema() string
	EnsureIndexed(ctx context.Context) error
}

var _ Searcher = (*Client)(nil)
