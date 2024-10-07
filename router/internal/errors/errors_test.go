package errors

import (
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"syscall"
	"testing"
)

func TestIsBrokenPipe(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{
			name: "Nil error",
			err:  nil,
			want: false,
		},
		{
			name: "Exact ECONNRESET",
			err:  syscall.ECONNRESET,
			want: true,
		},
		{
			name: "Exact EPIPE",
			err:  syscall.EPIPE,
			want: true,
		},
		{
			name: "Wrapped ECONNRESET",
			err:  fmt.Errorf("wrapped error: %w", syscall.ECONNRESET),
			want: true,
		},
		{
			name: "Wrapped EPIPE",
			err:  fmt.Errorf("wrapped error: %w", syscall.EPIPE),
			want: true,
		},
		{
			name: "Wrapped EPIPE in net.OpError",
			err: &net.OpError{
				Err: &os.SyscallError{
					Err: syscall.EPIPE,
				},
			},
			want: true,
		},
		{
			name: "Wrapped ECONNRESET in net.OpError",
			err: &net.OpError{
				Err: &os.SyscallError{
					Err: syscall.ECONNRESET,
				},
			},
			want: true,
		},
		{
			name: "Unrelated error",
			err:  errors.New("some other error"),
			want: false,
		},
		{
			name: "Wrapped unrelated error",
			err:  fmt.Errorf("wrapped error: %w", errors.New("another error")),
			want: false,
		},
		{
			name: "io.EOF error",
			err:  io.EOF,
			want: false,
		},
		{
			name: "Custom error type matching ECONNRESET",
			err:  customError{syscall.ECONNRESET},
			want: true,
		},
		{
			name: "Custom error type not matching",
			err:  customError{errors.New("custom error")},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsBrokenPipe(tt.err)
			if got != tt.want {
				t.Errorf("IsBrokenPipe(%v) = %v; want %v", tt.err, got, tt.want)
			}
		})
	}
}

type customError struct {
	err error
}

func (e customError) Error() string {
	return e.err.Error()
}

func (e customError) Unwrap() error {
	return e.err
}
