//go:build windows
// +build windows

package epoller

import "errors"

// NewPoller creates a new epoll poller.
func NewPoller(connBufferSize int) (Poller, error) {
	return nil, errors.New("epoll is not supported on windows")
}
