//go:build windows
// +build windows

package epoller

import (
	"errors"
	"time"
)

// NewPoller creates a new epoll poller.
func NewPoller(connBufferSize int, _ time.Duration) (Poller, error) {
	return nil, errors.New("epoll is not supported on windows")
}
