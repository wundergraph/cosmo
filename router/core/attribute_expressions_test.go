package core

import (
	"reflect"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestVisitorCheckForRequestAuthAccess_Visit(t *testing.T) {
	for _, tt := range []struct {
		name            string
		expr            string
		expectedHasAuth bool
	}{
		{
			name:            "using request",
			expr:            "request != nil ? 'yes' : 'no'",
			expectedHasAuth: false,
		},
		{
			name:            "using request.auth",
			expr:            "request.auth != nil ? 'yes' : 'no'",
			expectedHasAuth: true,
		},
		{
			name:            "using request.auth.isAuthenticated",
			expr:            "request.auth.isAuthenticated ? 'yes' : 'no'",
			expectedHasAuth: true,
		},
		{
			name:            "using request.header",
			expr:            "request.header.Get('X-Header')",
			expectedHasAuth: false,
		},
		{
			name:            "using request.header and request.auth",
			expr:            "request.auth.isAuthenticated ? request.header.Get('X-Header') : ''",
			expectedHasAuth: true,
		},
		{
			name:            "using request.auth.scopes",
			expr:            "'test' in request.auth.scopes ? 'yes' : 'no'",
			expectedHasAuth: true,
		},
		{
			name:            "using request.auth.claims",
			expr:            "request.auth.claims['val'] == 'test' ? 'yes' : 'no'",
			expectedHasAuth: true,
		},
		{
			name:            "using request.url and request.auth.claims",
			expr:            "request.auth.claims['val'] == 'test' || request.url.path == '/test' ? 'yes' : 'no'",
			expectedHasAuth: true,
		},
		{
			name:            "using request.auth as an argument in a array function",
			expr:            "one(request.auth.scopes, # == 'test') ? 'yes' : 'no'",
			expectedHasAuth: true,
		},
		{
			name:            "using request.auth as an argument in a map function",
			expr:            "values(request.auth.claims) == ['test'] ? 'yes' : 'no'",
			expectedHasAuth: true,
		},
		{
			name:            "using request.auth as an argument of len and request url path",
			expr:            "request.url.path + string(len(request.auth.claims))",
			expectedHasAuth: true,
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			v := VisitorCheckForRequestAuthAccess{}
			manager := expr.CreateNewExprManager()
			out, err := manager.CompileExpression(tt.expr, reflect.String, &v)
			assert.NoError(t, err)
			assert.NotNil(t, out)
			assert.Equal(t, tt.expectedHasAuth, v.HasAuth)
		})
	}

}

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

	manager := expr.CreateNewExprManager()
	attrExpr, err := newAttributeExpressions(attrs, manager)
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

	val, err := attrExpr.expressionsAttributes(&reqCtx.expressionContext)
	assert.NoError(t, err)
	require.Len(t, val, 1)
	assert.Equal(t, "/some/path", val[0].Value.AsString())

	val2, err2 := attrExpr.expressionsAttributesWithAuth(&reqCtx.expressionContext)
	assert.NoError(t, err2)
	require.Len(t, val2, 1)
	assert.Equal(t, "yes", val2[0].Value.AsString())
}
