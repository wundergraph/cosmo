package subgraph

import (
	"github.com/99designs/gqlgen/graphql"
	"github.com/wundergraph/benchmark-services/graphs/chat/subgraph/generated"
)

// This file will not be regenerated automatically.
//
// It serves as dependency injection for your app, add any dependencies you require here.

type Resolver struct {
	chatRoomManager *ChatRoomManager
}

func NewSchema(chatRoomManager *ChatRoomManager) graphql.ExecutableSchema {
	return generated.NewExecutableSchema(generated.Config{
		Resolvers: &Resolver{
			chatRoomManager: chatRoomManager,
		},
	})
}
