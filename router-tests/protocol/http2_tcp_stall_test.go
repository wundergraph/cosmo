package integration

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// TestSubgraphTCPHeadOfLineBlocking characterizes the mechanism suspected in
// https://app.usepylon.com/issues?issueNumber=3531. It stalls encrypted response
// bytes on one TCP connection, below TLS and HTTP. This deterministically models
// delayed byte delivery; it does not generate packet loss or TCP retransmissions,
// or establish that the customer's incident is a Go runtime defect.
//
// HTTP/2: all three requests share the stalled connection and wait for recovery.
// HTTP/1.1: only one request stalls; two requests on other connections complete.
// The HTTP/1.1 control is selected by server ALPN, using the same router config.
// A future router option disabling HTTP/2 should be tested against an h2-capable
// server, expecting the HTTP/1.1 isolation demonstrated here.
//
// Run from the repository root:
// go test ./router-tests/protocol -run '^TestSubgraphTCPHeadOfLineBlocking$' -v -count=1
func TestSubgraphTCPHeadOfLineBlocking(t *testing.T) {
	t.Logf("Go version: %s", runtime.Version())
	for _, http2 := range []bool{true, false} {
		name, wantProto, wantConnections := "HTTP1", 1, 3
		if http2 {
			name, wantProto, wantConnections = "HTTP2", 2, 1
		}
		t.Run(name, func(t *testing.T) {
			const requests = 3
			const response = `{"data":{"employees":[{"id":1}]}}`
			gate := newTCPWriteGate()
			ready := make(chan struct{})
			releaseResponses := sync.OnceFunc(func() { close(ready) })
			type requestInfo struct {
				proto int
				addr  string
			}
			arrived := make(chan requestInfo, requests)
			subgraph := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if gate.armed.Load() {
					arrived <- requestInfo{proto: r.ProtoMajor, addr: r.RemoteAddr}
					select {
					case <-ready:
					case <-r.Context().Done():
						return
					}
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, response)
			}))
			listener := &stallFirstTCPListener{Listener: subgraph.Listener, gate: gate}
			subgraph.Listener = listener
			subgraph.EnableHTTP2 = http2
			subgraph.StartTLS()
			t.Cleanup(func() {
				releaseResponses()
				gate.release()
				subgraph.Close()
			})

			testenv.Run(t, &testenv.Config{
				NoRetryClient: true,
				ModifyEngineExecutionConfiguration: func(c *config.EngineExecutionConfiguration) {
					c.EnableSingleFlight = false
				},
				RouterOptions: []core.Option{
					core.WithOverrideRoutingURL(config.OverrideRoutingURLConfiguration{
						Subgraphs: map[string]string{"employees": subgraph.URL + "/graphql"},
					}),
					core.WithSubgraphRetryOptions(false, "", 0, 0, 0, "", nil),
					core.WithTLSConfig(config.TLSConfiguration{
						Client: config.HTTPClientTLSConfiguration{
							All: config.HTTPTLSClientCertConfiguration{
								TLSClientCertConfiguration: config.TLSClientCertConfiguration{InsecureSkipCaVerification: true},
							},
						},
					}),
				},
			}, func(t *testing.T, env *testenv.Environment) {
				ctx, cancel := context.WithTimeout(env.Context, 10*time.Second)
				defer cancel()
				// Also release before the router's cleanup if an assertion fails.
				defer releaseResponses()
				defer gate.release()
				query := testenv.GraphQLRequest{Query: `{ employees { id } }`}
				// Establish TLS, negotiate HTTP/2, and warm the query plan before
				// stalling writes. Otherwise we would be testing a TLS handshake stall.
				warmup, err := env.MakeGraphQLRequestWithContext(ctx, query)
				require.NoError(t, err)
				require.JSONEq(t, response, warmup.Body)
				require.EqualValues(t, 1, listener.accepted.Load())
				gate.armed.Store(true)

				type result struct {
					response *testenv.TestResponse
					err      error
				}
				results := make(chan result, requests)
				connections := make(map[string]struct{})
				for range requests {
					go func() {
						res, err := env.MakeGraphQLRequestWithContext(ctx, query)
						results <- result{response: res, err: err}
					}()
					// All handlers stay in flight, so HTTP/1.1 must open another
					// connection while HTTP/2 can reuse the established one.
					info := awaitTCPStallEvent(t, arrived, "subgraph request")
					require.Equal(t, wantProto, info.proto)
					connections[info.addr] = struct{}{}
				}
				require.Len(t, connections, wantConnections)
				require.EqualValues(t, wantConnections, listener.accepted.Load())
				releaseResponses()
				awaitTCPStallEvent(t, gate.blocked, "encrypted response bytes reaching the stalled connection")

				checkResponse := func(res result) {
					t.Helper()
					require.NoError(t, res.err)
					require.Equal(t, http.StatusOK, res.response.Response.StatusCode)
					require.JSONEq(t, response, res.response.Body)
				}
				completed := 0
				if !http2 {
					for range requests - 1 {
						checkResponse(awaitTCPStallEvent(t, results, "HTTP/1.1 response on an unaffected connection"))
						completed++
					}
				}
				// The gate stays closed throughout this observation window. We
				// assert blocking only after every request reached its handler and
				// response bytes reached the gate, rather than sleeping for setup.
				select {
				case res := <-results:
					t.Fatalf("request completed while its TCP connection was stalled: %+v", res)
				case <-time.After(200 * time.Millisecond):
				}
				t.Logf("one stalled TCP connection: %d/%d responses completed before recovery", completed, requests)
				gate.release()
				for ; completed < requests; completed++ {
					checkResponse(awaitTCPStallEvent(t, results, "response after TCP delivery resumes"))
				}
				require.EqualValues(t, wantConnections, listener.accepted.Load(), "recovery must reuse the existing connections")
			})
		})
	}
}

func awaitTCPStallEvent[T any](t *testing.T, ch <-chan T, description string) T {
	t.Helper()
	select {
	case value := <-ch:
		return value
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for %s", description)
		var zero T
		return zero
	}
}

type tcpWriteGate struct {
	armed   atomic.Bool
	blocked chan struct{}
	resume  chan struct{}
	once    sync.Once
	release func()
}

func newTCPWriteGate() *tcpWriteGate {
	g := &tcpWriteGate{blocked: make(chan struct{}), resume: make(chan struct{})}
	g.release = sync.OnceFunc(func() { close(g.resume) })
	return g
}

// Only the first accepted connection is affected; other connections use normal
// TCP I/O. httptest wraps this listener in TLS, so Write sees encrypted bytes.
type stallFirstTCPListener struct {
	net.Listener
	gate     *tcpWriteGate
	accepted atomic.Int32
}

func (l *stallFirstTCPListener) Accept() (net.Conn, error) {
	conn, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	if l.accepted.Add(1) == 1 {
		return &stalledTCPConn{Conn: conn, gate: l.gate, closed: make(chan struct{})}, nil
	}
	return conn, nil
}

type stalledTCPConn struct {
	net.Conn
	gate      *tcpWriteGate
	closed    chan struct{}
	closeOnce sync.Once
}

func (c *stalledTCPConn) Write(p []byte) (int, error) {
	if c.gate.armed.Load() {
		c.gate.once.Do(func() { close(c.gate.blocked) })
		select {
		case <-c.gate.resume:
		case <-c.closed:
			return 0, net.ErrClosed
		}
	}
	return c.Conn.Write(p)
}

func (c *stalledTCPConn) Close() error {
	c.closeOnce.Do(func() { close(c.closed) })
	return c.Conn.Close()
}
