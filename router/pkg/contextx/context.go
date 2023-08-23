package contextx

import (
	"context"
)

type graphqlOperationCtxKey string

type GraphQLOperation struct {
	// Name is the name of the operation
	Name string
	// Type is the type of the operation (query, mutation, subscription)
	Type string
	// Content is the content of the operation
	Content string
	// Hash is the hash of the operation. Only available if the operation was parsed successfully.
	Hash uint64
}

const key = graphqlOperationCtxKey("graphqlOperation")

func AddGraphQLOperationToContext(ctx context.Context, operation *GraphQLOperation) context.Context {
	return context.WithValue(ctx, key, operation)
}

func GetGraphQLOperationFromContext(ctx context.Context) *GraphQLOperation {
	if ctx == nil {
		return nil
	}
	op := ctx.Value(key)
	if op == nil {
		return nil
	}
	return op.(*GraphQLOperation)
}
