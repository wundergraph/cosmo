package expr

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/expr-lang/expr/file"
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

const ExprRequestKey = "request"
const ExprRequestAuthKey = "auth"

// Context is the context for expressions parser when evaluating dynamic expressions
type Context struct {
	Request  Request  `expr:"request"` // if changing the expr tag, the ExprRequestKey should be updated
	Response Response `expr:"response"`
	Subgraph Subgraph `expr:"subgraph"`
}

// Clone creates a deep copy of the Context
func (copyCtx Context) Clone() *Context {
	// the method receiver copyCtx is already a copy
	// so we just need to make sure any pointer values are copied
	scopes := make([]string, len(copyCtx.Request.Auth.Scopes))
	copy(scopes, copyCtx.Request.Auth.Scopes)
	copyCtx.Request.Auth.Scopes = scopes

	claims := make(map[string]any, len(copyCtx.Request.Auth.Claims))
	for k, v := range copyCtx.Request.Auth.Claims {
		claims[k] = v
	}
	copyCtx.Request.Auth.Claims = claims

	query := make(map[string]string, len(copyCtx.Request.URL.Query))
	for k, v := range copyCtx.Request.URL.Query {
		query[k] = v
	}
	copyCtx.Request.URL.Query = query

	return &copyCtx
}

// Request is the context for the request object in expressions. Be aware, that only value receiver methods
// are exported in the expr environment. This is because the expressions are evaluated in a read-only context.
type Request struct {
	Auth      RequestAuth    `expr:"auth"` // if changing the expr tag, the ExprRequestAuthKey should be updated
	URL       RequestURL     `expr:"url"`
	Header    RequestHeaders `expr:"header"`
	Body      Body           `expr:"body"`
	Trace     Trace          `expr:"trace"`
	Operation Operation      `expr:"operation"`
	Client    Client         `expr:"client"`
	Error     error          `expr:"error"`
}

type Response struct {
	Body Body `expr:"body"`
}

type Operation struct {
	Name string `expr:"name"`
	Type string `expr:"type"`
	Hash string `expr:"hash"`
}

type Client struct {
	Name    string `expr:"name"`
	Version string `expr:"version"`
	IP      string `expr:"ip"`
}

type Body struct {
	Raw string `expr:"raw"`
}

type Trace struct {
	Sampled bool `expr:"sampled"`
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

type RequestAuth struct {
	IsAuthenticated bool           `expr:"isAuthenticated"`
	Type            string         `expr:"type"`
	Claims          map[string]any `expr:"claims"`
	Scopes          []string       `expr:"scopes"`
}

type SubgraphRequest struct {
	Error       error       `expr:"error"`
	ClientTrace ClientTrace `expr:"clientTrace"`
}

type SubgraphResponse struct {
	Body Body `expr:"body"`
}

type ClientTrace struct {
	FetchDuration             time.Duration `expr:"fetchDuration"`
	ConnectionAcquireDuration time.Duration `expr:"connAcquireDuration"`
}

// Subgraph Related
type Subgraph struct {
	Id       string           `expr:"id"`
	Name     string           `expr:"name"`
	Request  SubgraphRequest  `expr:"request"`
	Response SubgraphResponse `expr:"response"`
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
