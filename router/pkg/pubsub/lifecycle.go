package pubsub

import "context"

type Lifecycle interface {
	// Shutdown all the resources used by the pubsub
	Shutdown(ctx context.Context) error
}
