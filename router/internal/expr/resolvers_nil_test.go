package expr

import (
	"reflect"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestResolveStringExpressionNil(t *testing.T) {
	t.Parallel()

	program, err := CreateNewExprManager().CompileExpression("request.auth.claims.sub", reflect.String)
	require.NoError(t, err)

	_, err = ResolveStringExpression(program, Context{})
	require.ErrorIs(t, err, ErrNilResult)

	value, err := ResolveStringExpression(program, Context{Request: Request{Auth: RequestAuth{Claims: map[string]any{"sub": "u1"}}}})
	require.NoError(t, err)
	require.Equal(t, "u1", value)

	_, err = ResolveStringExpression(program, Context{Request: Request{Auth: RequestAuth{Claims: map[string]any{"sub": 42}}}})
	require.Error(t, err)
	require.NotErrorIs(t, err, ErrNilResult)
}
