package integration

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// TestSlowClientTimeouts covers clients that open a connection to the router and then send the
// request slowly or not at all (slowloris-style slow headers or slow body).
func TestSlowClientTimeouts(t *testing.T) {
	t.Parallel()

	const operation = `{"query":"{ employees { id } }"}`

	dialRouter := func(t *testing.T, xEnv *testenv.Environment) net.Conn {
		t.Helper()
		u, err := url.Parse(xEnv.RouterURL)
		require.NoError(t, err)
		conn, err := net.Dial("tcp", u.Host)
		require.NoError(t, err)
		t.Cleanup(func() { _ = conn.Close() })
		return conn
	}

	// requireClosedByServer waits for the server to close the connection and returns how long it took.
	requireClosedByServer := func(t *testing.T, r io.Reader, conn net.Conn, start time.Time) time.Duration {
		t.Helper()
		// Guard against the test hanging if the server never closes the connection.
		require.NoError(t, conn.SetReadDeadline(time.Now().Add(10*time.Second)))
		buf := make([]byte, 1)
		n, err := r.Read(buf)
		require.Zero(t, n)
		require.Error(t, err)
		var netErr net.Error
		require.False(t, errors.As(err, &netErr) && netErr.Timeout(), "server did not close the connection")
		return time.Since(start)
	}

	t.Run("partial headers are cut off by read_header_timeout", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithRouterTrafficConfig(&config.RouterTrafficConfiguration{
					MaxRequestBodyBytes: 5 << 20,
					ReadTimeout:         30 * time.Second,
					ReadHeaderTimeout:   500 * time.Millisecond,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := dialRouter(t, xEnv)

			start := time.Now()
			// The request line and one header, but never the blank line that terminates the headers.
			_, err := fmt.Fprintf(conn, "POST /graphql HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n")
			require.NoError(t, err)

			// net/http closes the connection without writing a response when reading the headers times out.
			elapsed := requireClosedByServer(t, conn, conn, start)
			require.GreaterOrEqual(t, elapsed, 500*time.Millisecond)
			require.Less(t, elapsed, 10*time.Second, "read_header_timeout should apply, not read_timeout")
		})
	})

	t.Run("partial headers are cut off by read_timeout when read_header_timeout is unset", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithRouterTrafficConfig(&config.RouterTrafficConfiguration{
					MaxRequestBodyBytes: 5 << 20,
					ReadTimeout:         500 * time.Millisecond,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := dialRouter(t, xEnv)

			start := time.Now()
			_, err := fmt.Fprintf(conn, "POST /graphql HTTP/1.1\r\nHost: localhost\r\n")
			require.NoError(t, err)

			elapsed := requireClosedByServer(t, conn, conn, start)
			// The read deadline starts when the server begins reading, which can be before start.
			require.GreaterOrEqual(t, elapsed, 400*time.Millisecond)
		})
	})

	t.Run("partial body is cut off by read_timeout with 408", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithRouterTrafficConfig(&config.RouterTrafficConfiguration{
					MaxRequestBodyBytes: 5 << 20,
					ReadTimeout:         500 * time.Millisecond,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := dialRouter(t, xEnv)

			start := time.Now()
			// Complete headers announcing the full body, then only half of it.
			_, err := fmt.Fprintf(conn, "POST /graphql HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s",
				len(operation), operation[:len(operation)/2])
			require.NoError(t, err)

			require.NoError(t, conn.SetReadDeadline(time.Now().Add(10*time.Second)))
			br := bufio.NewReader(conn)
			res, err := http.ReadResponse(br, nil)
			require.NoError(t, err)
			defer func() { _ = res.Body.Close() }()
			// The read deadline starts when the server begins reading, which can be before start.
			require.GreaterOrEqual(t, time.Since(start), 400*time.Millisecond)

			body, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, http.StatusRequestTimeout, res.StatusCode)
			require.JSONEq(t, `{"errors":[{"message":"timeout while reading the request body"}]}`, string(body))

			// The unread body leaves the connection unusable, so the server closes it after the response.
			requireClosedByServer(t, br, conn, start)
		})
	})

	t.Run("partial multipart body is cut off by read_timeout with 408", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithRouterTrafficConfig(&config.RouterTrafficConfiguration{
					MaxRequestBodyBytes: 5 << 20,
					ReadTimeout:         500 * time.Millisecond,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := dialRouter(t, xEnv)

			part := "--boundary\r\nContent-Disposition: form-data; name=\"operations\"\r\n\r\n" + operation + "\r\n"
			start := time.Now()
			_, err := fmt.Fprintf(conn, "POST /graphql HTTP/1.1\r\nHost: localhost\r\nContent-Type: multipart/form-data; boundary=boundary\r\nContent-Length: %d\r\n\r\n%s",
				len(part)*2, part)
			require.NoError(t, err)

			require.NoError(t, conn.SetReadDeadline(time.Now().Add(10*time.Second)))
			br := bufio.NewReader(conn)
			res, err := http.ReadResponse(br, nil)
			require.NoError(t, err)
			defer func() { _ = res.Body.Close() }()
			// The read deadline starts when the server begins reading, which can be before start.
			require.GreaterOrEqual(t, time.Since(start), 400*time.Millisecond)

			body, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			require.Equal(t, http.StatusRequestTimeout, res.StatusCode)
			require.JSONEq(t, `{"errors":[{"message":"timeout while reading the request body"}]}`, string(body))

			requireClosedByServer(t, br, conn, start)
		})
	})

	t.Run("idle keep-alive connection is closed by idle_timeout", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithRouterTrafficConfig(&config.RouterTrafficConfiguration{
					MaxRequestBodyBytes: 5 << 20,
					ReadTimeout:         30 * time.Second,
					IdleTimeout:         500 * time.Millisecond,
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			conn := dialRouter(t, xEnv)

			_, err := fmt.Fprintf(conn, "POST /graphql HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s",
				len(operation), operation)
			require.NoError(t, err)

			require.NoError(t, conn.SetReadDeadline(time.Now().Add(10*time.Second)))
			br := bufio.NewReader(conn)
			res, err := http.ReadResponse(br, nil)
			require.NoError(t, err)
			body, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			_ = res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			require.True(t, strings.Contains(string(body), `"employees"`), string(body))

			start := time.Now()
			elapsed := requireClosedByServer(t, br, conn, start)
			require.GreaterOrEqual(t, elapsed, 400*time.Millisecond)
			require.Less(t, elapsed, 10*time.Second, "idle_timeout should apply, not read_timeout")
		})
	})
}
