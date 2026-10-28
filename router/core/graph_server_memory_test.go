package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"runtime"
	"testing"
	"weak"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestGraphServerShutdownReleasesReplacedMuxes(t *testing.T) {
	// Return only the next server and a weak reference so the test itself
	// cannot keep the replaced mux alive through a local variable.
	build := func() (*graphServer, weak.Pointer[graphMux]) {
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		previous := &graphServer{
			Config:                  &Config{logger: zap.NewNop()},
			baseRouterConfigVersion: "original",
			graphServerCancel:       cancel,
			baseTransport:           &http.Transport{},
			mux:                     chi.NewMux(),
		}

		reused := &graphMux{mux: chi.NewMux()}
		// Like buildGraphMux's middleware, this handler retains its builder.
		reused.mux.Get("/", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("X-Builder-Version", previous.baseRouterConfigVersion)
		})
		replaced := &graphMux{mux: chi.NewMux(), cancel: func() {}}
		replaced.mux.Get("/", func(http.ResponseWriter, *http.Request) {
			// Real mux handlers also reference their owning graphMux.
			runtime.KeepAlive(replaced)
		})
		previous.graphMuxList = map[string]*graphMux{"": reused, "flag": replaced}
		previous.mux.Mount("/flag", replaced.mux)

		next := &graphServer{graphMuxList: map[string]*graphMux{}}
		next.commitReusedMuxes([]reusedGraphMux{{key: "", mux: reused}})
		require.NoError(t, previous.Shutdown(ctx))
		require.True(t, replaced.finalized.Load(), "the replaced mux must be shut down")
		require.False(t, reused.finalized.Load(), "the reused mux must stay live")
		return next, weak.Make(replaced)
	}

	next, replaced := build()
	runtime.GC()
	runtime.GC()
	require.Nil(t, replaced.Value(), "the reused handler's builder still retains the replaced mux")

	// Keep the reused handler (and its builder server) reachable through GC,
	// and verify that releasing the builder's old references preserves serving.
	response := httptest.NewRecorder()
	next.graphMuxList[""].mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	require.Equal(t, "original", response.Header().Get("X-Builder-Version"))
	runtime.KeepAlive(next)
}
