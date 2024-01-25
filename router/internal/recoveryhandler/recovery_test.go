package recoveryhandler

import (
	"github.com/wundergraph/cosmo/router/internal/test"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRecoveryLoggerWithDefaultOptions(t *testing.T) {
	handler := New()
	handlerFunc := http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		panic("Unexpected error!")
	})

	recovery := handler(handlerFunc)
	rec := httptest.NewRecorder()
	recovery.ServeHTTP(rec, test.NewRequest(http.MethodGet, "/subdir/asdf"))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("Expected status code %d, got %d", http.StatusInternalServerError, rec.Code)
	}

}
