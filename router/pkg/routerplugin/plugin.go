package routerplugin

import (
	"context"

	"go.uber.org/zap"
	"google.golang.org/grpc"
)

// TODO define plugin handling
type Plugin interface {
	Name() string
	Start(ctx context.Context, logger *zap.Logger) error
	GetClient() grpc.ClientConnInterface
	Stop() error
}
