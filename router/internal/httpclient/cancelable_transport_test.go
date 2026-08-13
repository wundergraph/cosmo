package httpclient

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

type cancellationObserver struct {
	hardCancellations atomic.Int64
	abandoned         atomic.Int64
	lateCompletions   atomic.Int64
	limitReached      atomic.Int64
}

func (o *cancellationObserver) HardCancellation(*http.Request) {
	o.hardCancellations.Add(1)
}

func (o *cancellationObserver) AbandonedRequests(_ *http.Request, delta int64) {
	o.abandoned.Add(delta)
}

func (o *cancellationObserver) LateCompletion(*http.Request) {
	o.lateCompletions.Add(1)
}

func (o *cancellationObserver) LimitReached(*http.Request) {
	o.limitReached.Add(1)
}

func supervisedOptions(observer CancellationObserver, limit int) CancelableRoundTripperOptions {
	return CancelableRoundTripperOptions{
		ShouldSupervise: func(*http.Request) bool { return true },
		Key:             func(*http.Request) string { return "products" },
		Limit:           func(*http.Request) int { return limit },
		Observer:        observer,
	}
}

func TestCancelableRoundTripperReturnsWhenDelegateIgnoresCancellation(t *testing.T) {
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	observer := &cancellationObserver{}

	transport := NewCancelableRoundTripper(roundTripperFunc(func(*http.Request) (*http.Response, error) {
		<-release
		return nil, nil
	}), supervisedOptions(observer, 1))

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://example.com", nil)
	require.NoError(t, err)

	started := time.Now()
	resp, err := transport.RoundTrip(req)
	require.ErrorIs(t, err, context.DeadlineExceeded)
	require.Nil(t, resp)
	require.Less(t, time.Since(started), 250*time.Millisecond)
	require.EqualValues(t, 1, observer.hardCancellations.Load())
	require.EqualValues(t, 1, observer.abandoned.Load())
}

func TestCancelableRoundTripperDoesNotSuperviseOrdinaryRequests(t *testing.T) {
	wantErr := errors.New("ordinary request result")
	observer := &cancellationObserver{}
	transport := NewCancelableRoundTripper(roundTripperFunc(func(*http.Request) (*http.Response, error) {
		return nil, wantErr
	}), CancelableRoundTripperOptions{
		ShouldSupervise: func(*http.Request) bool { return false },
		Observer:        observer,
	})

	req, err := http.NewRequest(http.MethodGet, "http://example.com", nil)
	require.NoError(t, err)
	resp, err := transport.RoundTrip(req)
	require.ErrorIs(t, err, wantErr)
	require.Nil(t, resp)
	require.Zero(t, observer.hardCancellations.Load())
}

func TestCancelableRoundTripperClosesResponseThatArrivesAfterCancellation(t *testing.T) {
	release := make(chan struct{})
	started := make(chan struct{})
	closed := make(chan struct{})
	body := &closeNotifier{Reader: strings.NewReader("late"), closed: closed}
	observer := &cancellationObserver{}

	transport := NewCancelableRoundTripper(roundTripperFunc(func(*http.Request) (*http.Response, error) {
		close(started)
		<-release
		return &http.Response{StatusCode: http.StatusOK, Body: body}, nil
	}), supervisedOptions(observer, 1))

	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://example.com", nil)
	require.NoError(t, err)

	done := make(chan error, 1)
	go func() {
		_, roundTripErr := transport.RoundTrip(req)
		done <- roundTripErr
	}()

	<-started
	cancel()
	require.ErrorIs(t, <-done, context.Canceled)
	close(release)

	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("late response body was not closed")
	}
	require.Eventually(t, func() bool {
		return observer.abandoned.Load() == 0
	}, time.Second, time.Millisecond)
	require.EqualValues(t, 1, observer.lateCompletions.Load())
}

func TestCancelableRoundTripperBoundsAbandonedDelegatesPerKey(t *testing.T) {
	const limit = 2
	release := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	started := make(chan struct{}, limit)
	var delegateCalls atomic.Int64
	observer := &cancellationObserver{}

	transport := NewCancelableRoundTripper(roundTripperFunc(func(*http.Request) (*http.Response, error) {
		delegateCalls.Add(1)
		started <- struct{}{}
		<-release
		return nil, nil
	}), supervisedOptions(observer, limit))

	for range limit {
		ctx, cancel := context.WithCancel(context.Background())
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://example.com", nil)
		require.NoError(t, err)
		done := make(chan error, 1)
		go func() {
			_, roundTripErr := transport.RoundTrip(req)
			done <- roundTripErr
		}()
		<-started
		cancel()
		require.ErrorIs(t, <-done, context.Canceled)
	}

	// Repeated events continue to fail at their own deadlines without starting
	// additional delegates once the per-key capacity is held by abandoned work.
	for range 100 {
		ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://example.com", nil)
		require.NoError(t, err)
		_, err = transport.RoundTrip(req)
		cancel()
		require.ErrorIs(t, err, context.DeadlineExceeded)
	}

	require.EqualValues(t, limit, delegateCalls.Load())
	require.EqualValues(t, limit, observer.abandoned.Load())
	require.EqualValues(t, 100, observer.limitReached.Load())

	releaseOnce.Do(func() { close(release) })
	require.Eventually(t, func() bool {
		return observer.abandoned.Load() == 0
	}, time.Second, time.Millisecond)
	require.EqualValues(t, limit, observer.lateCompletions.Load())
}

func TestCancelableRoundTripperSharesLimitsAcrossWrappers(t *testing.T) {
	release := make(chan struct{})
	started := make(chan struct{}, 1)
	var delegateCalls atomic.Int64
	supervisor := NewCancellationSupervisor()
	observer := &cancellationObserver{}
	options := supervisedOptions(observer, 1)
	options.Supervisor = supervisor
	delegate := roundTripperFunc(func(*http.Request) (*http.Response, error) {
		delegateCalls.Add(1)
		started <- struct{}{}
		<-release
		return nil, nil
	})
	first := NewCancelableRoundTripper(delegate, options)
	second := NewCancelableRoundTripper(delegate, options)

	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://example.com", nil)
	require.NoError(t, err)
	done := make(chan error, 1)
	go func() {
		_, roundTripErr := first.RoundTrip(req)
		done <- roundTripErr
	}()
	<-started
	cancel()
	require.ErrorIs(t, <-done, context.Canceled)

	blockedCtx, blockedCancel := context.WithTimeout(context.Background(), time.Millisecond)
	blockedReq, err := http.NewRequestWithContext(blockedCtx, http.MethodGet, "http://example.com", nil)
	require.NoError(t, err)
	_, err = second.RoundTrip(blockedReq)
	blockedCancel()
	require.ErrorIs(t, err, context.DeadlineExceeded)
	require.EqualValues(t, 1, delegateCalls.Load())

	close(release)
	require.Eventually(t, func() bool {
		return observer.abandoned.Load() == 0
	}, time.Second, time.Millisecond)
}

type closeNotifier struct {
	io.Reader
	closed chan struct{}
}

func (c *closeNotifier) Close() error {
	close(c.closed)
	return nil
}

func TestCancelableRoundTripperReturnsDelegateResult(t *testing.T) {
	wantErr := errors.New("delegate failed")
	transport := NewCancelableRoundTripper(roundTripperFunc(func(*http.Request) (*http.Response, error) {
		return nil, wantErr
	}), supervisedOptions(nil, 1))
	req, err := http.NewRequest(http.MethodGet, "http://example.com", nil)
	require.NoError(t, err)

	resp, err := transport.RoundTrip(req)
	require.ErrorIs(t, err, wantErr)
	require.Nil(t, resp)
}

func BenchmarkCancelableRoundTripper(b *testing.B) {
	delegate := roundTripperFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusNoContent, Body: http.NoBody}, nil
	})
	req, err := http.NewRequest(http.MethodGet, "http://example.com", nil)
	require.NoError(b, err)

	b.Run("direct_delegate", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			_, _ = delegate.RoundTrip(req)
		}
	})

	b.Run("ordinary_request_bypass", func(b *testing.B) {
		transport := NewCancelableRoundTripper(delegate, CancelableRoundTripperOptions{
			ShouldSupervise: func(*http.Request) bool { return false },
		})
		b.ReportAllocs()
		for b.Loop() {
			_, _ = transport.RoundTrip(req)
		}
	})

	b.Run("supervised_subscription_request", func(b *testing.B) {
		transport := NewCancelableRoundTripper(delegate, supervisedOptions(nil, 128))
		b.ReportAllocs()
		for b.Loop() {
			_, _ = transport.RoundTrip(req)
		}
	})
}
