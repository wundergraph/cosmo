package requestlogger_test

import (
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/internal/requestlogger"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
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
		subgraphLogger.Info("", subgraphLogger.RequestFields(&resolve.ResponseInfo{
			StatusCode:      200,
			Err:             nil,
			Request:         req,
			ResponseHeaders: nil,
		}, nil))

		require.Equal(t, 1, logObserver.Len())
		requestContext := logObserver.All()[0].ContextMap()
		expectedValues := map[string]interface{}{
			"log_type": "client/subgraph",
			"method":   "POST",
			"path":     "/graphql",
			"query":    "",
			"ip":       "",
		}
		additionalExpectedKeys := []string{"user_agent", "hostname", "pid", "url"}
		checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
	})

	t.Run("Should include IP as custom attribute if requested", func(t *testing.T) {
		var zCore zapcore.Core
		zCore, logObserver := observer.New(zapcore.InfoLevel)
		l := logging.NewZapLoggerWithCore(zCore, true)

		subgraphLogger := requestlogger.NewSubgraphAccessLogger(l, requestlogger.SubgraphOptions{})
		req, err := http.NewRequest("POST", "http://localhost:3002/graphql", nil)
		req.RemoteAddr = "my-test"
		require.NoError(t, err)
		subgraphLogger.Info("", subgraphLogger.RequestFields(&resolve.ResponseInfo{
			StatusCode:      200,
			Err:             nil,
			Request:         req,
			ResponseHeaders: nil,
		}, nil))

		require.Equal(t, 1, logObserver.Len())
		requestContext := logObserver.All()[0].ContextMap()
		expectedValues := map[string]interface{}{
			"log_type": "client/subgraph",
			"method":   "POST",
			"path":     "/graphql",
			"query":    "",
			"ip":       "my-test",
		}
		additionalExpectedKeys := []string{"user_agent", "hostname", "pid", "url"}
		checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
	})

	t.Run("Should redact client IP and add as a custom attribute", func(t *testing.T) {
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
		subgraphLogger.Info("", subgraphLogger.RequestFields(&resolve.ResponseInfo{
			StatusCode:      200,
			Err:             nil,
			Request:         req,
			ResponseHeaders: nil,
		}, nil))

		require.Equal(t, 1, logObserver.Len())
		requestContext := logObserver.All()[0].ContextMap()
		expectedValues := map[string]interface{}{
			"log_type": "client/subgraph",
			"method":   "POST",
			"path":     "/graphql",
			"query":    "",
			"ip":       "[REDACTED]",
		}
		additionalExpectedKeys := []string{"user_agent", "hostname", "pid", "url"}
		checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
	})

	t.Run("Should hash client IP and add it as a custom attribute", func(t *testing.T) {
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
		subgraphLogger.Info("", subgraphLogger.RequestFields(&resolve.ResponseInfo{
			StatusCode:      200,
			Err:             nil,
			Request:         req,
			ResponseHeaders: nil,
		}, nil))

		require.Equal(t, 1, logObserver.Len())
		requestContext := logObserver.All()[0].ContextMap()
		expectedValues := map[string]interface{}{
			"log_type": "client/subgraph",
			"method":   "POST",
			"path":     "/graphql",
			"query":    "",
			"ip":       "c616478f21f8bb743c3ca95097961f9bf81eae9527311effbf04529d73e8cd9b",
		}
		additionalExpectedKeys := []string{"user_agent", "hostname", "pid", "url"}
		checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
	})

	t.Run("calls fields handler and adds request/response headers", func(t *testing.T) {
		var zCore zapcore.Core
		zCore, logObserver := observer.New(zapcore.InfoLevel)
		l := logging.NewZapLoggerWithCore(zCore, true)

		subgraphLogger := requestlogger.NewSubgraphAccessLogger(l, requestlogger.SubgraphOptions{
			FieldsHandler: core.SubgraphAccessLogsFieldHandler,
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
		subgraphLogger.Info("", subgraphLogger.RequestFields(&resolve.ResponseInfo{
			StatusCode: 200,
			Err:        nil,
			Request:    req,
			ResponseHeaders: map[string][]string{
				"Test-Response-Header": {"test-response-value"},
			},
		}, nil))

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
		additionalExpectedKeys := []string{"user_agent", "request_id", "hostname", "pid", "url"}
		checkValues(t, requestContext, expectedValues, additionalExpectedKeys)
	})

	t.Run("can handle a null request", func(t *testing.T) {
		var zCore zapcore.Core
		zCore, logObserver := observer.New(zapcore.InfoLevel)
		l := logging.NewZapLoggerWithCore(zCore, true)

		subgraphLogger := requestlogger.NewSubgraphAccessLogger(l, requestlogger.SubgraphOptions{
			FieldsHandler: core.SubgraphAccessLogsFieldHandler,
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
				{
					Key: "request-error",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldRequestError,
					},
				},
				{
					Key: "request-error-msg",
					ValueFrom: &config.CustomDynamicAttribute{
						ContextField: core.ContextFieldResponseErrorMessage,
					},
				},
			},
		})

		subgraphLogger.Info("subgraph error", subgraphLogger.RequestFields(&resolve.ResponseInfo{
			StatusCode: 200,
			Err:        errors.New("my-test-error"),
			Request:    nil,
			ResponseHeaders: map[string][]string{
				"Test-Response-Header": {"test-response-value"},
			},
		}, nil))

		require.Equal(t, 1, logObserver.Len())
		requestContext := logObserver.All()[0].ContextMap()
		expectedValues := map[string]interface{}{
			"log_type":          "client/subgraph",
			"request-error":     true,
			"request-error-msg": "my-test-error",
			"test-response":     "test-response-value",
		}
		additionalExpectedKeys := []string{"hostname", "pid"}
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
