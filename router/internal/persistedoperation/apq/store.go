package apq

import (
	"context"
)

type Store interface {
	Get(ctx context.Context, operationHash string) ([]byte, error)
	Set(ctx context.Context, operationHash string, operationBody []byte) error
	Renew(ctx context.Context, operationHash string) error
	IsDistributed() bool
	Close() error
}
