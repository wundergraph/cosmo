package docker

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func findLocalNonLocalhostInterface() (net.IP, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, fmt.Errorf("could not list network interfaces: %w", err)
	}
	for _, iface := range ifaces {
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			switch x := addr.(type) {
			case *net.IPNet:
				if x.IP.IsPrivate() && !x.IP.IsLoopback() {
					return x.IP, nil
				}
			}
		}
	}
	return nil, errors.New("could not find a suitable IP address")
}

func TestLocalhostFallbackRoundTripper(t *testing.T) {
	t.Parallel()

	localIP, err := findLocalNonLocalhostInterface()
	if err != nil {
		// If we can't find a suitable address to run the test, skip it
		t.Skip(err)
	}
	t.Log("using local IP", localIP)
	// Find a random free TCP port
	l, err := net.Listen("tcp", fmt.Sprintf("[%s]:0", localIP.String()))
	require.NoError(t, err)
	port := l.Addr().(*net.TCPAddr).Port

	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		response := map[string]any{
			"method": r.Method,
			"host":   r.Host,
			"path":   r.URL.Path,
			"body":   string(data),
		}
		resp, err := json.Marshal(response)
		require.NoError(t, err)
		_, err = w.Write(resp)
		require.NoError(t, err)
	}))
	server.Listener = l
	server.Start()
	t.Cleanup(server.Close)

	transport := &localhostFallbackRoundTripper{
		transport:  http.DefaultTransport,
		targetHost: localIP.String(),
	}
	client := http.Client{
		Transport: transport,
	}

	t.Run("GET", func(t *testing.T) {
		t.Parallel()
		resp, err := client.Get(fmt.Sprintf("http://localhost:%d/hello", port))
		require.NoError(t, err)
		defer resp.Body.Close()
		data, err := io.ReadAll(resp.Body)
		require.NoError(t, err)
		var response map[string]any
		err = json.Unmarshal(data, &response)
		require.NoError(t, err)
		assert.Equal(t, "GET", response["method"])
		assert.Equal(t, fmt.Sprintf("%s:%d", localIP.String(), port), response["host"])
		assert.Equal(t, "", response["body"])
		assert.Equal(t, "/hello", response["path"])
	})

	t.Run("POST", func(t *testing.T) {
		t.Parallel()
		const hello = "hello world"
		resp, err := client.Post(fmt.Sprintf("http://localhost:%d", port), "text/plain", strings.NewReader(hello))
		require.NoError(t, err)
		defer resp.Body.Close()
		data, err := io.ReadAll(resp.Body)
		require.NoError(t, err)
		var response map[string]any
		err = json.Unmarshal(data, &response)
		require.NoError(t, err)
		assert.Equal(t, "POST", response["method"])
		assert.Equal(t, hello, response["body"])
		assert.Equal(t, "/", response["path"])
	})
}
