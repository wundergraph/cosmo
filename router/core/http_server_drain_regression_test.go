package core

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type drainBlockingReader struct {
	entered chan struct{}
	release chan struct{}
	source  io.Reader
	once    sync.Once
}

func (r *drainBlockingReader) Read(p []byte) (int, error) {
	r.once.Do(func() { close(r.entered) })
	<-r.release
	return r.source.Read(p)
}

func TestServerDrain_ReadFromBeforeDrain(t *testing.T) {
	for _, mode := range []string{"blocking source", "empty source"} {
		t.Run(mode, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			srv, listener := newDrainTestServer(t, func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				if mode == "blocking source" {
					// net/http does not commit headers until the source yields bytes.
					_, _ = w.(io.ReaderFrom).ReadFrom(&drainBlockingReader{
						entered: entered, release: release, source: strings.NewReader("ok"),
					})
				} else {
					// Reading an empty source must not suppress the later Write hook.
					_, _ = w.(io.ReaderFrom).ReadFrom(strings.NewReader(""))
					close(entered)
					<-release
					_, _ = w.Write([]byte("ok"))
				}
			})
			t.Cleanup(unblock)
			conn := dialDrainTestServer(t, listener)
			type result struct {
				resp *http.Response
				err  error
			}
			done := make(chan result, 1)
			go func() {
				resp, err := postOnConnection(conn, bufio.NewReader(conn))
				done <- result{resp, err}
			}()
			<-entered
			srv.startDraining()
			unblock()
			got := <-done
			require.NoError(t, got.err)
			require.True(t, got.resp.Close, "inspect drain state when bytes commit the response")
		})
	}
}

func TestServerDrain_HandlerCannotOverrideRetirement(t *testing.T) {
	srv, listener := newDrainTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Connection", "keep-alive")
		echoDrainRequest(w, r)
	})
	srv.startDraining()
	conn := dialDrainTestServer(t, listener)
	resp, err := postOnConnection(conn, bufio.NewReader(conn))
	require.NoError(t, err)
	require.True(t, resp.Close, "apply retirement after the handler chooses its response headers")
}

func TestServerDrain_HTTP2RetiresConnection(t *testing.T) {
	srv, _ := newDrainTestServer(t, echoDrainRequest)
	httpsServer := httptest.NewUnstartedServer(http.HandlerFunc(srv.serveHTTP))
	httpsServer.EnableHTTP2 = true
	httpsServer.StartTLS()
	t.Cleanup(httpsServer.Close)
	client := httpsServer.Client()
	client.Timeout = 5 * time.Second
	request := func() net.Conn {
		t.Helper()
		var conn net.Conn
		req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, httpsServer.URL+"/graphql", nil)
		require.NoError(t, err)
		req = req.WithContext(httptrace.WithClientTrace(req.Context(), &httptrace.ClientTrace{
			GotConn: func(info httptrace.GotConnInfo) { conn = info.Conn },
		}))
		resp, err := client.Do(req)
		require.NoError(t, err)
		require.Equal(t, 2, resp.ProtoMajor)
		require.Equal(t, http.StatusOK, resp.StatusCode)
		_, err = io.Copy(io.Discard, resp.Body)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())
		require.Empty(t, resp.Header.Get("Connection"))
		return conn
	}
	initial := request()
	require.Same(t, initial, request(), "HTTP/2 reuses the connection before draining")
	srv.startDraining()
	require.Same(t, initial, request(), "the existing connection can finish a request during drain")
	require.NotSame(t, initial, request(), "GOAWAY retires the old HTTP/2 connection")
}
