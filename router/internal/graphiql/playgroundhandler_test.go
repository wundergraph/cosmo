package graphiql

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/internal/test"
)

func TestHealthCheckHandler(t *testing.T) {
	handler := NewPlayground(&PlaygroundOptions{
		Html:       "test {{graphqlURL}}",
		GraphqlURL: "/",
	})
	rec := httptest.NewRecorder()

	th := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("test"))
	})

	req := test.NewRequest(http.MethodGet, "/html")
	req.Header.Set("Accept", "text/html")
	handler(th).ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "text/html; charset=utf-8", rec.Header().Get("Content-Type"))
	assert.Equal(t, "test /", rec.Body.String())
}
