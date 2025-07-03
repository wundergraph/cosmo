package core

import (
	"errors"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/internal/requestlogger"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
	"go.uber.org/zap"
	"net/http"
	"testing"
)

func TestAccessLogsFieldHandler(t *testing.T) {
	t.Parallel()

	t.Run("run without any expressions", func(t *testing.T) {
		t.Parallel()

		logger := &zap.Logger{}

		req, err := http.NewRequest(http.MethodPost, "http://localhost:3002/graphql", nil)
		require.NoError(t, err)
		rcc := buildRequestContext(requestContextOptions{r: req})
		req = req.WithContext(withRequestContext(req.Context(), rcc))

		response := RouterAccessLogsFieldHandler(
			logger,
			make([]config.CustomAttribute, 0),
			make([]requestlogger.ExpressionAttribute, 0),
			nil,
			req,
			nil,
			nil,
		)

		require.Len(t, response, 1)
	})

	t.Run("run expression without error", func(t *testing.T) {
		t.Parallel()

		logger := &zap.Logger{}

		req, err := http.NewRequest(http.MethodPost, "http://localhost:3002/graphql", nil)

		require.NoError(t, err)
		rcc := buildRequestContext(requestContextOptions{r: req})
		req = req.WithContext(withRequestContext(req.Context(), rcc))

		manager := expr.CreateNewExprManager()
		expressionResponseKey := "testkey"
		expression, err := manager.CompileAnyExpression("request.error ?? request.url")
		require.NoError(t, err)

		exprAttributes := []requestlogger.ExpressionAttribute{
			{
				Key:     expressionResponseKey,
				Default: "somedefaultvalue",
				Expr:    expression,
			},
		}

		response := RouterAccessLogsFieldHandler(
			logger,
			make([]config.CustomAttribute, 0),
			exprAttributes,
			nil,
			req,
			nil,
			nil,
		)

		expressionResponse := response[1]
		require.Equal(t, expressionResponse.Key, expressionResponseKey)
		require.Equal(t, expressionResponse.Interface, rcc.expressionContext.Request.URL)
	})

	t.Run("run expression with an error", func(t *testing.T) {
		t.Parallel()

		logger := &zap.Logger{}

		req, err := http.NewRequest(http.MethodPost, "http://localhost:3002/graphql", nil)
		require.NoError(t, err)
		rcc := buildRequestContext(requestContextOptions{r: req})

		requestError := &reportError{
			report: &operationreport.Report{
				InternalErrors: []error{
					errors.New("new error"),
				},
				ExternalErrors: nil,
			},
		}
		rcc.SetError(requestError)

		req = req.WithContext(withRequestContext(req.Context(), rcc))

		manager := expr.CreateNewExprManager()
		expression, err := manager.CompileAnyExpression("request.error ?? request.url")
		require.NoError(t, err)
		expressionResponseKey := "testkey"

		exprAttributes := []requestlogger.ExpressionAttribute{
			{
				Key:     expressionResponseKey,
				Default: "somedefaultvalue",
				Expr:    expression,
			},
		}

		response := RouterAccessLogsFieldHandler(
			logger,
			make([]config.CustomAttribute, 0),
			exprAttributes,
			nil,
			req,
			nil,
			nil,
		)

		expressionResponse := response[1]
		require.IsType(t, &ExprWrapError{}, expressionResponse.Interface)
		require.Equal(t, expressionResponseKey, expressionResponse.Key)
		require.Equal(t, &ExprWrapError{requestError}, expressionResponse.Interface)
	})

}
