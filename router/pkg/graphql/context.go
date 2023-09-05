package graphql

import (
	"context"
	"github.com/wundergraph/cosmo/router/pkg/pool"
)

type key string

const operationContextKey = key("graphql")

type OperationContext interface {
	// Name is the name of the operation
	Name() string
	// Type is the type of the operation (query, mutation, subscription)
	Type() string
	// OperationHash is the hash of the operation
	OperationHash() uint64
	// Content is the content of the operation
	Content() string
}

// OperationContext contains information about the current GraphQL operation
type operationContext struct {
	// Name is the name of the operation
	name string
	// opType is the type of the operation (query, mutation, subscription)
	opType string
	// OperationHash is the hash of the operation
	operationHash uint64
	// Content is the content of the operation
	content string
	// plan is the execution plan of the operation
	plan *pool.Shared
}

func (o *operationContext) Name() string {
	return o.name
}

func (o *operationContext) Type() string {
	return o.opType
}

func (o *operationContext) OperationHash() uint64 {
	return o.operationHash
}

func (o *operationContext) Content() string {
	return o.content
}

func withOperationContext(ctx context.Context, operation *operationContext) context.Context {
	return context.WithValue(ctx, operationContextKey, operation)
}

// GetOperationContext returns the request context.
// It provides information about the current operation like the name, type, hash and content.
// If no operation context is found, nil is returned.
func GetOperationContext(ctx context.Context) OperationContext {
	if ctx == nil {
		return nil
	}
	op := ctx.Value(operationContextKey)
	if op == nil {
		return nil
	}
	return op.(OperationContext)
}

// GetOperationContext returns the request context. It is used for internal purposes.
func getOperationContext(ctx context.Context) *operationContext {
	if ctx == nil {
		return nil
	}
	op := ctx.Value(operationContextKey)
	if op == nil {
		return nil
	}
	return op.(*operationContext)
}
