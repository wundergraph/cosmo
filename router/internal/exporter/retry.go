package exporter

import (
	"errors"

	"connectrpc.com/connect"
)

// IsRetryableConnectError returns false for Connect errors that indicate a
// permanent failure (bad credentials or bad input), true otherwise. Errors
// that are not *connect.Error are treated as retryable by default.
func IsRetryableConnectError(err error) bool {
	if err == nil {
		return false
	}
	var connectErr *connect.Error
	if errors.As(err, &connectErr) {
		switch connectErr.Code() {
		case connect.CodeUnauthenticated,
			connect.CodePermissionDenied,
			connect.CodeInvalidArgument:
			return false
		default:
			return true
		}
	}
	return true
}
