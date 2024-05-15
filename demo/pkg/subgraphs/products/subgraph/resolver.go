package subgraph

import (
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
	"sync"
)

// This file will not be regenerated automatically.
//
// It serves as dependency injection for your app, add any dependencies you require here.

type Resolver struct {
	mux                    sync.Mutex
	NatsPubSubByProviderID map[string]pubsub_datasource.NatsPubSub
}
