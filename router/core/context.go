package core

import (
	"context"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/authentication"
	ctrace "github.com/wundergraph/cosmo/router/internal/trace"
)

type key string

const requestContextKey = key("request")
const subgraphsContextKey = key("subgraphs")

var _ RequestContext = (*requestContext)(nil)

type Subgraph struct {
	Id   string
	Name string
	Url  *url.URL
}

type ClientInfo struct {
	// Name contains the client name, derived from the request headers
	Name string
	// Version contains the client version, derived from the request headers
	Version string
}

func NewClientInfoFromRequest(r *http.Request) *ClientInfo {
	clientName := ctrace.GetClientInfo(r.Header, "graphql-client-name", "apollographql-client-name", "unknown")
	clientVersion := ctrace.GetClientInfo(r.Header, "graphql-client-version", "apollographql-client-version", "missing")
	return &ClientInfo{
		Name:    clientName,
		Version: clientVersion,
	}
}

type RequestContext interface {
	// ResponseWriter is the original response writer received by the router.
	ResponseWriter() http.ResponseWriter

	// Request is the original request received by the router.
	Request() *http.Request

	// Logger is the logger for the request
	Logger() *zap.Logger

	// Operation is the GraphQL operation
	Operation() OperationContext

	// SendError returns the most recent error occurred while trying to make the origin request.
	SendError() error

	// Set is used to store a new key/value pair exclusively for this context.
	Set(string, any)

	// Get returns the value for the given key, ie: (value, true).
	Get(string) (value any, exists bool)

	// GetString returns the value associated with the key as a string.
	GetString(string) string

	// MustGet returns the value for the given key if it exists, otherwise it panics.
	MustGet(string) any

	// GetBool returns the value associated with the key as a boolean.
	GetBool(string) bool

	// GetInt returns the value associated with the key as an integer.
	GetInt(string) int

	// GetInt64 returns the value associated with the key as an integer.
	GetInt64(string) int64

	// GetUint returns the value associated with the key as an unsigned integer.
	GetUint(string) uint

	// GetUint64 returns the value associated with the key as an unsigned integer.
	GetUint64(string) uint64

	// GetFloat64 returns the value associated with the key as a float64.
	GetFloat64(string) float64

	// GetTime returns the value associated with the key as time.
	GetTime(string) time.Time

	// GetDuration returns the value associated with the key as a duration.
	GetDuration(string) time.Duration

	// GetStringSlice returns the value associated with the key as a slice of strings.
	GetStringSlice(string) []string

	// GetStringMap returns the value associated with the key as a map of interfaces.
	GetStringMap(string) map[string]any

	// GetStringMapString returns the value associated with the key as a map of strings.
	GetStringMapString(string) map[string]string

	// GetStringMapStringSlice returns the value associated with the key as a map to a slice of strings.
	GetStringMapStringSlice(string) map[string][]string

	// ActiveSubgraph returns the current subgraph to which the request is made to
	ActiveSubgraph(subgraphRequest *http.Request) *Subgraph

	// Authentication returns the authentication information for the request, if any
	Authentication() authentication.Authentication
}

// requestContext is the default implementation of RequestContext
// It is accessible to custom modules in the request lifecycle
type requestContext struct {
	logger *zap.Logger
	// This mutex protects keys map.
	mu sync.RWMutex
	// keys is a key/value pair exclusively for the context of each request.
	keys map[string]any
	// responseWriter is the original response writer received by the router.
	responseWriter http.ResponseWriter
	// hasError indicates if the request / response has an error
	hasError bool
	// request is the original request received by the router.
	request *http.Request
	// operation is the GraphQL operation context
	operation *operationContext
	// sendError returns the most recent error occurred while trying to make the origin request.
	sendError error
	// subgraphs is the list of subgraphs taken from the router config
	subgraphs []Subgraph
}

func (c *requestContext) SendError() error {
	return c.sendError
}

func (c *requestContext) Operation() OperationContext {
	return c.operation
}

func (c *requestContext) Request() *http.Request {
	return c.request
}

func withRequestContext(ctx context.Context, operation *requestContext) context.Context {
	return context.WithValue(ctx, requestContextKey, operation)
}

func getRequestContext(ctx context.Context) *requestContext {
	if ctx == nil {
		return nil
	}
	op := ctx.Value(requestContextKey)
	if op == nil {
		return nil
	}
	return op.(*requestContext)
}

func (c *requestContext) ResponseWriter() http.ResponseWriter {
	return c.responseWriter
}

func (c *requestContext) Logger() *zap.Logger {
	return c.logger
}

// Set is used to store a new key/value pair exclusively for this context.
// It also lazy initializes c.keys if it was not used previously.
func (c *requestContext) Set(key string, value any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.keys == nil {
		c.keys = make(map[string]any)
	}

	c.keys[key] = value
}

// Get returns the value for the given key, ie: (value, true).
// If the value does not exist it returns (nil, false)
func (c *requestContext) Get(key string) (value any, exists bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	value, exists = c.keys[key]
	return
}

// MustGet returns the value for the given key if it exists, otherwise it panics.
func (c *requestContext) MustGet(key string) any {
	if value, exists := c.Get(key); exists {
		return value
	}
	panic("Key \"" + key + "\" does not exist")
}

// GetString returns the value associated with the key as a string.
func (c *requestContext) GetString(key string) (s string) {
	if val, ok := c.Get(key); ok && val != nil {
		s, _ = val.(string)
	}
	return
}

// GetBool returns the value associated with the key as a boolean.
func (c *requestContext) GetBool(key string) (b bool) {
	if val, ok := c.Get(key); ok && val != nil {
		b, _ = val.(bool)
	}
	return
}

// GetInt returns the value associated with the key as an integer.
func (c *requestContext) GetInt(key string) (i int) {
	if val, ok := c.Get(key); ok && val != nil {
		i, _ = val.(int)
	}
	return
}

// GetInt64 returns the value associated with the key as an integer.
func (c *requestContext) GetInt64(key string) (i64 int64) {
	if val, ok := c.Get(key); ok && val != nil {
		i64, _ = val.(int64)
	}
	return
}

// GetUint returns the value associated with the key as an unsigned integer.
func (c *requestContext) GetUint(key string) (ui uint) {
	if val, ok := c.Get(key); ok && val != nil {
		ui, _ = val.(uint)
	}
	return
}

// GetUint64 returns the value associated with the key as an unsigned integer.
func (c *requestContext) GetUint64(key string) (ui64 uint64) {
	if val, ok := c.Get(key); ok && val != nil {
		ui64, _ = val.(uint64)
	}
	return
}

// GetFloat64 returns the value associated with the key as a float64.
func (c *requestContext) GetFloat64(key string) (f64 float64) {
	if val, ok := c.Get(key); ok && val != nil {
		f64, _ = val.(float64)
	}
	return
}

// GetTime returns the value associated with the key as time.
func (c *requestContext) GetTime(key string) (t time.Time) {
	if val, ok := c.Get(key); ok && val != nil {
		t, _ = val.(time.Time)
	}
	return
}

// GetDuration returns the value associated with the key as a duration.
func (c *requestContext) GetDuration(key string) (d time.Duration) {
	if val, ok := c.Get(key); ok && val != nil {
		d, _ = val.(time.Duration)
	}
	return
}

// GetStringSlice returns the value associated with the key as a slice of strings.
func (c *requestContext) GetStringSlice(key string) (ss []string) {
	if val, ok := c.Get(key); ok && val != nil {
		ss, _ = val.([]string)
	}
	return
}

// GetStringMap returns the value associated with the key as a map of interfaces.
func (c *requestContext) GetStringMap(key string) (sm map[string]any) {
	if val, ok := c.Get(key); ok && val != nil {
		sm, _ = val.(map[string]any)
	}
	return
}

// GetStringMapString returns the value associated with the key as a map of strings.
func (c *requestContext) GetStringMapString(key string) (sms map[string]string) {
	if val, ok := c.Get(key); ok && val != nil {
		sms, _ = val.(map[string]string)
	}
	return
}

// GetStringMapStringSlice returns the value associated with the key as a map to a slice of strings.
func (c *requestContext) GetStringMapStringSlice(key string) (smss map[string][]string) {
	if val, ok := c.Get(key); ok && val != nil {
		smss, _ = val.(map[string][]string)
	}
	return
}

func (c *requestContext) ActiveSubgraph(subgraphRequest *http.Request) *Subgraph {
	for _, sg := range c.subgraphs {
		if sg.Url != nil && sg.Url.String() == subgraphRequest.URL.String() {
			return &sg
		}
	}
	return nil
}

func (c *requestContext) Authentication() authentication.Authentication {
	return authentication.FromContext(c.request.Context())
}

const operationContextKey = key("graphql")

type OperationContext interface {
	// Name is the name of the operation
	Name() string
	// Type is the type of the operation (query, mutation, subscription)
	Type() string
	// Hash is the hash of the operation
	Hash() uint64
	// Content is the content of the operation
	Content() string
	// ClientInfo returns information about the client that initiated this operation
	ClientInfo() ClientInfo
}

var _ OperationContext = (*operationContext)(nil)

// operationContext contains information about the current GraphQL operation
type operationContext struct {
	// Name is the name of the operation
	name string
	// opType is the type of the operation (query, mutation, subscription)
	opType string
	// Hash is the hash of the operation
	hash uint64
	// Content is the content of the operation
	content    string
	variables  []byte
	clientInfo *ClientInfo
	// preparedPlan is the prepared plan of the operation
	preparedPlan *planWithMetaData
	traceOptions resolve.RequestTraceOptions
}

func (o *operationContext) Variables() []byte {
	return o.variables
}

func (o *operationContext) Name() string {
	return o.name
}

func (o *operationContext) Type() string {
	return o.opType
}

func (o *operationContext) Hash() uint64 {
	return o.hash
}

func (o *operationContext) Content() string {
	return o.content
}

func (o *operationContext) ClientInfo() ClientInfo {
	return *o.clientInfo
}

func withOperationContext(ctx context.Context, operation *operationContext) context.Context {
	return context.WithValue(ctx, operationContextKey, operation)
}

// getOperationContext returns the request context.
// It provides information about the current operation like the name, type, hash and content.
// If no operation context is found, nil is returned.
func getOperationContext(ctx context.Context) *operationContext {
	if ctx == nil {
		return nil
	}
	op := ctx.Value(operationContextKey)
	if op == nil {
		return nil
	}
	return op.(*operationContext)
}

// isMutationRequest returns true if the current request is a mutation request
func isMutationRequest(ctx context.Context) bool {
	op := getRequestContext(ctx)
	if op == nil {
		return false
	}
	return op.Operation().Type() == "mutation"
}

func withSubgraphs(ctx context.Context, subgraphs []Subgraph) context.Context {
	return context.WithValue(ctx, subgraphsContextKey, subgraphs)
}

func subgraphsFromContext(ctx context.Context) []Subgraph {
	subgraphs, _ := ctx.Value(subgraphsContextKey).([]Subgraph)
	return subgraphs
}

func buildRequestContext(w http.ResponseWriter, r *http.Request, opContext *operationContext, requestLogger *zap.Logger) *requestContext {
	subgraphs := subgraphsFromContext(r.Context())
	requestContext := &requestContext{
		logger:         requestLogger,
		keys:           map[string]any{},
		responseWriter: w,
		request:        r,
		operation:      opContext,
		subgraphs:      subgraphs,
	}
	return requestContext
}

const (
	// RequestTraceHeader is the header used to enable request tracing
	RequestTraceHeader = "X-WG-Trace"
	// RequestTraceQueryParameter is the query parameter used to enable request tracing
	RequestTraceQueryParameter                      = "wg_trace"
	requestTraceOptionExcludePlannerStats           = "exclude_planner_stats"
	requestTraceOptionExcludeRawInputData           = "exclude_raw_input_data"
	requestTraceOptionExcludeInput                  = "exclude_input"
	requestTraceOptionExcludeOutput                 = "exclude_output"
	requestTraceOptionExcludeLoadStats              = "exclude_load_stats"
	requestTraceOptionEnablePredictableDebugTimings = "enable_predictable_debug_timings"
)

func ParseRequestTraceOptions(r *http.Request) (options resolve.RequestTraceOptions) {
	var (
		values []string
	)
	if r.Header.Get(RequestTraceHeader) != "" {
		options.Enable = true
		values = r.Header.Values(RequestTraceHeader)
	}
	if r.URL.Query().Get(RequestTraceQueryParameter) != "" {
		options.Enable = true
		values = r.URL.Query()[RequestTraceQueryParameter]
	}
	if len(values) == 0 {
		options.ExcludePlannerStats = true
		options.ExcludeRawInputData = true
		options.ExcludeInput = true
		options.ExcludeOutput = true
		options.ExcludeLoadStats = true
		options.EnablePredictableDebugTimings = true
		return
	}
	options.IncludeTraceOutputInResponseExtensions = true
	for i := range values {
		switch values[i] {
		case requestTraceOptionExcludePlannerStats:
			options.ExcludePlannerStats = true
		case requestTraceOptionExcludeRawInputData:
			options.ExcludeRawInputData = true
		case requestTraceOptionExcludeInput:
			options.ExcludeInput = true
		case requestTraceOptionExcludeOutput:
			options.ExcludeOutput = true
		case requestTraceOptionExcludeLoadStats:
			options.ExcludeLoadStats = true
		case requestTraceOptionEnablePredictableDebugTimings:
			options.EnablePredictableDebugTimings = true
		}
	}
	return
}
