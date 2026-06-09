package harness

import (
	"errors"
	"strings"

	"github.com/tdewolff/parse/v2"
	"github.com/tdewolff/parse/v2/js"
)

const shapeErrorPrefix = "code mode: source must be a single async-arrow root (got: "

// ShapeCheck verifies that the given JavaScript source is exactly one
// top-level expression statement whose expression is an async arrow function.
//
// Input contract: ShapeCheck expects the *post-esbuild* JavaScript. TypeScript
// syntax is stripped earlier in the pipeline by Transpile (esbuild loaderTS).
// Callers must run Transpile first.
//
// Note: parse error messages from tdewolff include line/col positions for the
// post-esbuild source, NOT the original TS source the user wrote. That's
// acceptable because (a) ShapeCheck failures are structural, not character-level,
// and (b) Transpile already surfaces TS-source diagnostics for syntactic errors.
func ShapeCheck(source string) error {
	if strings.TrimSpace(source) == "" {
		return shapeError("empty source")
	}

	ast, err := js.Parse(parse.NewInputBytes([]byte(source)), js.Options{})
	if err != nil {
		return shapeError("parse failed: " + err.Error())
	}

	stmts := ast.BlockStmt.List
	if len(stmts) == 0 {
		return shapeError("empty source")
	}

	// Detect import/export *before* the multi-statement check. Otherwise an
	// input like `import x from "x"; async () => x` would report
	// "multiple statements" instead of the more useful "leading import/export".
	switch stmts[0].(type) {
	case *js.ImportStmt, *js.ExportStmt:
		return shapeError("leading import/export")
	}

	if len(stmts) > 1 {
		return shapeError("multiple statements")
	}

	switch stmt := stmts[0].(type) {
	case *js.ExprStmt:
		return checkExpression(stmt.Value)
	default:
		return shapeError("non-arrow root")
	}
}

// checkExpression verifies the expression is an async arrow function,
// transparently unwrapping any number of redundant parentheses.
func checkExpression(expr js.IExpr) error {
	for {
		group, ok := expr.(*js.GroupExpr)
		if !ok {
			break
		}
		expr = group.X
	}

	if isTopLevelAwait(expr) {
		return shapeError("top-level await")
	}

	arrow, ok := expr.(*js.ArrowFunc)
	if !ok {
		return shapeError("non-arrow root")
	}
	if !arrow.Async {
		return shapeError("missing async modifier")
	}
	return nil
}

// isTopLevelAwait detects `await x` used as a top-level expression. tdewolff
// parses await as a UnaryExpr with the Await operator. We surface this as a
// distinct error because it's a common model mistake worth flagging clearly.
func isTopLevelAwait(expr js.IExpr) bool {
	unary, ok := expr.(*js.UnaryExpr)
	if !ok {
		return false
	}
	return unary.Op == js.AwaitToken
}

func shapeError(reason string) error {
	return errors.New(shapeErrorPrefix + reason + ")")
}
