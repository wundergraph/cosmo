package expr

import (
	"fmt"
	"math/rand/v2"

	exprlang "github.com/expr-lang/expr"
	"github.com/expr-lang/expr/ast"
	"github.com/expr-lang/expr/vm"
)

// AccessLogContext includes the ordinary expression sources and the final log fields.
// Log is local to a single entry. Durations retain their time.Duration type.
type AccessLogContext struct {
	Context
	Log map[string]any `expr:"log"`
}

// CompileAccessLogFilter shares the visitors used by log attributes so references
// in filters also enable body capture, client tracing, hashes and variables.
func (c *Manager) CompileAccessLogFilter(expression string, visitors ...ast.Visitor) (*vm.Program, error) {
	if expression == "" {
		return nil, nil
	}
	options := mergeOptions(exprlang.AsBool(), visitors)
	options = append(options,
		exprlang.Env(AccessLogContext{}),
		exprlang.Function("rand", func(params ...any) (any, error) {
			return rand.Float64(), nil
		}, new(func() float64)),
	)
	return c.compileExpressionWithExprOptions(options, expression)
}

func ResolveAccessLogFilter(program *vm.Program, ctx AccessLogContext) (bool, error) {
	if program == nil {
		return true, nil
	}
	result, err := exprlang.Run(program, ctx)
	if err != nil {
		return false, handleExpressionError(err)
	}
	resultBool, ok := result.(bool)
	if !ok {
		return false, fmt.Errorf("access log filter must return a boolean, got %T", result)
	}
	return resultBool, nil
}
