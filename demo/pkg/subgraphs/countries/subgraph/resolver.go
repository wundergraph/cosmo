package subgraph

import (
	"sync"

	"github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
)

// This file will not be regenerated automatically.
//
// It serves as dependency injection for your app, add any dependencies you require here.

type Resolver struct {
	mux                    sync.Mutex
	NatsPubSubByProviderID map[string]nats.Adapter
}
