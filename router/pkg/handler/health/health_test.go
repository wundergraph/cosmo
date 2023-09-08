package health

import (
	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/pkg/test"
	"go.uber.org/zap"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthCheckHandler(t *testing.T) {
	handler := New(&Options{
		Logger: zap.NewNop(),
	})
	rec := httptest.NewRecorder()

	handler.Liveness()(rec, test.NewRequest(http.MethodGet, "/health"))

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "text/plain; charset=utf-8", rec.Header().Get("Content-Type"))
	assert.Equal(t, "OK", rec.Body.String())
}

func TestReadinessCheckHandler(t *testing.T) {
	handler := New(&Options{
		Logger: zap.NewNop(),
	})
	rec := httptest.NewRecorder()

	handler.Readiness()(rec, test.NewRequest(http.MethodGet, "/health"))

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)

	handler.SetReady(true)

	rec = httptest.NewRecorder()
	handler.Readiness()(rec, test.NewRequest(http.MethodGet, "/health"))

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "text/plain; charset=utf-8", rec.Header().Get("Content-Type"))
	assert.Equal(t, "OK", rec.Body.String())
}
