package requestlogger

import (
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"testing"
)

func TestAccessLogExpressionParsing(t *testing.T) {
	t.Parallel()

	t.Run("no expression attributes", func(t *testing.T) {
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

		expressions, err := GetAccessLogConfigExpressions(customAttributes)
		if err != nil {
			require.Fail(t, "unexpected error", err)
		}

		require.Empty(t, expressions)
	})

	t.Run("parse expression attributes", func(t *testing.T) {
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

		expressions, err := GetAccessLogConfigExpressions(customAttributes)
		require.NoError(t, err)

		require.Equal(t, 2, len(expressions))

		// Validate the validity of the entry
		entry1 := expressions[0]
		require.Equal(t, entry1.Key, "expr1")
		require.Equal(t, entry1.Default, "value_different1")
		require.NotNil(t, entry1.Expr)
	})

	t.Run("failure on parsing the expression", func(t *testing.T) {
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

		_, err := GetAccessLogConfigExpressions(customAttributes)
		if err != nil {
			require.Error(t, err)
			return
		}

		require.Fail(t, "error should have been detected")
	})
}
