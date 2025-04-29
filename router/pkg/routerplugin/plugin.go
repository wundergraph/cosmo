package routerplugin

import (
	"context"

	"go.uber.org/zap"
)

// TODO define plugin handling
type Plugin[T any] interface {
	Name() string
	Start(ctx context.Context, logger *zap.Logger) error
	Client() T
	Stop() error
}
