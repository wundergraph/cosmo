package subgraph

import (
	"sync"

	"github.com/nats-io/nats.go"
)

// This file will not be regenerated automatically.
//
// It serves as dependency injection for your app, add any dependencies you require here.

type Resolver struct {
	NatsConnectionBySourceName map[string]*nats.Conn
	mux                        sync.Mutex
}
