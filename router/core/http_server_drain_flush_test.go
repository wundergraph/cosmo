package core

import (
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestServerDrain_ResponseControllerFlushError(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		name := "disabled"
		if enabled {
			name = "enabled"
		}
		t.Run(name, func(t *testing.T) {
			flushed := make(chan error, 1)
			srv, listener := newDrainTestServer(t, func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				controller := http.NewResponseController(w)
				if err := controller.SetWriteDeadline(time.Now().Add(-time.Second)); err != nil {
					flushed <- err
					return
				}
				flushed <- controller.Flush()
			})
			srv.drainEnabled = enabled
			conn := dialDrainTestServer(t, listener)
			req, err := http.NewRequest(http.MethodPost, "http://router.test/graphql", strings.NewReader("{}"))
			require.NoError(t, err)
			require.NoError(t, req.Write(conn))
			require.ErrorIs(t, <-flushed, os.ErrDeadlineExceeded)
		})
	}
}
