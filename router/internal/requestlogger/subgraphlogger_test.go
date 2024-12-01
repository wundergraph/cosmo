package requestlogger_test

import (
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/internal/requestlogger"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
	"net/http"
	"testing"
)

func TestSubgraphAccessLogger(t *testing.T) {
	t.Parallel()

	t.Run("writes correct request log", func(t *testing.T) {
		var zCore zapcore.Core
		zCore, logObserver := observer.New(zapcore.InfoLevel)
		l := logging.NewZapLoggerWithCore(zCore, true)

		subgraphLogger := requestlogger.NewSubgraphAccessLogger(l, requestlogger.SubgraphOptions{})
		req, err := http.NewRequest("POST", "http://localhost:3002/graphql", nil)
		require.NoError(t, err)
		subgraphLogger.WriteRequestLog(&resolve.ResponseInfo{
			StatusCode:      200,
			Err:             nil,
			Request:         req,
			ResponseHeaders: nil,
		}, nil)

		require.Equal(t, 1, logObserver.Len())
		requestContext := logObserver.All()[0].ContextMap()
		expectedValues := map[string]interface{}{
			"log_type": "client/subgraph",
			"method":   "POST",
			"path":     "/graphql",
			"query":    "",
			"ip":       "",
		}
		additionalExpectedKeys := []string{"user_agent", "hostname", "pid"}
		checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
	})

	t.Run("adds ip", func(t *testing.T) {
		var zCore zapcore.Core
		zCore, logObserver := observer.New(zapcore.InfoLevel)
		l := logging.NewZapLoggerWithCore(zCore, true)

		subgraphLogger := requestlogger.NewSubgraphAccessLogger(l, requestlogger.SubgraphOptions{})
		req, err := http.NewRequest("POST", "http://localhost:3002/graphql", nil)
		req.RemoteAddr = "my-test"
		require.NoError(t, err)
		subgraphLogger.WriteRequestLog(&resolve.ResponseInfo{
			StatusCode:      200,
			Err:             nil,
			Request:         req,
			ResponseHeaders: nil,
		}, nil)

		require.Equal(t, 1, logObserver.Len())
		requestContext := logObserver.All()[0].ContextMap()
		expectedValues := map[string]interface{}{
			"log_type": "client/subgraph",
			"method":   "POST",
			"path":     "/graphql",
			"query":    "",
			"ip":       "my-test",
		}
		additionalExpectedKeys := []string{"user_agent", "hostname", "pid"}
		checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
	})

	t.Run("redacts ip with anonymization config enabled", func(t *testing.T) {
		var zCore zapcore.Core
		zCore, logObserver := observer.New(zapcore.InfoLevel)
		l := logging.NewZapLoggerWithCore(zCore, true)

		subgraphLogger := requestlogger.NewSubgraphAccessLogger(l, requestlogger.SubgraphOptions{
			IPAnonymizationConfig: &requestlogger.IPAnonymizationConfig{
				Enabled: true,
				Method:  requestlogger.Redact,
			},
		})
		req, err := http.NewRequest("POST", "http://localhost:3002/graphql", nil)
		req.RemoteAddr = "my-test"
		require.NoError(t, err)
		subgraphLogger.WriteRequestLog(&resolve.ResponseInfo{
			StatusCode:      200,
			Err:             nil,
			Request:         req,
			ResponseHeaders: nil,
		}, nil)

		require.Equal(t, 1, logObserver.Len())
		requestContext := logObserver.All()[0].ContextMap()
		expectedValues := map[string]interface{}{
			"log_type": "client/subgraph",
			"method":   "POST",
			"path":     "/graphql",
			"query":    "",
			"ip":       "[REDACTED]",
		}
		additionalExpectedKeys := []string{"user_agent", "hostname", "pid"}
		checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
	})

	t.Run("gets hash of ip with anonymization config enabled and hash set", func(t *testing.T) {
		var zCore zapcore.Core
		zCore, logObserver := observer.New(zapcore.InfoLevel)
		l := logging.NewZapLoggerWithCore(zCore, true)

		subgraphLogger := requestlogger.NewSubgraphAccessLogger(l, requestlogger.SubgraphOptions{
			IPAnonymizationConfig: &requestlogger.IPAnonymizationConfig{
				Enabled: true,
				Method:  requestlogger.Hash,
			},
		})
		req, err := http.NewRequest("POST", "http://localhost:3002/graphql", nil)
		req.RemoteAddr = "my-test"
		require.NoError(t, err)
		subgraphLogger.WriteRequestLog(&resolve.ResponseInfo{
			StatusCode:      200,
			Err:             nil,
			Request:         req,
			ResponseHeaders: nil,
		}, nil)

		require.Equal(t, 1, logObserver.Len())
		requestContext := logObserver.All()[0].ContextMap()
		expectedValues := map[string]interface{}{
			"log_type": "client/subgraph",
			"method":   "POST",
			"path":     "/graphql",
			"query":    "",
			"ip":       "[109 121 45 116 101 115 116 227 176 196 66 152 252 28 20 154 251 244 200 153 111 185 36 39 174 65 228 100 155 147 76 164 149 153 27 120 82 184 85]",
		}
		additionalExpectedKeys := []string{"user_agent", "hostname", "pid"}
		checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
	})

	t.Run("fields handler is called", func(t *testing.T) {
		var zCore zapcore.Core
		zCore, logObserver := observer.New(zapcore.InfoLevel)
		l := logging.NewZapLoggerWithCore(zCore, true)

		subgraphLogger := requestlogger.NewSubgraphAccessLogger(l, requestlogger.SubgraphOptions{
			FieldsHandler: core.AccessLogsFieldHandler,
			Attributes: []config.CustomAttribute{
				{
					Key: "test",
					ValueFrom: &config.CustomDynamicAttribute{
						RequestHeader: "test-header",
					},
				},
				{
					Key: "test-response",
					ValueFrom: &config.CustomDynamicAttribute{
						ResponseHeader: "test-response-header",
					},
				},
			},
		})
		req, err := http.NewRequest("POST", "http://localhost:3002/graphql", nil)
		req.Header.Add("test-header", "test-value")

		require.NoError(t, err)
		subgraphLogger.WriteRequestLog(&resolve.ResponseInfo{
			StatusCode: 200,
			Err:        nil,
			Request:    req,
			ResponseHeaders: map[string][]string{
				"Test-Response-Header": {"test-response-value"},
			},
		}, nil)

		require.Equal(t, 1, logObserver.Len())
		requestContext := logObserver.All()[0].ContextMap()
		expectedValues := map[string]interface{}{
			"log_type":      "client/subgraph",
			"method":        "POST",
			"path":          "/graphql",
			"query":         "",
			"ip":            "",
			"test":          "test-value",
			"test-response": "test-response-value",
		}
		additionalExpectedKeys := []string{"user_agent", "request_id", "hostname", "pid"}
		checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
	})
}

func checkValues(t *testing.T, requestContext map[string]interface{}, expectedValues map[string]interface{}, additionalExpectedKeys []string) {
	t.Helper()

	require.Lenf(t, requestContext, len(expectedValues)+len(additionalExpectedKeys), "unexpected number of keys")

	for key, val := range expectedValues {
		mapVal, exists := requestContext[key]
		require.Truef(t, exists, "key '%s' not found", key)
		require.Equalf(t, val, mapVal, "expected '%v', got '%v'", val, mapVal)
	}
	for _, key := range additionalExpectedKeys {
		_, exists := requestContext[key]
		require.Truef(t, exists, "key '%s' not found", key)
	}
}
