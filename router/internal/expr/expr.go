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
	Request Request `expr:"request"`
}

// Request is the context for the request object in expressions. Be aware, that only value receiver methods
// are exported in the expr environment. This is because the expressions are evaluated in a read-only context.
type Request struct {
	Auth   RequestAuth    `expr:"auth"`
	URL    RequestURL     `expr:"url"`
	Header RequestHeaders `expr:"header"`
}

// RequestURL is the context for the URL object in expressions
// it is limited in scope to the URL object and its components. For convenience, the query parameters are parsed.
type RequestURL struct {
	Method string `expr:"method"`
	// Scheme is the scheme of the URL
	Scheme string `expr:"scheme"`
	// Host is the host of the URL
	Host string `expr:"host"`
	// Path is the path of the URL
	Path string `expr:"path"`
	// Query is the parsed query parameters
	Query map[string]string `expr:"query"`
}

// RequestHeaders is the context for the headers object in expressions. A user can access the headers directly by
// key and get the array representation of the header values or use the Get method to get the first value.
type RequestHeaders map[string][]string

// Get returns the first value associated with the given key (Exported).
// For convenience, we export a function to make the work with headers case-insensitive.
func (r RequestHeaders) Get(key string) string {
	return http.Header(r).Get(key)
}

// LoadRequest loads the request object into the context.
func (r *RequestRootContext) LoadRequest(req *http.Request) {
	if req == nil {
		return
	}

	r.Request.Header = RequestHeaders(req.Header)

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
	IsAuthenticated bool           `expr:"isAuthenticated"`
	Type            string         `expr:"type"`
	Claims          map[string]any `expr:"claims"`
	Scopes          []string       `expr:"scopes"`
}

// LoadAuth loads the authentication context into the request object.
// Must only be called when the authentication was successful.
func (r *RequestRootContext) LoadAuth(ctx context.Context) {
	authCtx := authentication.FromContext(ctx)
	if authCtx == nil {
		return
	}

	r.Request.Auth.Type = authCtx.Authenticator()
	r.Request.Auth.IsAuthenticated = true
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
