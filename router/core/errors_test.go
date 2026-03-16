package core

import (
	"context"
	"errors"
	"net"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/astjson"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
)

func TestErrorTypeString(t *testing.T) {
	tests := []struct {
		errType  errorType
		expected string
	}{
		{errorTypeUnknown, "unknown"},
		{errorTypeRateLimit, "rate_limit"},
		{errorTypeUnauthorized, "unauthorized"},
		{errorTypeContextCanceled, "context_canceled"},
		{errorTypeContextTimeout, "context_timeout"},
		{errorTypeUpgradeFailed, "upgrade_failed"},
		{errorTypeEDFS, "edfs"},
		{errorTypeInvalidWsSubprotocol, "invalid_ws_subprotocol"},
		{errorTypeEDFSInvalidMessage, "edfs_invalid_message"},
		{errorTypeMergeResult, "merge_result"},
		{errorTypeStreamsHandlerError, "streams_handler_error"},
		{errorTypeOperationBlocked, "operation_blocked"},
		{errorTypePersistedOperationNotFound, "persisted_operation_not_found"},
		{errorTypeValidationError, "validation_error"},
		{errorTypeInputError, "input_error"},
		{errorTypeSubgraphError, "subgraph_error"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			require.Equal(t, tt.expected, tt.errType.String())
		})
	}
}

func TestGetErrorType(t *testing.T) {
	t.Run("rate_limit", func(t *testing.T) {
		require.Equal(t, errorTypeRateLimit, getErrorType(ErrRateLimitExceeded))
	})

	t.Run("rate_limit_wrapped", func(t *testing.T) {
		wrapped := errors.Join(errors.New("outer"), ErrRateLimitExceeded)
		require.Equal(t, errorTypeRateLimit, getErrorType(wrapped))
	})

	t.Run("unauthorized", func(t *testing.T) {
		require.Equal(t, errorTypeUnauthorized, getErrorType(ErrUnauthorized))
	})

	t.Run("context_canceled", func(t *testing.T) {
		require.Equal(t, errorTypeContextCanceled, getErrorType(context.Canceled))
	})

	t.Run("context_timeout", func(t *testing.T) {
		require.Equal(t, errorTypeContextTimeout, getErrorType(&net.OpError{
			Err: &timeoutError{},
		}))
	})

	t.Run("upgrade_failed", func(t *testing.T) {
		require.Equal(t, errorTypeUpgradeFailed, getErrorType(&graphql_datasource.UpgradeRequestError{}))
	})

	t.Run("edfs", func(t *testing.T) {
		require.Equal(t, errorTypeEDFS, getErrorType(&datasource.Error{}))
	})

	t.Run("invalid_ws_subprotocol", func(t *testing.T) {
		require.Equal(t, errorTypeInvalidWsSubprotocol, getErrorType(graphql_datasource.InvalidWsSubprotocolError{}))
	})

	t.Run("edfs_invalid_message", func(t *testing.T) {
		require.Equal(t, errorTypeEDFSInvalidMessage, getErrorType(&astjson.ParseError{}))
	})

	t.Run("merge_result", func(t *testing.T) {
		require.Equal(t, errorTypeMergeResult, getErrorType(resolve.ErrMergeResult{}))
	})

	t.Run("streams_handler_error", func(t *testing.T) {
		require.Equal(t, errorTypeStreamsHandlerError, getErrorType(&StreamHandlerError{}))
	})

	t.Run("persisted_operation_not_found", func(t *testing.T) {
		require.Equal(t, errorTypePersistedOperationNotFound, getErrorType(&persistedoperation.PersistentOperationNotFoundError{}))
	})

	t.Run("validation_error", func(t *testing.T) {
		require.Equal(t, errorTypeValidationError, getErrorType(&reportError{report: &operationreport.Report{}}))
	})

	t.Run("input_error", func(t *testing.T) {
		require.Equal(t, errorTypeInputError, getErrorType(&httpGraphqlError{
			message:       "invalid request body",
			statusCode:    http.StatusBadRequest,
			errorCategory: errorTypeInputError,
		}))
	})

	t.Run("operation_blocked", func(t *testing.T) {
		require.Equal(t, errorTypeOperationBlocked, getErrorType(&httpGraphqlError{
			message:       "operation type 'mutation' is blocked",
			statusCode:    http.StatusOK,
			errorCategory: errorTypeOperationBlocked,
		}))
	})

	t.Run("subgraph_error", func(t *testing.T) {
		require.Equal(t, errorTypeSubgraphError, getErrorType(&resolve.SubgraphError{}))
	})

	t.Run("unknown_for_generic_error", func(t *testing.T) {
		require.Equal(t, errorTypeUnknown, getErrorType(errors.New("some random error")))
	})

	t.Run("unknown_for_http_error_without_category", func(t *testing.T) {
		require.Equal(t, errorTypeUnknown, getErrorType(&httpGraphqlError{
			message:    "some error",
			statusCode: http.StatusOK,
		}))
	})
}

// timeoutError implements net.Error with Timeout() returning true
type timeoutError struct{}

func (e *timeoutError) Error() string   { return "timeout" }
func (e *timeoutError) Timeout() bool   { return true }
func (e *timeoutError) Temporary() bool { return false }
