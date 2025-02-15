package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestNewAttributeExpressions_SplitsExpressionsUsingAuth(t *testing.T) {
	attrs := []config.CustomAttribute{
		{
			Key: "attr1",
			ValueFrom: &config.CustomDynamicAttribute{
				Expression: "request.url.path",
			},
		},
		{
			Key: "attr2",
			ValueFrom: &config.CustomDynamicAttribute{
				Expression: "request.auth.isAuthenticated == true ? 'yes' : 'no'",
			},
		},
	}

	attrExpr, err := newAttributeExpressions(attrs)
	assert.NoError(t, err)
	require.NotNil(t, attrExpr)
	assert.Contains(t, attrExpr.expressions, "attr1")
	assert.Contains(t, attrExpr.expressionsWithAuth, "attr2")

	reqCtx := requestContext{
		expressionContext: expr.Context{
			Request: expr.Request{
				URL: expr.RequestURL{
					Path: "/some/path",
				},
				Auth: expr.RequestAuth{
					IsAuthenticated: true,
				},
			},
		},
	}

	val, err := attrExpr.expressionsAttributes(&reqCtx)
	assert.NoError(t, err)
	require.Len(t, val, 1)
	assert.Equal(t, "/some/path", val[0].Value.AsString())

	val2, err2 := attrExpr.expressionsAttributesWithAuth(&reqCtx)
	assert.NoError(t, err2)
	require.Len(t, val2, 1)
	assert.Equal(t, "yes", val2[0].Value.AsString())
}
