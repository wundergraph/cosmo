package core

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
)

type engineError struct {
	subgraph, errorType string
}

type engineErrorSpy struct {
	rmetric.NoopResponseCacheMetricStore
	engineErrors []engineError
}

func (s *engineErrorSpy) MeasureEngineError(_ context.Context, subgraph, errorType string) {
	s.engineErrors = append(s.engineErrors, engineError{subgraph: subgraph, errorType: errorType})
}

func TestResponseCacheErrorHandler(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		err  error
		want []engineError
	}{
		{
			name: "an entry that could not be used is counted for its subgraph",
			err:  &resolve.ResponseCacheError{Operation: resolve.ResponseCacheOperationRead, Subgraph: "mood", Err: errors.New("wrong response cache value")},
			want: []engineError{{subgraph: "mood", errorType: rmetric.ResponseCacheErrorInvalidEntry}},
		},
		{
			name: "a response that could not be taken apart is counted for its subgraph",
			err:  &resolve.ResponseCacheError{Operation: resolve.ResponseCacheOperationCollect, Subgraph: "mood", Err: errors.New("parse error")},
			want: []engineError{{subgraph: "mood", errorType: rmetric.ResponseCacheErrorInvalidResponse}},
		},
		{
			name: "a failed lookup was counted by the store",
			err:  &resolve.ResponseCacheError{Operation: resolve.ResponseCacheOperationLookup, Subgraph: "mood", Err: errors.New("connection reset")},
		},
		{
			name: "a failed write was counted by the store",
			err:  &resolve.ResponseCacheError{Operation: resolve.ResponseCacheOperationWrite, Subgraph: "mood", Err: errors.New("connection reset")},
		},
		{
			name: "anything else is counted as it is",
			err:  errors.New("unexpected"),
			want: []engineError{{errorType: rmetric.ResponseCacheErrorOther}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			spy := &engineErrorSpy{}
			zCore, logs := observer.New(zapcore.WarnLevel)

			newResponseCacheErrorHandler(zap.New(zCore), spy)(tt.err)

			require.Equal(t, tt.want, spy.engineErrors)
			require.Equal(t, 1, logs.Len(), "logged either way")
		})
	}

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
