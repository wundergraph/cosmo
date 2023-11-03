package core

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"syscall"
	"time"

	"github.com/wundergraph/cosmo/router/internal/otel"
	"github.com/wundergraph/cosmo/router/internal/retrytransport"
	"github.com/wundergraph/cosmo/router/internal/trace"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	otrace "go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

const (
	// dockerInternalHost is the hostnamed used by docker to access the host machine.
	// We use it for automatic fallbacks when requests to localhost fail
	dockerInternalHost = "host.docker.internal"
)

type TransportPreHandler func(req *http.Request, ctx RequestContext) (*http.Request, *http.Response)
type TransportPostHandler func(resp *http.Response, ctx RequestContext) *http.Response

type CustomTransport struct {
	roundTripper http.RoundTripper
	preHandlers  []TransportPreHandler
	postHandlers []TransportPostHandler
	logger       *zap.Logger
}

func NewCustomTransport(logger *zap.Logger, roundTripper http.RoundTripper, retryOptions retrytransport.RetryOptions) *CustomTransport {

	if retryOptions.Enabled {
		return &CustomTransport{
			roundTripper: retrytransport.NewRetryHTTPTransport(roundTripper, retryOptions, logger),
		}
	}

	return &CustomTransport{
		roundTripper: roundTripper,
	}
}

func (ct *CustomTransport) requestIsIgnoredByMiddleware(r *http.Request) bool {
	// Intentionally ignore websocket requests
	return r.Header.Get("Upgrade") != ""
}

func (ct *CustomTransport) RoundTrip(req *http.Request) (*http.Response, error) {

	reqContext := getRequestContext(req.Context())

	isIgnored := ct.requestIsIgnoredByMiddleware(req)

	if !isIgnored && ct.preHandlers != nil {
		for _, preHandler := range ct.preHandlers {
			r, resp := preHandler(req, reqContext)
			// Non nil response means the handler decided to skip sending the request
			if resp != nil {
				return resp, nil
			}
			req = r
		}
	}

	resp, err := ct.roundTripper.RoundTrip(req)

	// Set the error on the request context so that it can be checked by the post handlers
	if err != nil {
		reqContext.sendError = err
	}

	if !isIgnored && ct.postHandlers != nil {
		for _, postHandler := range ct.postHandlers {
			newResp := postHandler(resp, reqContext)
			// Abort with the first handler that returns a non-nil response
			if newResp != nil {
				return newResp, nil
			}
		}
	}

	if err != nil {
		return nil, err
	}

	return resp, err
}

func isRunningInsideDocker() bool {
	// Check if we are running inside docker by
	// testing by checking if /.dockerenv exists
	st, err := os.Stat("/.dockerenv")
	return err == nil && !st.IsDir()
}

// localhostFallbackRoundTripper is an http.RoundTripper that will retry failed
// requests to localhost by rewriting the request to use is targetHost. Only
// requests that fail with ECONNREFUSED will be retried.
type localhostFallbackRoundTripper struct {
	targetHost string
	transport  http.RoundTripper
}

func (*localhostFallbackRoundTripper) pointsToLocalhost(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.Host)
	if err != nil {
		host = r.Host
	}
	ip := net.ParseIP(host)
	if ip != nil {
		return ip.IsLoopback()
	}
	return host == "localhost"
}

func (t *localhostFallbackRoundTripper) rewriteToTargetHost(r *http.Request) (*http.Request, error) {
	var newHost string
	_, port, err := net.SplitHostPort(r.Host)
	if err == nil {
		newHost = t.targetHost + ":" + port
	} else {
		newHost = t.targetHost
	}
	newReq, err := http.NewRequestWithContext(r.Context(), r.Method, fmt.Sprintf("%s://%s%s", r.URL.Scheme, newHost, r.URL.Path), r.Body)
	if err != nil {
		return nil, err
	}
	newReq.Header = r.Header
	return newReq, nil
}

func (t *localhostFallbackRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) {
	// If the request has a body, we need to buffer it, otherwise it will
	// get consumed
	var bodyData []byte
	if r.Body != nil {
		var err error
		bodyData, err = io.ReadAll(r.Body)
		if err != nil {
			return nil, fmt.Errorf("failed to read request body: %w", err)
		}
		r.Body.Close()
		r.Body = io.NopCloser(bytes.NewReader(bodyData))
	}
	resp, err := t.transport.RoundTrip(r)
	if err != nil && t.pointsToLocalhost(r) && errors.Is(err, syscall.ECONNREFUSED) {
		// Retry the request
		if bodyData != nil {
			r.Body = io.NopCloser(bytes.NewReader(bodyData))
		}
		redirected, err := t.rewriteToTargetHost(r)
		if err != nil {
			return nil, fmt.Errorf("error creating redirected request to %s: %w", t.targetHost, err)
		}
		resp2, err2 := t.transport.RoundTrip(redirected)
		if err2 == nil {
			return resp2, nil
		}
	}
	// If the redirect fails, return the original error
	return resp, err
}

type TransportFactory struct {
	preHandlers                    []TransportPreHandler
	postHandlers                   []TransportPostHandler
	retryOptions                   retrytransport.RetryOptions
	requestTimeout                 time.Duration
	translateLocalhostInsideDocker bool
	logger                         *zap.Logger
}

var _ ApiTransportFactory = TransportFactory{}

type TransportOptions struct {
	PreHandlers                    []TransportPreHandler
	PostHandlers                   []TransportPostHandler
	RetryOptions                   retrytransport.RetryOptions
	RequestTimeout                 time.Duration
	TranslateLocalhostInsideDocker bool
	Logger                         *zap.Logger
}

func NewTransport(opts *TransportOptions) *TransportFactory {
	if opts.TranslateLocalhostInsideDocker && isRunningInsideDocker() {
		if opts.Logger != nil {
			opts.Logger.Debug("transport: translating localhost to host.docker.internal")
		}
	}

	return &TransportFactory{
		preHandlers:                    opts.PreHandlers,
		postHandlers:                   opts.PostHandlers,
		retryOptions:                   opts.RetryOptions,
		requestTimeout:                 opts.RequestTimeout,
		translateLocalhostInsideDocker: opts.TranslateLocalhostInsideDocker,
		logger:                         opts.Logger,
	}
}

func (t TransportFactory) RoundTripper(transport http.RoundTripper, enableStreamingMode bool) http.RoundTripper {
	if t.translateLocalhostInsideDocker && isRunningInsideDocker() {
		transport = &localhostFallbackRoundTripper{
			transport:  transport,
			targetHost: dockerInternalHost,
		}
	}
	traceTransport := trace.NewTransport(
		transport,
		[]otelhttp.Option{
			otelhttp.WithSpanNameFormatter(SpanNameFormatter),
			otelhttp.WithSpanOptions(otrace.WithAttributes(otel.EngineTransportAttribute)),
		},
		trace.WithPreHandler(func(r *http.Request) {
			span := otrace.SpanFromContext(r.Context())
			reqContext := getRequestContext(r.Context())
			operation := reqContext.operation

			if operation != nil {
				if operation.name != "" {
					span.SetAttributes(otel.WgOperationName.String(operation.name))
				}
				if operation.opType != "" {
					span.SetAttributes(otel.WgOperationType.String(operation.opType))
				}
				if operation.hash != 0 {
					span.SetAttributes(otel.WgOperationHash.String(strconv.FormatUint(operation.hash, 10)))
				}
			}

			subgraph := reqContext.ActiveSubgraph(r)
			if subgraph != nil {
				span.SetAttributes(otel.WgSubgraphID.String(subgraph.Id))
				span.SetAttributes(otel.WgSubgraphName.String(subgraph.Name))
			}

		}),
	)
	tp := NewCustomTransport(
		t.logger,
		traceTransport,
		t.retryOptions,
	)

	tp.preHandlers = t.preHandlers
	tp.postHandlers = t.postHandlers
	tp.logger = t.logger

	return tp
}

func (t TransportFactory) DefaultTransportTimeout() time.Duration {
	return t.requestTimeout
}

func (t TransportFactory) DefaultHTTPProxyURL() *url.URL {
	return nil
}

// SpanNameFormatter formats the span name based on the http request
func SpanNameFormatter(_ string, r *http.Request) string {
	opCtx := getOperationContext(r.Context())
	if opCtx != nil {
		return GetSpanName(opCtx.Name(), opCtx.Type())
	}

	return fmt.Sprintf("%s %s", r.Method, r.URL.Path)
}

func GetSpanName(operationName string, operationType string) string {
	if operationName != "" {
		return fmt.Sprintf("%s %s", operationType, operationName)
	}
	return fmt.Sprintf("%s %s", operationType, "unnamed")
}
