package testenv

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func AwaitChannelWithT[A any, C chan A](t *testing.T, timeout time.Duration, ch C, f func(A)) {
	t.Helper()

	select {
	case args := <-ch:
		f(args)
	case <-time.After(timeout):
		require.Fail(t, "clientRunCh should not block")
	}
}
