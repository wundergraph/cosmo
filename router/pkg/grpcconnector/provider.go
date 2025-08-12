package grpcconnector

import (
	"context"

	"google.golang.org/grpc"
)

type ClientProvider interface {
	Start(ctx context.Context) error
	GetClient() grpc.ClientConnInterface
	Stop() error
}
