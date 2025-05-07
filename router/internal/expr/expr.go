package expr

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/wundergraph/cosmo/router/pkg/authentication"

	"github.com/expr-lang/expr/file"
)

/**
* Naming conventions:
* - Fields are named using camelCaset.Run("verify name and id expressions", func(t *testing.T) {
		t.Parallel()
		metricReader := metric.NewManualReader()
		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
			MetricReader:  metricReader,
			CustomTracingAttributes: []config.CustomAttribute{
				{
					Key: "sg_name",
					ValueFrom: &config.CustomDynamicAttribute{
						Expression: "subgraph.name",
					},
				},
				{
					Key: "sg_id",
					ValueFrom: &config.CustomDynamicAttribute{
						Expression: "subgraph.id",
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query:  `query employees { employees { id details { forename surname } notes } }`,
				Header: map[string][]string{"service-name": {"service-name"}},
			})

			sn := exporter.GetSpans().Snapshots()
			engineFetchSpan := sn[6]
			require.Equal(t, "Engine - Fetch", engineFetchSpan.Name())
			require.Equal(t, trace.SpanKindInternal, engineFetchSpan.SpanKind())

			attributes := engineFetchSpan.Attributes()
			exprAttributes := attributes[14:]

			require.Len(t, exprAttributes, 2)

			sgName := findAttr(exprAttributes, "sg_name")
			require.Equal(t, "employees", sgName.Value.AsString())

			sgId := findAttr(exprAttributes, "sg_id")
			require.Equal(t, "0", sgId.Value.AsString())
		})
	})
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

type SubgraphExpressionContextKey struct{}

// Context is the context for expressions parser when evaluating dynamic expressions
type Context struct {
	Request  Request  `expr:"request"` // if changing the expr tag, the ExprRequestKey should be updated
	Subgraph Subgraph `expr:"subgraph"`
}

// Request is the context for the request object in expressions. Be aware, that only value receiver methods
// are exported in the expr environment. This is because the expressions are evaluated in a read-only context.
type Request struct {
	Auth      RequestAuth    `expr:"auth"` // if changing the expr tag, the ExprRequestAuthKey should be updated
	URL       RequestURL     `expr:"url"`
	Header    RequestHeaders `expr:"header"`
	Body      RequestBody    `expr:"body"`
	Error     error          `expr:"error"`
	Trace     Trace          `expr:"trace"`
	Operation Operation      `expr:"operation"`
	Client    Client         `expr:"client"`
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

type RequestBody struct {
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

type DNSStart struct {
	Time time.Time `expr:"time"`
	Host string    `expr:"host"`
}

type DNSDone struct {
	Time      time.Time `expr:"time"`
	Addresses []string  `expr:"addresses"`
	Coalesced bool      `expr:"coalesced"`
	Error     error     `expr:"error"`
}

type TLSStart struct {
	Time time.Time `expr:"time"`
}

type TLSDone struct {
	Time      time.Time `expr:"time"`
	Complete  bool      `expr:"complete"`
	DidResume bool      `expr:"didResume"`
	Version   string    `expr:"version"`
	Error     error     `expr:"error"`
}

type DialCombined struct {
	DialStartTime time.Time  `expr:"dialStartTime"`
	DialDoneTime  *time.Time `expr:"dialDoneTime"`
	Error         error      `expr:"error"`
	Network       string     `expr:"network"`
	Address       string     `expr:"address"`
}

type SubgraphDialStart struct {
	Time    time.Time `expr:"time"`
	Network string    `expr:"network"`
	Address string    `expr:"address"`
}

type SubgraphDialDone struct {
	Time    time.Time `expr:"time"`
	Network string    `expr:"network"`
	Address string    `expr:"address"`
	Error   error     `expr:"error"`
}

type WroteHeaders struct {
	Time time.Time `expr:"time"`
}

type Wait100Continue struct {
	Time time.Time `expr:"time"`
}

type WroteRequest struct {
	Time  time.Time `expr:"time"`
	Error error     `expr:"error"`
}

type FirstByte struct {
	Time time.Time `expr:"time"`
}
type Continue100 struct {
	Time time.Time `expr:"time"`
}

type AcquiredConnection struct {
	Time     time.Time     `expr:"time"`
	Reused   bool          `expr:"reused"`
	WasIdle  bool          `expr:"wasIdle"`
	IdleTime time.Duration `expr:"idleTime"`
}

type CreateConnection struct {
	Time     time.Time `expr:"time"`
	HostPort string    `expr:"hostPort"`
}

type PutIdleConnection struct {
	Time  time.Time `expr:"time"`
	Error error     `expr:"error"`
}

type ClientTrace struct {
	ConnectionCreate   *CreateConnection   `expr:"connCreate"`
	ConnectionAcquired *AcquiredConnection `expr:"connAcquired"`
	DNSStart           *DNSStart           `expr:"dnsStart"`
	DNSDone            *DNSDone            `expr:"dnsDone"`
	TLSStart           *TLSStart           `expr:"tlsStart"`
	TLSDone            *TLSDone            `expr:"tlsDone"`
	DialStart          []SubgraphDialStart `expr:"dialStart"`
	DialDone           []SubgraphDialDone  `expr:"dialDone"`
	WroteHeaders       *WroteHeaders       `expr:"wroteHeaders"`
	WroteRequest       *WroteRequest       `expr:"wroteRequest"`
	FirstByte          *FirstByte          `expr:"firstByte"`
}

// Subgraph Related
type Subgraph struct {
	Id      string          `expr:"id"`
	Name    string          `expr:"name"`
	Request SubgraphRequest `expr:"request"`
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
