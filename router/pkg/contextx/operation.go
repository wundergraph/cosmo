package contextx

import (
	"context"
	"github.com/wundergraph/cosmo/router/pkg/pool"
)

type operationCtxKey string

type OperationContext struct {
	// Name is the name of the operation
	Name string
	// Type is the type of the operation (query, mutation, subscription)
	Type string
	// Content is the content of the operation
	Content string
	// Plan is the execution plan of the operation
	Plan *pool.Shared
}

const key = operationCtxKey("graphql.operation")

func WithOperationContext(ctx context.Context, operation *OperationContext) context.Context {
	return context.WithValue(ctx, key, operation)
}

func GetOperationContext(ctx context.Context) *OperationContext {
	if ctx == nil {
		return nil
	}
	op := ctx.Value(key)
	if op == nil {
		return nil
	}
	return op.(*OperationContext)
}
