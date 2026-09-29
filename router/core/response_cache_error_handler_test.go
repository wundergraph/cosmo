package core

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/responsecaching"
)

type engineErrorSpy struct {
	rmetric.NoopResponseCacheMetricStore
	engineErrors int
}

func (s *engineErrorSpy) MeasureEngineError(context.Context) {
	s.engineErrors++
}

type failingStore struct {
	err error
}

func (f failingStore) GetMany(context.Context, []string) (map[string]caching.Item, error) {
	return nil, f.err
}
func (f failingStore) SetMany(context.Context, []caching.Item) error { return f.err }
func (f failingStore) InvalidateByTags(context.Context, []string) (int, error) {
	return 0, f.err
}
func (f failingStore) Close() error { return nil }

func TestResponseCacheErrorHandler(t *testing.T) {
	t.Parallel()

	t.Run("a failure of the engine is counted", func(t *testing.T) {
		t.Parallel()

		spy := &engineErrorSpy{}
		zCore, logs := observer.New(zapcore.WarnLevel)

		handler := newResponseCacheErrorHandler(zap.New(zCore), spy)
		handler(errors.New("wrong response cache value for key a"))

		require.Equal(t, 1, spy.engineErrors)
		require.Equal(t, 1, logs.Len())
	})

	t.Run("a failure of the store is not counted twice", func(t *testing.T) {
		t.Parallel()

		spy := &engineErrorSpy{}
		store := responsecaching.NewInstrumentedStore(failingStore{err: errors.New("connection reset")}, spy)
		_, err := store.GetMany(context.Background(), []string{"a"})
		require.Error(t, err)

		handler := newResponseCacheErrorHandler(zap.NewNop(), spy)
		handler(fmt.Errorf("response cache lookup of 1 keys: %w", err))

		require.Zero(t, spy.engineErrors)
	})

	t.Run("failures are logged without metrics", func(t *testing.T) {
		t.Parallel()

		zCore, logs := observer.New(zapcore.WarnLevel)

		handler := newResponseCacheErrorHandler(zap.New(zCore), nil)
		handler(errors.New("connection reset"))

		require.Equal(t, 1, logs.Len())
	})

	t.Run("there is no handler without a logger and metrics", func(t *testing.T) {
		t.Parallel()
		require.Nil(t, newResponseCacheErrorHandler(nil, nil))
	})
}
