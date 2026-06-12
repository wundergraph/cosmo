package selfregister

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1/nodev1connect"
	brotli "go.withmatt.com/connect-brotli"
)

type testNodeServiceHandler struct {
	delay time.Duration
}

func (h *testNodeServiceHandler) SelfRegister(ctx context.Context, _ *connect.Request[nodev1.SelfRegisterRequest]) (*connect.Response[nodev1.SelfRegisterResponse], error) {
	if h.delay > 0 {
		select {
		case <-time.After(h.delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	return connect.NewResponse(&nodev1.SelfRegisterResponse{}), nil
}

func newSelfRegisterForTest(t *testing.T, handler nodev1connect.NodeServiceHandler, token string, opts ...Option) SelfRegister {
	t.Helper()

	path, nodeHandler := nodev1connect.NewNodeServiceHandler(handler, brotli.WithCompression())
	mux := http.NewServeMux()
	mux.Handle(path, nodeHandler)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	sr, err := New(server.URL, token, opts...)
	require.NoError(t, err)

	return sr
}

func TestSelfRegister_Register_TimesOut(t *testing.T) {
	delay := 1 * time.Second
	handler := &testNodeServiceHandler{
		delay: delay,
	}

	sr := newSelfRegisterForTest(t, handler, "timeout-token", WithClientTimeout(time.Millisecond*100))

	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), delay)
	defer cancel()
	_, err := sr.Register(ctx)
	elapsed := time.Since(start)

	require.Less(t, elapsed, time.Second, "expected timeout error in less than 1 s, got: %v", elapsed)
	require.Error(t, err)
}
