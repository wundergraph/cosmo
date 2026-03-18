package speedtrap

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"time"

	"github.com/gobwas/ws"
	"github.com/gobwas/ws/wsutil"
)

// ControlFrame holds a WebSocket control frame (close, ping, or pong).
type ControlFrame struct {
	OpCode  ws.OpCode
	Payload []byte
}

// CloseData parses a close frame's status code and reason.
// Returns an empty status code and empty reason if the payload is too short.
func (cf ControlFrame) CloseData() (ws.StatusCode, string) {
	return ws.ParseCloseFrameData(cf.Payload)
}

// ConnectionHandle wraps a WebSocket connection with buffered read channels.
// It is used for both client-side and backend-side connections. The state field
// determines masking behavior per RFC 6455.
type ConnectionHandle struct {
	conn    net.Conn
	state   ws.State
	inbox   chan string
	control chan ControlFrame
	done    chan struct{}
	timeout time.Duration

	// Handshake holds the result of the WebSocket handshake (client side only).
	Handshake ws.Handshake

	// UpgradeHeaders holds the HTTP headers from the upgrade request (backend side only).
	UpgradeHeaders http.Header
}

func newConnectionHandle(conn net.Conn, state ws.State, hs ws.Handshake, headers http.Header, timeout time.Duration) *ConnectionHandle {
	h := &ConnectionHandle{
		conn:           conn,
		state:          state,
		inbox:          make(chan string, 64),
		control:        make(chan ControlFrame, 16),
		done:           make(chan struct{}),
		timeout:        timeout,
		Handshake:      hs,
		UpgradeHeaders: headers,
	}
	go h.readLoop()
	return h
}

func (h *ConnectionHandle) readLoop() {
	reader := wsutil.NewReader(h.conn, h.state)
	for {
		hdr, err := reader.NextFrame()
		if err != nil {
			close(h.done)
			return
		}

		payload, err := io.ReadAll(reader)
		if err != nil {
			close(h.done)
			return
		}

		switch hdr.OpCode {
		case ws.OpText, ws.OpBinary:
			h.inbox <- string(payload)
		case ws.OpClose, ws.OpPing, ws.OpPong:
			h.control <- ControlFrame{OpCode: hdr.OpCode, Payload: payload}
		}
	}
}

// Read blocks until a text or binary frame arrives or the timeout expires.
func (h *ConnectionHandle) Read() (string, error) {
	select {
	case msg := <-h.inbox:
		return msg, nil
	case <-h.done:
		// Connection closed, but there may be buffered data frames
		// that arrived before the read loop exited.
		select {
		case msg := <-h.inbox:
			return msg, nil
		default:
			return "", fmt.Errorf("connection closed")
		}
	case <-time.After(h.timeout):
		return "", fmt.Errorf("read timed out after %s", h.timeout)
	}
}

// ReadControl blocks until a control frame (close/ping/pong) arrives or the timeout expires.
func (h *ConnectionHandle) ReadControl() (ControlFrame, error) {
	select {
	case cf := <-h.control:
		return cf, nil
	case <-h.done:
		// Connection closed, but there may be buffered control frames
		// (e.g. close frame) that arrived before the read loop exited.
		select {
		case cf := <-h.control:
			return cf, nil
		default:
			return ControlFrame{}, fmt.Errorf("connection closed")
		}
	case <-time.After(h.timeout):
		return ControlFrame{}, fmt.Errorf("read control timed out after %s", h.timeout)
	}
}

// Send writes a text frame. Masking is applied automatically based on side.
func (h *ConnectionHandle) Send(raw string) error {
	if h.state == ws.StateClientSide {
		return wsutil.WriteClientMessage(h.conn, ws.OpText, []byte(raw))
	}
	return wsutil.WriteServerMessage(h.conn, ws.OpText, []byte(raw))
}

// SendClose sends a close frame with the given status code and reason.
func (h *ConnectionHandle) SendClose(code int, reason string) error {
	frame := ws.NewCloseFrame(ws.NewCloseFrameBody(ws.StatusCode(code), reason))
	if h.state == ws.StateClientSide {
		frame = ws.MaskFrameInPlace(frame)
	}
	return ws.WriteFrame(h.conn, frame)
}

// Drop forcibly closes the underlying TCP connection without a close frame.
func (h *ConnectionHandle) Drop() error {
	return h.conn.Close()
}
