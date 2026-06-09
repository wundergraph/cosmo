package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProxyMirrorsUpstreamSurfaceAndForwardsElicitation(t *testing.T) {
	tests := []struct {
		name string
		run  func(context.Context, *testing.T, *mcp.ClientSession)
	}{
		{
			name: "list tools",
			run: func(ctx context.Context, t *testing.T, session *mcp.ClientSession) {
				resp, err := session.ListTools(ctx, &mcp.ListToolsParams{})
				require.NoError(t, err)
				assert.Equal(t, &mcp.ListToolsResult{
					Tools: []*mcp.Tool{
						{
							Name:        "ask",
							Description: "Ask for approval.",
							InputSchema: map[string]any{
								"type":                 "object",
								"additionalProperties": false,
							},
						},
						{
							Name:        "echo",
							Description: "Echo the input.",
							InputSchema: map[string]any{
								"type":                 "object",
								"additionalProperties": true,
							},
						},
					},
				}, resp)
			},
		},
		{
			name: "call echo",
			run: func(ctx context.Context, t *testing.T, session *mcp.ClientSession) {
				resp, err := session.CallTool(ctx, &mcp.CallToolParams{
					Name:      "echo",
					Arguments: map[string]any{"x": 1},
				})
				require.NoError(t, err)
				assert.Equal(t, &mcp.CallToolResult{
					Content:           []mcp.Content{&mcp.TextContent{Text: `{"x":1}`}},
					StructuredContent: map[string]any{"x": float64(1)},
				}, resp)
			},
		},
		{
			name: "list resources",
			run: func(ctx context.Context, t *testing.T, session *mcp.ClientSession) {
				resp, err := session.ListResources(ctx, &mcp.ListResourcesParams{})
				require.NoError(t, err)
				assert.Equal(t, &mcp.ListResourcesResult{
					Resources: []*mcp.Resource{
						{
							URI:      "demo://hello",
							Name:     "hello",
							Title:    "Hello",
							MIMEType: "text/plain",
						},
					},
				}, resp)
			},
		},
		{
			name: "read resource",
			run: func(ctx context.Context, t *testing.T, session *mcp.ClientSession) {
				resp, err := session.ReadResource(ctx, &mcp.ReadResourceParams{URI: "demo://hello"})
				require.NoError(t, err)
				assert.Equal(t, &mcp.ReadResourceResult{
					Contents: []*mcp.ResourceContents{
						{
							URI:      "demo://hello",
							MIMEType: "text/plain",
							Text:     "hi",
						},
					},
				}, resp)
			},
		},
		{
			name: "call ask forwards elicitation",
			run: func(ctx context.Context, t *testing.T, session *mcp.ClientSession) {
				resp, err := session.CallTool(ctx, &mcp.CallToolParams{
					Name:      "ask",
					Arguments: map[string]any{},
				})
				require.NoError(t, err)
				assert.Equal(t, &mcp.CallToolResult{
					Content:           []mcp.Content{&mcp.TextContent{Text: `{"approved":true}`}},
					StructuredContent: map[string]any{"approved": true},
				}, resp)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()

			upstream := newTestUpstream(t)

			serverTransport, clientTransport := mcp.NewInMemoryTransports()
			errCh := make(chan error, 1)
			go func() {
				errCh <- runProxy(ctx, proxyOptions{
					upstreamURL: upstream.URL,
					transport:   serverTransport,
					httpClient:  upstream.Client(),
				})
			}()

			client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "0.1.0"}, &mcp.ClientOptions{
				ElicitationHandler: func(context.Context, *mcp.ElicitRequest) (*mcp.ElicitResult, error) {
					return &mcp.ElicitResult{
						Action:  "accept",
						Content: map[string]any{"approved": true},
					}, nil
				},
			})
			session, err := client.Connect(ctx, clientTransport, nil)
			require.NoError(t, err)
			defer func() {
				require.NoError(t, session.Close())
				err := <-errCh
				if !errors.Is(err, context.Canceled) {
					require.NoError(t, err)
				}
			}()

			tt.run(ctx, t, session)
		})
	}
}

func TestProxyReconnectsAfterUpstreamDisconnect(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	server := mcp.NewServer(&mcp.Implementation{Name: "test-upstream", Version: "0.1.0"}, nil)
	server.AddTool(&mcp.Tool{
		Name:        "echo",
		Description: "Echo the input.",
		InputSchema: map[string]any{
			"type":                 "object",
			"additionalProperties": true,
		},
	}, func(_ context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		return &mcp.CallToolResult{
			Content:           []mcp.Content{&mcp.TextContent{Text: string(req.Params.Arguments)}},
			StructuredContent: req.Params.Arguments,
		}, nil
	})
	mcpHandler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
		return server
	}, nil)

	// Switchable handler: when "off", every request returns 503 so both the
	// keepalive ping on the live session and any reconnect dials fail.
	var upstreamUp atomic.Bool
	upstreamUp.Store(true)
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !upstreamUp.Load() {
			http.Error(w, "upstream off", http.StatusServiceUnavailable)
			return
		}
		mcpHandler.ServeHTTP(w, r)
	}))
	defer httpServer.Close()

	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	errCh := make(chan error, 1)
	go func() {
		errCh <- runProxy(ctx, proxyOptions{
			upstreamURL:    httpServer.URL,
			transport:      serverTransport,
			httpClient:     httpServer.Client(),
			keepAlive:      100 * time.Millisecond,
			initialBackoff: 50 * time.Millisecond,
		})
	}()

	client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "0.1.0"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	require.NoError(t, err)
	defer func() {
		require.NoError(t, session.Close())
		err := <-errCh
		if !errors.Is(err, context.Canceled) {
			require.NoError(t, err)
		}
	}()

	resp, err := session.CallTool(ctx, &mcp.CallToolParams{
		Name:      "echo",
		Arguments: map[string]any{"x": 1},
	})
	require.NoError(t, err)
	assert.Equal(t, &mcp.CallToolResult{
		Content:           []mcp.Content{&mcp.TextContent{Text: `{"x":1}`}},
		StructuredContent: map[string]any{"x": float64(1)},
	}, resp)

	upstreamUp.Store(false)
	time.Sleep(400 * time.Millisecond)
	upstreamUp.Store(true)

	require.Eventually(t, func() bool {
		resp, err := session.CallTool(ctx, &mcp.CallToolParams{
			Name:      "echo",
			Arguments: map[string]any{"x": 2},
		})
		if err != nil {
			return false
		}
		return assert.ObjectsAreEqual(&mcp.CallToolResult{
			Content:           []mcp.Content{&mcp.TextContent{Text: `{"x":2}`}},
			StructuredContent: map[string]any{"x": float64(2)},
		}, resp)
	}, 10*time.Second, 100*time.Millisecond, "expected proxy to reconnect and serve calls")
}

func newTestUpstream(t *testing.T) *httptest.Server {
	t.Helper()

	server := mcp.NewServer(&mcp.Implementation{Name: "test-upstream", Version: "0.1.0"}, nil)
	server.AddTool(&mcp.Tool{
		Name:        "echo",
		Description: "Echo the input.",
		InputSchema: map[string]any{
			"type":                 "object",
			"additionalProperties": true,
		},
	}, func(_ context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		return &mcp.CallToolResult{
			Content:           []mcp.Content{&mcp.TextContent{Text: string(req.Params.Arguments)}},
			StructuredContent: req.Params.Arguments,
		}, nil
	})
	server.AddTool(&mcp.Tool{
		Name:        "ask",
		Description: "Ask for approval.",
		InputSchema: map[string]any{
			"type":                 "object",
			"additionalProperties": false,
		},
	}, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		result, err := req.Session.Elicit(ctx, &mcp.ElicitParams{
			Message: "Approve mutation?",
			RequestedSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"approved": map[string]any{"type": "boolean"},
				},
			},
		})
		if err != nil {
			return nil, err
		}
		return &mcp.CallToolResult{
			Content:           []mcp.Content{&mcp.TextContent{Text: `{"approved":true}`}},
			StructuredContent: result.Content,
		}, nil
	})
	server.AddResource(&mcp.Resource{
		URI:      "demo://hello",
		Name:     "hello",
		Title:    "Hello",
		MIMEType: "text/plain",
	}, func(context.Context, *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		return &mcp.ReadResourceResult{
			Contents: []*mcp.ResourceContents{
				{
					URI:      "demo://hello",
					MIMEType: "text/plain",
					Text:     "hi",
				},
			},
		}, nil
	})

	mux := http.NewServeMux()
	mux.Handle("/", mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
		return server
	}, nil))

	listener := newPipeListener()
	t.Cleanup(func() {
		require.NoError(t, listener.Close())
	})

	httpServer := &httptest.Server{
		Listener: listener,
		Config: &http.Server{
			Handler: mux,
			BaseContext: func(net.Listener) context.Context {
				ctx, cancel := context.WithCancel(context.Background())
				t.Cleanup(cancel)
				return ctx
			},
		},
	}
	httpServer.Start()
	t.Cleanup(httpServer.Close)
	httpServer.Client().Transport = &http.Transport{
		DialContext: listener.DialContext,
	}
	return httpServer
}

type pipeListener struct {
	conns chan net.Conn
	done  chan struct{}
}

func newPipeListener() *pipeListener {
	return &pipeListener{
		conns: make(chan net.Conn),
		done:  make(chan struct{}),
	}
}

func (l *pipeListener) Accept() (net.Conn, error) {
	select {
	case conn := <-l.conns:
		return conn, nil
	case <-l.done:
		return nil, net.ErrClosed
	}
}

func (l *pipeListener) Close() error {
	select {
	case <-l.done:
	default:
		close(l.done)
	}
	return nil
}

func (l *pipeListener) Addr() net.Addr {
	return pipeAddr("pipe")
}

func (l *pipeListener) DialContext(ctx context.Context, _, _ string) (net.Conn, error) {
	serverConn, clientConn := net.Pipe()
	select {
	case l.conns <- serverConn:
		return clientConn, nil
	case <-ctx.Done():
		_ = serverConn.Close()
		_ = clientConn.Close()
		return nil, ctx.Err()
	case <-l.done:
		_ = serverConn.Close()
		_ = clientConn.Close()
		return nil, net.ErrClosed
	}
}

type pipeAddr string

func (a pipeAddr) Network() string {
	return "pipe"
}

func (a pipeAddr) String() string {
	return string(a)
}
