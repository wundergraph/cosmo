package subgraph

import (
	"github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
)

// This file will not be regenerated automatically.
//
// It serves as dependency injection for your app, add any dependencies you require here.

type Resolver struct {
	NatsPubSubByProviderID map[string]nats.Adapter
	GetPubSubName          func(string) string
}
