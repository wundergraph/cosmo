package core

import (
	"errors"
	"fmt"
	"reflect"

	"github.com/expr-lang/expr/vm"

	"github.com/wundergraph/cosmo/router/internal/expr"
)

// responseCachePrivateID resolves, per request, the id of the user private
// responses are cached for.
type responseCachePrivateID struct {
	program *vm.Program
}

// newResponseCachePrivateID compiles a private_id expression. An empty one
// yields nil, which resolves to no id.
func newResponseCachePrivateID(expression string, mgr *expr.Manager) (*responseCachePrivateID, error) {
	if expression == "" {
		return nil, nil
	}
	program, err := mgr.CompileExpression(expression, reflect.String)
	if err != nil {
		return nil, fmt.Errorf("response cache private_id: %w", err)
	}
	return &responseCachePrivateID{program: program}, nil
}

// resolve evaluates the expression. A nil result, such as a claim an anonymous
// request does not carry, is no id and not an error; a non-string result is
// reported and is no id either.
func (p *responseCachePrivateID) resolve(ctx expr.Context, onError func(error)) string {
	if p == nil {
		return ""
	}
	value, err := expr.ResolveStringExpression(p.program, ctx)
	if err != nil {
		if onError != nil && !errors.Is(err, expr.ErrNilResult) {
			onError(fmt.Errorf("response cache private_id: %w", err))
		}
		return ""
	}
	return value
}
