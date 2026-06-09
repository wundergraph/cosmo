package storage

import (
	"context"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
)

type SessionStorage interface {
	Append(ctx context.Context, sessionID string, ops []SessionOp) ([]SessionOp, error)
	GetOp(ctx context.Context, sessionID string, name string) (SessionOp, bool, error)
	ListNames(ctx context.Context, sessionID string) ([]string, error)
	Bundle(ctx context.Context, sessionID string) (string, error)
	Reset(ctx context.Context, sessionID string) error
	SetSchema(*ast.Document)
	Schema() *ast.Document
	Start(ctx context.Context) error
	Stop() error
}

type Renderer interface {
	Render(ctx context.Context, ops []SessionOp, schema *ast.Document) (string, error)
}

type RendererFunc func([]SessionOp) (string, error)

func (f RendererFunc) Render(_ context.Context, ops []SessionOp, _ *ast.Document) (string, error) {
	return f(ops)
}
