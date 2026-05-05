package exporter

import (
	"errors"
	"io"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/require"
)

func TestIsRetryableConnectError(t *testing.T) {
	t.Parallel()

	t.Run("nil is not retryable", func(t *testing.T) {
		require.False(t, IsRetryableConnectError(nil))
	})

	t.Run("non-connect error is retryable", func(t *testing.T) {
		require.True(t, IsRetryableConnectError(errors.New("plain error")))
		require.True(t, IsRetryableConnectError(io.ErrUnexpectedEOF))
	})

	t.Run("permanent connect codes are not retryable", func(t *testing.T) {
		for _, code := range []connect.Code{
			connect.CodeUnauthenticated,
			connect.CodePermissionDenied,
			connect.CodeInvalidArgument,
		} {
			err := connect.NewError(code, errors.New("nope"))
			require.False(t, IsRetryableConnectError(err), "code=%s", code)
		}
	})

	t.Run("transient connect codes are retryable", func(t *testing.T) {
		for _, code := range []connect.Code{
			connect.CodeUnavailable,
			connect.CodeDeadlineExceeded,
			connect.CodeInternal,
			connect.CodeResourceExhausted,
			connect.CodeAborted,
			connect.CodeUnknown,
		} {
			err := connect.NewError(code, errors.New("retry me"))
			require.True(t, IsRetryableConnectError(err), "code=%s", code)
		}
	})

	t.Run("wrapped permanent code unwraps via errors.As", func(t *testing.T) {
		inner := connect.NewError(connect.CodeUnauthenticated, errors.New("token expired"))
		wrapped := errors.Join(errors.New("export failed"), inner)
		require.False(t, IsRetryableConnectError(wrapped))
	})
}
