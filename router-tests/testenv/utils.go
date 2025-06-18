package testenv

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func AwaitChannelWithT[A any, C chan A](t *testing.T, timeout time.Duration, ch C, f func(testing.TB, A), msgAndArgs ...interface{}) {
	t.Helper()

	select {
	case args := <-ch:
		f(t, args)
	case <-time.After(timeout):
		require.Fail(t, "timeout waiting for channel value", msgAndArgs...)
	}
}
