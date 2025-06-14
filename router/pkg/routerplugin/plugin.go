package routerplugin

import (
	"context"

	"google.golang.org/grpc"
)

// TODO define plugin handling
type Plugin interface {
	Name() string
	Start(ctx context.Context) error
	GetClient() grpc.ClientConnInterface
	Stop() error
}
