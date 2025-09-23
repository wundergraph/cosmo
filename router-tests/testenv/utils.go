package testenv

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func AwaitChannelWithT[A any](t *testing.T, timeout time.Duration, ch <-chan A, f func(*testing.T, A), msgAndArgs ...any) {
	t.Helper()

	select {
	case args := <-ch:
		f(t, args)
	case <-time.After(timeout):
		require.Fail(t, "unable to receive message before timeout", msgAndArgs...)
	}
}

func AwaitChannelWithCloseWithT[A any](t *testing.T, timeout time.Duration, ch <-chan A, f func(t *testing.T, item A, ok bool), msgAndArgs ...any) {
	t.Helper()

	select {
	case args, ok := <-ch:
		f(t, args, ok)
	case <-time.After(timeout):
		require.Fail(t, "unable to receive message before timeout", msgAndArgs...)
	}
}

func AwaitFunc(t *testing.T, timeout time.Duration, testFunction func()) {
	t.Helper()

	doneCh := make(chan struct{})
	go func() {
		defer close(doneCh)
		testFunction()
	}()

	AwaitChannelWithT(t, timeout, doneCh, func(t *testing.T, _ struct{}) {}, "the test function timed out")
}
