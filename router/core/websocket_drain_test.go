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

// heldPingProto is a wsproto.Proto whose Pong blocks until released, which
// holds a ping inside WebsocketHandler.HandleMessage. Only Pong is implemented.
type heldPingProto struct {
	wsproto.Proto
	started chan struct{}
	release chan struct{}
	// onRelease runs after release, while the message is still being handled.
	onRelease func()
}

func (p *heldPingProto) Pong(*wsproto.Message) error {
	close(p.started)
	<-p.release
	p.onRelease()
	return nil
}

func (t *inFlightTracker) isDraining() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.draining
}

type drainTestMux struct {
	gm        *graphMux
	wsHandler *WebsocketHandler
	// cacheOpen reports whether the normalization cache is still open. Close
	// clears the store first, so a sentinel entry disappearing means the cache
	// is closing. GetTTL only reads the store: unlike Set or Get it sends on no
	// channel, so it cannot race the close or panic if a regression closes the
	// cache early.
	cacheOpen func() bool
}

func newDrainTestMux(t *testing.T) drainTestMux {
	t.Helper()

	cache, err := ristretto.NewCache(&ristretto.Config[uint64, NormalizationCacheEntry]{
		MaxCost:            1024,
		NumCounters:        10240,
		IgnoreInternalCost: true,
		BufferItems:        64,
	})
	require.NoError(t, err)

	const sentinel = uint64(1)
	require.True(t, cache.Set(sentinel, NormalizationCacheEntry{}, 1))
	cache.Wait()
	cacheOpen := func() bool {
		_, ok := cache.GetTTL(sentinel)
		return ok
	}
	require.True(t, cacheOpen())

	muxCtx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	wsHandler := &WebsocketHandler{ctx: muxCtx}
	return drainTestMux{
		gm: &graphMux{
			ctx:                muxCtx,
			cancel:             cancel,
			normalizationCache: cache,
			websocketHandler:   wsHandler,
		},
		wsHandler: wsHandler,
		cacheOpen: cacheOpen,
	}
}

// holdPing starts a ping through HandleMessage and returns once the message is
// held. The returned proto releases it; done is closed when HandleMessage returns.
func (m drainTestMux) holdPing(t *testing.T, openWhileHandled *atomic.Bool) (proto *heldPingProto, done chan struct{}) {
	t.Helper()

	proto = &heldPingProto{
		started: make(chan struct{}),
		release: make(chan struct{}),
		onRelease: func() {
			openWhileHandled.Store(m.cacheOpen())
		},
	}
	done = make(chan struct{})
	go func() {
		defer close(done)
		_ = m.wsHandler.HandleMessage(
			&WebSocketConnectionHandler{protocol: proto},
			&wsproto.Message{Type: wsproto.MessageTypePing},
		)
	}()
	<-proto.started
	return proto, done
}

// A WebSocket message that is still being handled when a hot reload shuts the
// graph mux down uses the mux caches. Shutdown must wait for it before it
// closes them, or ristretto panics with "send on closed channel".
func TestGraphMuxShutdownWaitsForWebsocketMessageHandlers(t *testing.T) {
	t.Parallel()

	m := newDrainTestMux(t)
	var openWhileHandled atomic.Bool
	proto, handled := m.holdPing(t, &openWhileHandled)

	shutdownErr := make(chan error, 1)
	go func() {
		shutdownErr <- m.gm.Shutdown(context.Background())
	}()

	// Release the ping only once Shutdown has reached the drain, so the test
	// cannot pass by running Shutdown after the message is done.
	require.Eventually(t, m.wsHandler.inFlightMessages.isDraining,
		time.Second, time.Millisecond, "shutdown never started draining websocket messages")
	require.Never(t, func() bool {
		return len(shutdownErr) > 0
	}, 50*time.Millisecond, time.Millisecond, "shutdown returned while a message was still being handled")
	require.True(t, m.cacheOpen(), "cache closed while a message was still being handled")

	close(proto.release)
	<-handled
	require.NoError(t, <-shutdownErr)
	require.True(t, openWhileHandled.Load(), "cache closed before the message finished")
	require.False(t, m.cacheOpen(), "cache not closed by shutdown")
}

// When the shutdown deadline passes before the remaining messages finish,
// Shutdown returns, but the caches stay open until those messages are done.
func TestGraphMuxShutdownDefersCacheCloseWhenDrainTimesOut(t *testing.T) {
	t.Parallel()

	m := newDrainTestMux(t)
	var openWhileHandled atomic.Bool
	proto, handled := m.holdPing(t, &openWhileHandled)

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer shutdownCancel()
	require.ErrorIs(t, m.gm.Shutdown(shutdownCtx), context.DeadlineExceeded)
	require.True(t, m.cacheOpen(), "cache closed while a message was still being handled")

	close(proto.release)
	<-handled
	require.True(t, openWhileHandled.Load(), "cache closed before the message finished")
	require.Eventually(t, func() bool {
		return !m.cacheOpen()
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
