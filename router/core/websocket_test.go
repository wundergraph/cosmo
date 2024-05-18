package core

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/internal/wsproto"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

type MockConn struct {
	net.Conn
	readBuf  bytes.Buffer
	writeBuf bytes.Buffer
}

func (c *MockConn) Read(b []byte) (n int, err error) {
	return c.readBuf.Read(b)
}

func (c *MockConn) Write(b []byte) (n int, err error) {
	return c.writeBuf.Write(b)
}

func newMockConn() *MockConn {
	return &MockConn{}
}

func newTestWebSocketConnectionHandler(opts WebSocketConnectionHandlerOptions) *WebSocketConnectionHandler {
	return NewWebsocketConnectionHandler(context.Background(), opts)
}

func newTestWebSocketConnectionHandlerOptions() WebSocketConnectionHandlerOptions {
	return WebSocketConnectionHandlerOptions{
		Config: &config.WebSocketConfiguration{
			ForwardUpgradeHeaders: true,
		},
		Logger: zap.NewNop(),
		Connection: &wsConnectionWrapper{
			conn: newMockConn(),
			rw:   bufio.NewReadWriter(bufio.NewReader(newMockConn()), bufio.NewWriter(newMockConn())),
		},
		Request: &http.Request{
			Header: http.Header{
				"Test-Header":            {"value1"},
				"Sec-Websocket-Key":      {"key"},
				"Sec-Websocket-Version":  {"13"},
				"Sec-Websocket-Protocol": {"graphql-ws"},
			},
		},
	}
}

type mockProtocol struct{}

func (p *mockProtocol) Subprotocol() string {
	return "mock-protocol"
}

func (p *mockProtocol) Initialize() (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}

func (p *mockProtocol) ReadMessage() (*wsproto.Message, error) {
	return nil, nil
}

func (p *mockProtocol) WriteGraphQLData(id string, data json.RawMessage, extensions json.RawMessage) error {
	return nil
}

func (p *mockProtocol) WriteGraphQLErrors(id string, errors json.RawMessage, extensions json.RawMessage) error {
	return nil
}

func (p *mockProtocol) Pong(msg *wsproto.Message) error {
	return nil
}

func (p *mockProtocol) Done(id string) error {
	return nil
}

func TestShouldHashHeader(t *testing.T) {
	opts := newTestWebSocketConnectionHandlerOptions()
	handler := newTestWebSocketConnectionHandler(opts)

	tests := []struct {
		name               string
		whitelist          []string
		header             string
		expectedShouldHash bool
	}{
		{
			name:               "No whitelist specified, allow all headers",
			whitelist:          []string{},
			header:             "Test-Header",
			expectedShouldHash: true,
		},
		{
			name:               "No whitelist specified, allow all headers (unknown header)",
			whitelist:          []string{},
			header:             "Unknown-Header",
			expectedShouldHash: true,
		},
		{
			name:               "Whitelist specified, header in whitelist",
			whitelist:          []string{"Test-Header", "Allowed-Header"},
			header:             "Test-Header",
			expectedShouldHash: true,
		},
		{
			name:               "Whitelist specified, header not in whitelist",
			whitelist:          []string{"Test-Header", "Allowed-Header"},
			header:             "Unknown-Header",
			expectedShouldHash: false,
		},
		{
			name:               "Whitelist specified, another header in whitelist",
			whitelist:          []string{"Test-Header", "Allowed-Header"},
			header:             "Allowed-Header",
			expectedShouldHash: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler.hashHeadersWhitelist = tt.whitelist
			result := handler.shouldHashHeader(tt.header)
			assert.Equal(t, tt.expectedShouldHash, result)
		})
	}
}

func TestWebSocketConnectionHandler_Initialize(t *testing.T) {
	opts := newTestWebSocketConnectionHandlerOptions()
	handler := newTestWebSocketConnectionHandler(opts)

	// Mock protocol to avoid actual network operations
	handler.protocol = &mockProtocol{}

	tests := []struct {
		name              string
		whitelist         []string
		expectedHeaders   []string
		unexpectedHeaders []string
	}{
		{
			name:              "No whitelist specified, include all headers except ignored",
			whitelist:         []string{},
			expectedHeaders:   []string{"Test-Header"},
			unexpectedHeaders: []string{"Sec-Websocket-Key", "Sec-Websocket-Version"},
		},
		{
			name:              "Whitelist specified, include only whitelisted headers",
			whitelist:         []string{"Test-Header"},
			expectedHeaders:   []string{"Test-Header"},
			unexpectedHeaders: []string{"Sec-Websocket-Key", "Sec-Websocket-Version", "Unknown-Header"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler.hashHeadersWhitelist = tt.whitelist

			err := handler.Initialize()
			assert.NoError(t, err)
			headers := string(handler.upgradeRequestHeaders)

			for _, expectedHeader := range tt.expectedHeaders {
				assert.Contains(t, headers, expectedHeader)
			}

			for _, unexpectedHeader := range tt.unexpectedHeaders {
				assert.NotContains(t, headers, unexpectedHeader)
			}
		})
	}
}
