package core

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/dgraph-io/ristretto/v2"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router/internal/wsproto"
)

// A WebSocket message that is still being handled when a hot reload shuts the
// graph mux down writes to the mux caches. Shutdown must wait for it before it
// closes them, or ristretto panics with "send on closed channel".
func TestGraphMuxShutdownWaitsForWebsocketMessageHandlers(t *testing.T) {
	t.Parallel()

	cache, err := ristretto.NewCache(&ristretto.Config[uint64, NormalizationCacheEntry]{
		MaxCost:            1024,
		NumCounters:        10240,
		IgnoreInternalCost: true,
		BufferItems:        64,
	})
	require.NoError(t, err)

	muxCtx, cancel := context.WithCancel(context.Background())
	wsHandler := &WebsocketHandler{ctx: muxCtx}
	gm := &graphMux{
		ctx:                muxCtx,
		cancel:             cancel,
		normalizationCache: cache,
		websocketHandler:   wsHandler,
	}

	// Stand in for HandleMessage: cancellation ends the read loop, but the
	// message already being handled keeps writing to the cache.
	require.True(t, wsHandler.inFlightMessages.track())
	var finished atomic.Bool
	handlerStarted := make(chan struct{})
	go func() {
		defer wsHandler.inFlightMessages.done()
		close(handlerStarted)
		<-muxCtx.Done()
		deadline := time.Now().Add(50 * time.Millisecond)
		for i := uint64(0); time.Now().Before(deadline); i++ {
			cache.Set(i, NormalizationCacheEntry{}, 1)
			_, _ = cache.Get(i)
		}
		finished.Store(true)
	}()
	<-handlerStarted

	require.NoError(t, gm.Shutdown(context.Background()))
	require.True(t, finished.Load(), "caches closed before the message handler finished")
}

// When the shutdown deadline passes before the remaining messages finish,
// Shutdown returns, but the caches stay open until those messages are done.
func TestGraphMuxShutdownDefersCacheCloseWhenDrainTimesOut(t *testing.T) {
	t.Parallel()

	cache, err := ristretto.NewCache(&ristretto.Config[uint64, NormalizationCacheEntry]{
		MaxCost:            1024,
		NumCounters:        10240,
		IgnoreInternalCost: true,
		BufferItems:        64,
	})
	require.NoError(t, err)

	muxCtx, cancel := context.WithCancel(context.Background())
	wsHandler := &WebsocketHandler{ctx: muxCtx}
	gm := &graphMux{
		ctx:                muxCtx,
		cancel:             cancel,
		normalizationCache: cache,
		websocketHandler:   wsHandler,
	}

	require.True(t, wsHandler.inFlightMessages.track())
	release := make(chan struct{})
	handlerDone := make(chan struct{})
	go func() {
		defer close(handlerDone)
		defer wsHandler.inFlightMessages.done()
		<-release
		for i := range uint64(1000) {
			cache.Set(i, NormalizationCacheEntry{}, 1)
		}
	}()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer shutdownCancel()
	require.ErrorIs(t, gm.Shutdown(shutdownCtx), context.DeadlineExceeded)

	// A closed ristretto cache rejects every Set.
	require.True(t, cache.Set(1, NormalizationCacheEntry{}, 1), "cache closed while a message was still being handled")

	close(release)
	<-handlerDone
	require.Eventually(t, func() bool {
		return !cache.Set(2, NormalizationCacheEntry{}, 1)
	}, time.Second, time.Millisecond, "cache not closed after the last message finished")
}

func TestWebsocketHandlerDrain(t *testing.T) {
	t.Parallel()

	t.Run("closes the connection on a message read after draining", func(t *testing.T) {
		t.Parallel()

		h := &WebsocketHandler{}
		require.NoError(t, h.Drain(context.Background()))

		err := h.HandleMessage(nil, &wsproto.Message{Type: wsproto.MessageTypeSubscribe})
		closeErr, ok := errors.AsType[*wsproto.CloseError](err)
		require.True(t, ok)
		require.Equal(t, wsproto.CloseKindGoingAway, closeErr.Kind)
	})

	t.Run("returns when the context ends before handlers finish", func(t *testing.T) {
		t.Parallel()

		h := &WebsocketHandler{}
		require.True(t, h.inFlightMessages.track())
		t.Cleanup(h.inFlightMessages.done)

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
		defer cancel()
		require.ErrorIs(t, h.Drain(ctx), context.DeadlineExceeded)
	})

	t.Run("a nil handler has nothing to drain", func(t *testing.T) {
		t.Parallel()

		var h *WebsocketHandler
		require.NoError(t, h.Drain(context.Background()))
	})
}
