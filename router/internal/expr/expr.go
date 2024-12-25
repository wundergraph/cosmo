package expr

import (
	"context"
	"errors"
	"fmt"
	"github.com/expr-lang/expr"
	"github.com/expr-lang/expr/file"
	"github.com/expr-lang/expr/vm"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"net/http"
	"net/url"
	"reflect"
)

// RequestRootContext is the context for expressions parser when evaluating dynamic expressions
// If possible function calls should be avoided in the expressions as they are much more expensive
// See https://github.com/expr-lang/expr/issues/734
type RequestRootContext struct {
	Request RequestContext
}

// RequestContext is the context for the request object in expressions. Be aware, that only value receiver methods
// are exported in the expr environment. This is because the expressions are evaluated in a read-only context.
type RequestContext struct {
	Auth   RequestAuth
	Header RequestHeaders
	URL    RequestURL
}

// RequestURL is the context for the URL object in expressions
// it is limited in scope to the URL object and its components. For convenience, the query parameters are parsed.
type RequestURL struct {
	Method string
	Scheme string
	Host   string
	Path   string
	Query  map[string]string
}

// RequestHeaders is the context for the headers object in expressions
type RequestHeaders struct {
	Header http.Header
}

// Get returns the first value associated with the given key (Exported).
// For convenience, we export a function to make the work with headers case-insensitive.
func (r RequestHeaders) Get(key string) string {
	return r.Header.Get(key)
}

// LoadRequest loads the request object into the context.
func (r *RequestRootContext) LoadRequest(req *http.Request) {
	if req == nil {
		return
	}

	r.Request.Header.Header = req.Header

	m, _ := url.ParseQuery(req.URL.RawQuery)
	qv := make(map[string]string, len(m))

	for k := range m {
		qv[k] = m.Get(k)
	}

	r.Request.URL = RequestURL{
		Method: req.Method,
		Scheme: req.URL.Scheme,
		Host:   req.URL.Host,
		Path:   req.URL.Path,
		Query:  qv,
	}
}

type RequestAuth struct {
	Claims map[string]any
	Scopes []string
}

// LoadAuth loads the authentication context into the request object.
func (r *RequestRootContext) LoadAuth(ctx context.Context) {
	authCtx := authentication.FromContext(ctx)
	if authCtx == nil {
		return
	}

	r.Request.Auth.Claims = authCtx.Claims()
	r.Request.Auth.Scopes = authCtx.Scopes()
}

// CompileBoolExpression compiles an expression and returns the program. It is used for expressions that return bool.
// The exprContext is used to provide the context for the expression evaluation.
func CompileBoolExpression(s string) (*vm.Program, error) {
	v, err := expr.Compile(s, expr.Env(RequestRootContext{}), expr.AsBool())
	if err != nil {
		return nil, handleExpressionError(err)
	}

	return v, nil
}

// CompileStringExpression compiles an expression and returns the program. It is used for expressions that return strings
// The exprContext is used to provide the context for the expression evaluation.
func CompileStringExpression(s string) (*vm.Program, error) {
	v, err := expr.Compile(s, expr.Env(RequestRootContext{}), expr.AsKind(reflect.String))
	if err != nil {
		return nil, handleExpressionError(err)
	}

	return v, nil
}

// ResolveStringExpression evaluates the expression and returns the result as a string. The exprContext is used to
// provide the context for the expression evaluation.
func ResolveStringExpression(vm *vm.Program, ctx RequestRootContext) (string, error) {
	r, err := expr.Run(vm, ctx)
	if err != nil {
		return "", handleExpressionError(err)
	}

	switch v := r.(type) {
	case string:
		return v, nil
	default:
		return "", fmt.Errorf("expected string, got %T", r)
	}
}

// ResolveBoolExpression evaluates the expression and returns the result as a bool. The exprContext is used to
// provide the context for the expression evaluation.
func ResolveBoolExpression(vm *vm.Program, ctx RequestRootContext) (bool, error) {
	if vm == nil {
		return false, nil
	}

	r, err := expr.Run(vm, ctx)
	if err != nil {
		return false, handleExpressionError(err)
	}

	switch v := r.(type) {
	case bool:
		return v, nil
	default:
		return false, fmt.Errorf("failed to run expression: expected bool, got %T", r)
	}
}

func handleExpressionError(err error) error {
	if err == nil {
		return nil
	}

	var fileError *file.Error
	if errors.As(err, &fileError) {
		return fmt.Errorf("line %d, column %d: %s", fileError.Line, fileError.Column, fileError.Message)
	}

	return err
}
