package core

import (
	stdContext "context"
	"fmt"
	"math"
	"net/http"
	"sort"
	"sync"

	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/propagation"

	"github.com/pkg/errors"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphqlerrors"

	"go.uber.org/zap"
)

var (
	modules   = make(map[string]ModuleInfo)
	modulesMu sync.RWMutex
)

// ModuleRequestContext is the interface that provides the context for a single origin request.
type ModuleRequestContext interface {
	// RequestContext shared across all modules
	RequestContext
	// SendError returns the most recent error occurred while trying to make the origin request.
	SendError() error
}

type moduleRequestContext struct {
	*requestContext
	sendError error
}

// SendError returns the most recent error occurred while trying to make the origin request.
func (m *moduleRequestContext) SendError() error {
	return m.sendError
}

type ModuleID string

type ModuleInfo struct {
	// Name is the name of the module
	ID       ModuleID
	Priority int
	// New is the function that creates a new instance of the module
	New func() Module
}

type Module interface {
	Module() ModuleInfo
}

func RegisterModule(instance Module) {
	mod := instance.Module()

	if mod.ID == "" {
		panic("module ID missing")
	}
	if val := mod.New(); val == nil {
		panic("ModuleInfo.New must return a non-nil module instance")
	}

	modulesMu.Lock()
	defer modulesMu.Unlock()

	if _, ok := modules[string(mod.ID)]; ok {
		panic(fmt.Sprintf("module already registered: %s", mod.ID))
	}
	modules[string(mod.ID)] = mod
}

// sortModules sorts the modules by priority
func sortModules(modules []ModuleInfo) []ModuleInfo {
	sort.Slice(modules, func(x, y int) bool {
		priorityX := modules[x].Priority
		priorityY := modules[y].Priority
		leastPriority := math.MaxInt

		// If priority is 0, treat it as the lowest possible value
		if priorityX == 0 {
			priorityX = leastPriority
		}
		if priorityY == 0 {
			priorityY = leastPriority
		}

		return priorityX < priorityY
	})

	return modules
}

// Module Interfaces

// RouterMiddlewareHandler allows you to add middleware to the router.
// The middleware is called for every request. It allows you to modify the request before it is processed by the router.
// The same semantics of http.Handler apply here. Don't manipulate / consume the body of the request unless
// you know what you are doing. If you consume the body of the request, it will not be available for the next handler.
type RouterMiddlewareHandler interface {
	// Middleware is the middleware handler
	Middleware(ctx RequestContext, next http.Handler)
}

// RouterOnRequestHandler allows you to add middleware that runs before most internal router logic.
// This runs after the creation of the request context and the creation of the recovery handler.
// This hook is useful if you want to do some custom logic before tracing or authentication, for example,
// if you want to manipulate the bearer auth headers or add a header on a condition that tracing can log.
// The same semantics of http.Handler apply here. Don't manipulate / consume the body of the request unless
// you know what you are doing. If you consume the body of the request, it will not be available for the next handler.
type RouterOnRequestHandler interface {
	RouterOnRequest(ctx RequestContext, next http.Handler)
}

// EnginePreOriginHandler allows you to add a handler to the router engine origin requests.
// The handler is called before the request is sent to the origin. All origin handlers are called sequentially.
// It allows you to modify the request before it is sent or return a custom response. The same semantics of http.RoundTripper apply here.
// Don't manipulate / consume the body of the request unless you know what you are doing.
// If you consume the body of the request, it will not be available for the next handler.
type EnginePreOriginHandler interface {
	// OnOriginRequest is called before the request is sent to the origin
	// Might be called multiple times if there are multiple origins
	OnOriginRequest(req *http.Request, ctx RequestContext) (*http.Request, *http.Response)
}

// EnginePostOriginHandler allows you to add a handler to the router engine origin requests.
// The handler is called after the response was received from the origin. All origin handlers are called sequentially.
// It allows you to return a custom response to the client. If you return a nil response, the next handler is called.
// The same semantics of http.RoundTripper apply here. To modify the response, you have to return a new response.
type EnginePostOriginHandler interface {
	// OnOriginResponse is called after the request is sent to the origin.
	// Might be called multiple times if there are multiple origins
	OnOriginResponse(resp *http.Response, ctx RequestContext) *http.Response
}

// TracePropagationProvider is an interface that allows you to provide custom trace propagators.
// The trace propagators are used to inject and extract trace information from the request.
// The provided propagators will be used in addition to the configured propagators.
type TracePropagationProvider interface {
	// TracePropagators returns the custom trace propagators which should be used by the router.
	TracePropagators() []propagation.TextMapPropagator
}

// SpanNameFormatterFunc returns the OpenTelemetry span name for an HTTP
// request.
type SpanNameFormatterFunc func(r *http.Request) string

// SpanNameFormatterProvider is a module interface for customizing span names.
// The returned function wraps the next formatter in the chain. Multiple modules
// implementing this interface compose in module Priority order (lower priority
// = outer wrapper). Wrappers SHOULD delegate to next for the default behavior.
type SpanNameFormatterProvider interface {
	WrapSpanNameFormatter(next SpanNameFormatterFunc) SpanNameFormatterFunc
}

// Provisioner is called before the server starts
// It allows you to initialize your module, e.g., create a database connection
// or load a configuration file.
type Provisioner interface {
	// Provision is called before the server starts
	Provision(*ModuleContext) error
}

// ModuleConfig is the read-only configuration snapshot passed to a ConfigHandler.
// Modules may retain it after the callback and read it concurrently. The router
// supplies the implementation so future releases can add config accessors.
type ModuleConfig interface {
	// ExecutionConfig returns the base graph's execution config for this snapshot.
	ExecutionConfig() routerconfig.ExecutionConfig
	// FeatureFlagConfig returns the execution config for the exact name of an
	// active feature flag. An empty or unknown name returns the zero value and false.
	FeatureFlagConfig(name string) (routerconfig.ExecutionConfig, bool)

	isModuleConfig()
}

// The empty key identifies the base graph, as it does in graphServer.graphMuxList.
type moduleConfig struct {
	graphs map[string]routerconfig.ExecutionConfig
}

func (c *moduleConfig) ExecutionConfig() routerconfig.ExecutionConfig { return c.graphs[""] }

func (c *moduleConfig) FeatureFlagConfig(name string) (routerconfig.ExecutionConfig, bool) {
	if name == "" {
		return routerconfig.ExecutionConfig{}, false
	}
	cfg, ok := c.graphs[name]
	return cfg, ok
}

func (*moduleConfig) isModuleConfig() {}

// ConfigHandler observes the initial configuration and every successful
// execution config reload.
// The hook runs synchronously, in module priority order, after the new graph
// server has been built and before it starts serving requests. Invalid configs
// do not invoke it. The notification cannot reject a config.
//
// The hook can overlap requests using the previous graph. Modules must synchronize
// access to derived metadata and use ExecutionConfigFromContext to select the
// snapshot for the request, even while a newer config is being activated.
// A slow hook delays startup or reload. The config is an immutable snapshot that
// can be retained independently of ctx. The context controls work performed by
// the hook and should not be stored alongside the snapshot.
type ConfigHandler interface {
	OnConfigChange(ctx stdContext.Context, cfg ModuleConfig)
}

type Cleaner interface {
	// Cleanup is called after the server stops
	Cleanup() error
}

// ModuleContext is a type which defines the lifetime of modules that are registered with the router.
type ModuleContext struct {
	stdContext.Context
	Module Module
	Logger *zap.Logger
	// PrometheusMeterProvider creates instruments that are served on the router's
	// Prometheus endpoint, subject to the telemetry.metrics.prometheus settings
	// (e.g. exclude_metrics). It is never nil: when Prometheus metrics are disabled,
	// instruments created from it are not exported.
	PrometheusMeterProvider metric.MeterProvider
	// OTLPMeterProvider creates instruments that are exported through the router's
	// OTLP metric exporters, subject to the telemetry.metrics.otlp settings.
	// It is never nil: when OTLP metrics are disabled, instruments created from it
	// are not exported.
	OTLPMeterProvider metric.MeterProvider
}

// WriteResponseError writes the given error as a GraphQL error response to the http.ResponseWriter
// associated with the given RequestContext. If err is nil, a generic "Internal Error" error is returned.
// Please never write errors directly to the http.ResponseWriter. The function takes care of logging and tracking
// the error in the underlying telemetry system.
func WriteResponseError(ctx RequestContext, err error) {
	var errs graphqlerrors.RequestErrors
	var statusCode int

	if err != nil {
		if httpErr, ok := err.(HttpError); ok {
			statusCode = httpErr.StatusCode()
			errs = requestErrorsFromHttpError(httpErr)
		} else {
			statusCode = http.StatusInternalServerError
			errs = graphqlerrors.RequestErrorsFromError(err)
		}
	} else {
		statusCode = http.StatusInternalServerError
		errs = graphqlerrors.RequestErrorsFromError(errors.New("Internal Error"))
	}

	writeRequestErrors(writeRequestErrorsParams{
		request:       ctx.Request(),
		writer:        ctx.ResponseWriter(),
		statusCode:    statusCode,
		requestErrors: errs,
		logger:        ctx.Logger(),
	})
}
