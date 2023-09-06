package graphql

import (
	"context"
	"github.com/wundergraph/cosmo/router/pkg/pool"
)

type key string

const operationContextKey = key("graphql")

// OperationContext contains information about the current GraphQL operation
type OperationContext struct {
	// Name is the name of the operation
	Name string
	// opType is the type of the operation (query, mutation, subscription)
	Type string
	// Hash is the hash of the operation
	Hash uint64
	// Content is the content of the operation
	Content string
	// plan is the execution plan of the operation
	plan *pool.Shared
}

func WithOperationContext(ctx context.Context, operation *OperationContext) context.Context {
	return context.WithValue(ctx, operationContextKey, operation)
}

// GetOperationContext returns the request context.
// It provides information about the current operation like the name, type, hash and content.
// If no operation context is found, nil is returned.
func GetOperationContext(ctx context.Context) *OperationContext {
	if ctx == nil {
		return nil
	}
	op := ctx.Value(operationContextKey)
	if op == nil {
		return nil
	}
	return op.(*OperationContext)
}
