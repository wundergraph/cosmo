package requestlogger

import (
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"testing"
)

func TestAccessLogExpressionParsing(t *testing.T) {
	t.Parallel()

	t.Run("no expression attributes", func(t *testing.T) {
		t.Parallel()

		customAttributes := []config.CustomAttribute{
			{
				Key:     "custom",
				Default: "value_different",
				ValueFrom: &config.CustomDynamicAttribute{
					ContextField: "x-custom-header",
				},
			},
			{
				Key:     "custom2",
				Default: "value_different",
				ValueFrom: &config.CustomDynamicAttribute{
					ContextField: "x-custom-header2",
				},
			},
		}

		exprManager := expr.CreateNewExprManager()
		expressions, err := GetAccessLogConfigExpressions(customAttributes, exprManager)
		if err != nil {
			require.Fail(t, "unexpected error", err)
		}

		require.Empty(t, expressions)
	})

	t.Run("parse expression attributes", func(t *testing.T) {
		t.Parallel()

		customAttributes := []config.CustomAttribute{
			{
				Key:     "nonexpr",
				Default: "value_different",
				ValueFrom: &config.CustomDynamicAttribute{
					RequestHeader: "x-custom-header",
				},
			},
			{
				Key:     "expr1",
				Default: "value_different1",
				ValueFrom: &config.CustomDynamicAttribute{
					Expression: "request.error ?? request.header.Get('graphql-client-name')",
				},
			},
			{
				Key:     "expr1=2",
				Default: "value_different6",
				ValueFrom: &config.CustomDynamicAttribute{
					Expression: "request.header",
				},
			},
		}

		exprManager := expr.CreateNewExprManager()
		expressions, err := GetAccessLogConfigExpressions(customAttributes, exprManager)
		require.NoError(t, err)

		require.Len(t, expressions, 2)

		// Validate the validity of the entry
		entry1 := expressions[0]
		require.Equal(t, "expr1", entry1.Key)
		require.Equal(t, "value_different1", entry1.Default)
		require.NotNil(t, entry1.Expr)
	})

	t.Run("failure on parsing the expression", func(t *testing.T) {
		t.Parallel()

		customAttributes := []config.CustomAttribute{
			{
				Key:     "custom",
				Default: "value_different",
				ValueFrom: &config.CustomDynamicAttribute{
					ContextField: "x-custom-header",
				},
			},
			{
				Key:     "expr1",
				Default: "value_different",
				ValueFrom: &config.CustomDynamicAttribute{
					Expression: "request.error2",
				},
			},
		}

		exprManager := expr.CreateNewExprManager()
		_, err := GetAccessLogConfigExpressions(customAttributes, exprManager)
		if err != nil {
			require.Error(t, err)
			return
		}

		require.Fail(t, "error should have been detected")
	})
}

func TestCleanupExpressionAttributes(t *testing.T) {
	t.Parallel()

	t.Run("ValueFrom nil entries gets included", func(t *testing.T) {
		t.Parallel()

		entry := config.CustomAttribute{
			Key:       "custom",
			Default:   "value_different",
			ValueFrom: nil,
		}

		result := CleanupExpressionAttributes([]config.CustomAttribute{
			entry,
		})
		require.Len(t, result, 1)
		require.Equal(t, entry, result[0])
	})

	t.Run("Expression empty entries gets included", func(t *testing.T) {
		t.Parallel()

		entry := config.CustomAttribute{
			Key:     "custom",
			Default: "value_different",
			ValueFrom: &config.CustomDynamicAttribute{
				ContextField: "x-custom-header",
			},
		}

		result := CleanupExpressionAttributes([]config.CustomAttribute{
			entry,
		})

		require.Len(t, result, 1)
		require.Equal(t, entry, result[0])
	})

	t.Run("Skip expression entries", func(t *testing.T) {
		t.Parallel()

		valueFromNil := config.CustomAttribute{
			Key:       "custom",
			Default:   "value_different",
			ValueFrom: nil,
		}
		expressionPresent := config.CustomAttribute{
			Key:     "custom",
			Default: "value_different",
			ValueFrom: &config.CustomDynamicAttribute{
				ContextField: "x-custom-header",
				Expression:   "request.URL",
			},
		}
		expressionEmpty := config.CustomAttribute{
			Key:     "custom",
			Default: "value_different",
			ValueFrom: &config.CustomDynamicAttribute{
				ContextField: "x-custom-header",
				// Expression empty value is ""
			},
		}

		result := CleanupExpressionAttributes([]config.CustomAttribute{
			valueFromNil,
			expressionPresent,
			expressionEmpty,
		})

		require.Len(t, result, 2)
		require.Equal(t, valueFromNil, result[0])
		require.Equal(t, expressionEmpty, result[1])
	})

}
