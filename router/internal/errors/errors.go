package errors

import (
	"errors"
	"syscall"
)

// IsBrokenPipe determines whether the provided error is a "broken pipe" error.
// It checks if the error is or wraps `syscall.EPIPE` or `syscall.ECONNRESET`,
// which are commonly returned when a connection is forcibly closed by the client.
// Recognizing these errors allows us to handle them differently, such as avoiding
// logging them at the error level since they often indicate normal client behavior
// (e.g., the client disconnecting abruptly) rather than a server-side issue.
func IsBrokenPipe(err error) bool {
	if err == nil {
		return false
	}

	return errors.Is(err, syscall.ECONNRESET) || errors.Is(err, syscall.EPIPE)
}
