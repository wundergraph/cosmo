package testenv

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type WaitingListener struct {
	cancel   context.CancelFunc
	listener *net.Listener
	waitTime time.Duration
	port     int
}

func (l *WaitingListener) Close() error {
	l.cancel()
	return (*l.listener).Close()
}

func (l *WaitingListener) Start() {
	go func() {
		for {
			conn, err := (*l.listener).Accept()
			if err != nil {
				return
			}
			time.Sleep(l.waitTime)
			conn.Close()
		}
	}()
}

func (l *WaitingListener) Port() int {
	return l.port
}

func NewWaitingListener(t *testing.T, waitTime time.Duration) (wl *WaitingListener) {
	ctx, cancel := context.WithCancel(context.Background())
	var lc net.ListenConfig
	listener, err := lc.Listen(ctx, "tcp", "127.0.0.1:0")
	require.NoError(t, err)

	wl = &WaitingListener{
		cancel:   cancel,
		listener: &listener,
		waitTime: waitTime,
		port:     listener.Addr().(*net.TCPAddr).Port,
	}
	return wl
}
