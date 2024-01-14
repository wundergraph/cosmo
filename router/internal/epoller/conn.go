package epoller

import (
	"net"
)

// newConnImpl returns a net.Conn with GetFD() method.
func newConnImpl(in net.Conn) ConnImpl {
	if ci, ok := in.(ConnImpl); ok {
		return ci
	}

	return ConnImpl{
		Conn: in,
		fd:   socketFD(in),
	}
}

// ConnImpl is a net.Conn with GetFD() method.
type ConnImpl struct {
	net.Conn
	fd int
}

func (c ConnImpl) GetFD() int {
	return c.fd
}
