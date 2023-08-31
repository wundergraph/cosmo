package health

import (
	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/pkg/test"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthCheckHandler(t *testing.T) {
	handler := New()
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, test.NewRequest(http.MethodGet, "/health"))

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "text/plain; charset=utf-8", rec.Header().Get("Content-Type"))
	assert.Equal(t, "OK", rec.Body.String())
}
