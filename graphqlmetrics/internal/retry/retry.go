package retry

import (
	"context"
	"github.com/avast/retry-go"
	"go.uber.org/zap"
	"time"
)

// DefaultJitter is a retry strategy with a delay of 100ms and a max jitter of 30s
// It will retry 10 times before returning an error, If the function returns an error it will retry.
func DefaultJitter(ctx context.Context, logger *zap.Logger, f func(ctx context.Context) error) error {
	opts := []retry.Option{
		retry.Attempts(10),
		retry.Delay(100 * time.Millisecond),
		retry.MaxJitter(30_000 * time.Millisecond),
		retry.DelayType(retry.CombineDelay(retry.BackOffDelay, retry.RandomDelay)),
		retry.OnRetry(func(n uint, err error) {
			logger.Debug("retrying after error",
				zap.Error(err),
				zap.Uint("attempt", n),
			)
		}),
	}

	err := retry.Do(
		func() error {
			err := f(ctx)

			if err != nil {
				return err
			}

			return nil
		},
		opts...,
	)
	if err != nil {
		return err
	}

	return nil
}
