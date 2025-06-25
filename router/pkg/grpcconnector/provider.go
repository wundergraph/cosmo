package grpcconnector

import (
	"context"

	"google.golang.org/grpc"
)

type ClientProvider interface {
	Name() string
	Start(ctx context.Context) error
	GetClient() grpc.ClientConnInterface
	Stop() error
}
