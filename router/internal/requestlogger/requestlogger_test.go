package requestlogger

import (
	"bufio"
	"bytes"
	"encoding/json"
	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/internal/logging"
	"github.com/wundergraph/cosmo/router/internal/test"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRequestLogger(t *testing.T) {

	var buffer bytes.Buffer

	encoder := logging.ZapJsonEncoder()
	writer := bufio.NewWriter(&buffer)

	logger := zap.New(
		zapcore.NewCore(encoder, zapcore.AddSync(writer), zapcore.DebugLevel))

	handler := New(logger)
	handlerFunc := http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	recovery := handler(handlerFunc)
	rec := httptest.NewRecorder()
	recovery.ServeHTTP(rec, test.NewRequest(http.MethodGet, "/subdir/asdf"))

	writer.Flush()

	assert.Equal(t, http.StatusOK, rec.Code)

	var data map[string]interface{}
	err := json.Unmarshal(buffer.Bytes(), &data)
	assert.Nil(t, err)

	assert.Equal(t, "GET", data["method"])
	assert.Equal(t, float64(200), data["status"])
	assert.Equal(t, "/subdir/asdf", data["msg"])
	assert.Equal(t, "/subdir/asdf", data["path"])

}
