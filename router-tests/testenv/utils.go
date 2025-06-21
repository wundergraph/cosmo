package testenv

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func AwaitChannelWithT[A any](t *testing.T, timeout time.Duration, ch <-chan A, f func(*testing.T, A), msgAndArgs ...interface{}) {
	t.Helper()

	select {
	case args := <-ch:
		f(t, args)
	case <-time.After(timeout):
		require.Fail(t, "unable to receive message before timeout", msgAndArgs...)
	}
}
