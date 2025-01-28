package expr

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"reflect"

	"github.com/expr-lang/expr"
	"github.com/expr-lang/expr/file"
	"github.com/expr-lang/expr/vm"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
)

/**
* Naming conventions:
* - Fields are named using camelCase
* - Methods are named using PascalCase (Required to be exported)
* - Methods should be exported through a custom type to avoid exposing accidental methods that can mutate the context
* - Use interface to expose only the required methods. Blocked by https://github.com/expr-lang/expr/issues/744
*
* Principles:
* The Expr package is used to evaluate expressions in the context of the request or router.
* The user should never be able to mutate the context or any other application state.
*
* Recommendations:
* If possible function calls should be avoided in the expressions as they are much more expensive.
* See https://github.com/expr-lang/expr/issues/734
 */

// Context is the context for expressions parser when evaluating dynamic expressions
type Context struct {
	Request Request `expr:"request"`
}

// Request is the context for the request object in expressions. Be aware, that only value receiver methods
// are exported in the expr environment. This is because the expressions are evaluated in a read-only context.
type Request struct {
	Auth   RequestAuth    `expr:"auth"`
	URL    RequestURL     `expr:"url"`
	Header RequestHeaders `expr:"header"`
	Error  error          `expr:"error"`
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

type RequestHeaders struct {
	Header http.Header `expr:"-"` // Do not expose the full header
}

// Get returns the value of the header with the given key. If the header is not present, an empty string is returned.
// The key is case-insensitive and transformed to the canonical format.
// TODO: Use interface to expose only the required methods. Blocked by https://github.com/expr-lang/expr/issues/744
func (r RequestHeaders) Get(key string) string {
	return r.Header.Get(key)
}

// LoadRequest loads the request object into the context.
func LoadRequest(req *http.Request) Request {
	r := Request{
		Header: RequestHeaders{
			Header: req.Header,
		},
	}

	m, _ := url.ParseQuery(req.URL.RawQuery)
	qv := make(map[string]string, len(m))

	for k := range m {
		qv[k] = m.Get(k)
	}

	r.URL = RequestURL{
		Method: req.Method,
		Scheme: req.URL.Scheme,
		Host:   req.URL.Host,
		Path:   req.URL.Path,
		Query:  qv,
	}

	return r
}

type RequestAuth struct {
	IsAuthenticated bool           `expr:"isAuthenticated"`
	Type            string         `expr:"type"`
	Claims          map[string]any `expr:"claims"`
	Scopes          []string       `expr:"scopes"`
}

// LoadAuth loads the authentication context into the request object.
// Must only be called when the authentication was successful.
func LoadAuth(ctx context.Context) RequestAuth {
	authCtx := authentication.FromContext(ctx)
	if authCtx == nil {
		return RequestAuth{}
	}

	return RequestAuth{
		Type:            authCtx.Authenticator(),
		IsAuthenticated: true,
		Claims:          authCtx.Claims(),
		Scopes:          authCtx.Scopes(),
	}
}

func compileOptions(extra ...expr.Option) []expr.Option {
	options := []expr.Option{
		expr.Env(Context{}),
	}
	options = append(options, extra...)
	return options
}

// CompileBoolExpression compiles an expression and returns the program. It is used for expressions that return bool.
// The exprContext is used to provide the context for the expression evaluation. Not safe for concurrent use.
func CompileBoolExpression(s string) (*vm.Program, error) {
	v, err := expr.Compile(s, compileOptions(expr.AsBool())...)
	if err != nil {
		return nil, handleExpressionError(err)
	}
	return v, nil
}

// CompileStringExpression compiles an expression and returns the program. It is used for expressions that return strings
// The exprContext is used to provide the context for the expression evaluation. Not safe for concurrent use.
func CompileStringExpression(s string) (*vm.Program, error) {
	v, err := expr.Compile(s, compileOptions(expr.AsKind(reflect.String))...)
	if err != nil {
		return nil, handleExpressionError(err)
	}
	return v, nil
}

func CompileAnyExpression(s string) (*vm.Program, error) {
	v, err := expr.Compile(s, compileOptions()...)
	if err != nil {
		return nil, handleExpressionError(err)
	}
	return v, nil
}

// ResolveStringExpression evaluates the expression and returns the result as a string. The exprContext is used to
// provide the context for the expression evaluation. Not safe for concurrent use.
func ResolveStringExpression(vm *vm.Program, ctx Context) (string, error) {
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
// provide the context for the expression evaluation. Not safe for concurrent use.
func ResolveBoolExpression(vm *vm.Program, ctx Context) (bool, error) {
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
