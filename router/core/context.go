package core

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	rcontext "github.com/wundergraph/cosmo/router/internal/context"

	"go.opentelemetry.io/otel/attribute"
	"go.uber.org/zap"

	"github.com/wundergraph/astjson"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"

	graphqlmetrics "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/graphqlmetrics/v1"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/graphqlschemausage"
	ctrace "github.com/wundergraph/cosmo/router/pkg/trace"
)

var _ RequestContext = (*requestContext)(nil)

type Subgraph struct {
	Id        string
	Name      string
	Url       *url.URL
	UrlString string
}

type ClientInfo struct {
	// Name contains the client name, derived from the request headers
	Name string
	// Version contains the client version, derived from the request headers
	Version string
	// WGRequestToken contains the token to authenticate the request from the platform
	WGRequestToken string
}

func NewClientInfoFromRequest(r *http.Request, clientHeader config.ClientHeader) *ClientInfo {
	requestToken := r.Header.Get("X-WG-Token")
	clientName, clientVersion := ctrace.GetClientDetails(r, clientHeader)
	return &ClientInfo{
		Name:           clientName,
		Version:        clientVersion,
		WGRequestToken: requestToken,
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

	// SubgraphByID return the subgraph by its ID
	SubgraphByID(subgraphID string) *Subgraph

	// Authentication returns the authentication information for the request, if any
	Authentication() authentication.Authentication

	// SetAuthenticationScopes sets the scopes for the request on Authentication
	// If Authentication is not set, it will be initialized with the scopes
	SetAuthenticationScopes(scopes []string)
	// SetCustomFieldValueRenderer overrides the default field value rendering behavior
	// This can be used, e.g. to obfuscate sensitive data in the response
	SetCustomFieldValueRenderer(renderer resolve.FieldValueRenderer)
}

var metricAttrsPool = sync.Pool{
	New: func() any {
		v := make([]attribute.KeyValue, 0, 20)
		return &v
	},
}

type requestTelemetryAttributes struct {
	// traceAttrs are the base attributes for traces only
	traceAttrs []attribute.KeyValue
	// metricAttrs are the attributes for metrics only
	metricAttrs []attribute.KeyValue
	// metricSetAttrs is map to quickly check if a metric attribute is set and to what key it is remapped
	metricSetAttrs map[string]string
	// metricSliceAttrs are the attributes for metrics that are string slices and needs to be exploded for prometheus
	metricSliceAttrs []attribute.KeyValue
	// mapper is an attribute mapper for context attributes.
	// It is used to identify attributes that should not be included by default  but can be included if they are
	// configured in the custom attributes list. The mapper will potentially filter out attributes or include them.
	// It will also remap the key if configured.
	mapper *attributeMapper
	// traceAttributeExpressions is a map of expressions that can be used to resolve dynamic attributes in traces
	telemetryAttributeExpressions *attributeExpressions
	// metricAttributeExpressions is a map of expressions that can be used to resolve dynamic attributes in metrics
	metricAttributeExpressions *attributeExpressions
	// traceAttributeExpressions is a map of expressions that can be used to resolve dynamic attributes in traces
	tracingAttributeExpressions *attributeExpressions
	// metricsEnabled indicates if metrics are enabled. If false, no metrics attributes will be added
	metricsEnabled bool
	// traceEnabled indicates if traces are enabled, if false, no trace attributes will be added
	traceEnabled bool
}

func (r *requestTelemetryAttributes) AcquireAttributes() *[]attribute.KeyValue {
	if !r.metricsEnabled && !r.traceEnabled {
		return &[]attribute.KeyValue{}
	}
	return metricAttrsPool.Get().(*[]attribute.KeyValue)
}

func (r *requestTelemetryAttributes) ReleaseAttributes(attrs *[]attribute.KeyValue) {
	if !r.metricsEnabled && !r.traceEnabled {
		return
	}

	// reset slice
	*attrs = (*attrs)[:0]

	// If the slice is too big, we don't pool it to avoid holding on to too much memory
	if cap(*attrs) > 128 {
		return
	}

	metricAttrsPool.Put(attrs)
}

func (r *requestTelemetryAttributes) AddCustomMetricStringSliceAttr(key string, values []string) {
	if !r.metricsEnabled {
		return
	}
	if remapKey, ok := r.metricSetAttrs[key]; ok && len(values) > 0 {
		v := attribute.StringSlice(remapKey, values)
		r.metricSliceAttrs = append(r.metricSliceAttrs, v)
	}
}

func (r *requestTelemetryAttributes) addCustomMetricStringAttr(key string, value string) {
	if !r.metricsEnabled {
		return
	}
	if remapKey, ok := r.metricSetAttrs[key]; ok && value != "" {
		v := attribute.String(remapKey, value)
		r.metricAttrs = append(r.metricAttrs, v)
	}
}

func (r *requestTelemetryAttributes) addCommonAttribute(vals ...attribute.KeyValue) {
	r.addMetricAttribute(vals...)
	r.addCommonTraceAttribute(vals...)
}

func (r *requestTelemetryAttributes) addCommonTraceAttribute(vals ...attribute.KeyValue) {
	if !r.traceEnabled {
		return
	}
	r.traceAttrs = append(r.traceAttrs, vals...)
}

func (r *requestTelemetryAttributes) addMetricAttribute(vals ...attribute.KeyValue) {
	if !r.metricsEnabled {
		return
	}

	r.metricAttrs = append(r.metricAttrs, r.mapper.mapAttributes(vals)...)
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
	// error indicates if the request / response has an error. Due to the nature of GraphQL
	// Error can be set even if the response status code is 200.
	error error
	// request is the original request received by the router.
	request *http.Request
	// operation is the GraphQL operation context
	operation *operationContext
	// subgraphResolver can be used to resolve Subgraph by ID or by request
	subgraphResolver *SubgraphResolver
	// dataSourceNames the list of datasource involved in resolving the operation
	dataSourceNames []string
	// graphQLErrorServices are the services that produced the GraphQL errors
	graphQLErrorServices []string
	// graphQLErrorCodes are the error codes of the GraphQL errors
	graphQLErrorCodes []string
	// telemetry are the base telemetry information of the request
	telemetry *requestTelemetryAttributes
	// expressionContext is the context that will be provided to a compiled expression in order to retrieve data via dynamic expressions
	expressionContext expr.Context
	// customFieldValueRenderer is used to override the default field value rendering behavior
	customFieldValueRenderer resolve.FieldValueRenderer
}

func (c *requestContext) SetCustomFieldValueRenderer(renderer resolve.FieldValueRenderer) {
	c.customFieldValueRenderer = renderer
}

func (c *requestContext) SetError(err error) {
	c.error = err
	c.expressionContext.Request.Error = err
}

func (c *requestContext) Operation() OperationContext {
	return c.operation
}

func (c *requestContext) Request() *http.Request {
	return c.request
}

func withRequestContext(ctx context.Context, operation *requestContext) context.Context {
	return context.WithValue(ctx, rcontext.RequestContextKey, operation)
}

func getRequestContext(ctx context.Context) *requestContext {
	if ctx == nil {
		return nil
	}
	op := ctx.Value(rcontext.RequestContextKey)
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
	if subgraphRequest == nil || subgraphRequest.URL == nil {
		return nil
	}
	return c.subgraphResolver.BySubgraphURL(subgraphRequest.URL.String())
}

func (c *requestContext) SubgraphByID(subgraphID string) *Subgraph {
	return c.subgraphResolver.ByID(subgraphID)
}

func (c *requestContext) Authentication() authentication.Authentication {
	return authentication.FromContext(c.request.Context())
}

func (c *requestContext) SetAuthenticationScopes(scopes []string) {
	auth := authentication.FromContext(c.request.Context())
	if auth == nil {
		auth = authentication.NewEmptyAuthentication()
		c.request = c.request.WithContext(authentication.NewContext(c.request.Context(), auth))
	}
	auth.SetScopes(scopes)
}

type OperationContext interface {
	// Name is the name of the operation
	Name() string
	// Type is the type of the operation (query, mutation, subscription)
	Type() string
	// Hash is the hash of the operation
	Hash() uint64
	// Content is the content of the operation
	Content() string
	// Variables is the variables of the operation
	Variables() *astjson.Value
	// ClientInfo returns information about the client that initiated this operation
	ClientInfo() ClientInfo
	// QueryPlanStats returns some statistics about the query plan for the operation
	// if called too early in request chain, it may be inaccurate for modules, using
	// in Middleware is recommended
	QueryPlanStats() (QueryPlanStats, error)
}

var _ OperationContext = (*operationContext)(nil)

type OperationType = string

const (
	OperationTypeQuery        OperationType = "query"
	OperationTypeMutation     OperationType = "mutation"
	OperationTypeSubscription OperationType = "subscription"
)

// operationContext contains information about the current GraphQL operation
type operationContext struct {
	// Name is the name of the operation
	name string
	// opType is the type of the operation (query, mutation, subscription)
	opType OperationType
	// hash is the hash of the operation with the normalized content and variables. Used for analytics.
	hash uint64
	// internalHash is the hash of the operation with the fully normalized content. Used for engine / executor caching.
	// we can't use the hash for this due to engine limitations in handling variables with the normalized representation
	internalHash uint64
	// remapVariables is a map of variables that have been remapped to the new names
	remapVariables map[string]string
	// RawContent is the raw content of the operation
	rawContent string
	// Content is the normalized content of the operation
	content    string
	variables  *astjson.Value
	files      []*httpclient.FileUpload
	clientInfo *ClientInfo
	// preparedPlan is the prepared plan of the operation
	preparedPlan     *planWithMetaData
	traceOptions     resolve.TraceOptions
	executionOptions resolve.ExecutionOptions
	planCacheHit     bool
	initialPayload   []byte
	extensions       []byte
	persistedID      string
	// Hash on the original operation
	sha256Hash string
	protocol   OperationProtocol

	persistedOperationCacheHit bool
	normalizationCacheHit      bool

	typeFieldUsageInfo graphqlschemausage.TypeFieldMetrics
	argumentUsageInfo  []*graphqlmetrics.ArgumentUsageInfo
	inputUsageInfo     []*graphqlmetrics.InputUsageInfo

	parsingTime       time.Duration
	validationTime    time.Duration
	planningTime      time.Duration
	normalizationTime time.Duration
}

func (o *operationContext) Variables() *astjson.Value {
	return o.variables
}

func (o *operationContext) Files() []*httpclient.FileUpload {
	return o.files
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

func (o *operationContext) HashString() string {
	return strconv.FormatUint(o.hash, 10)
}

func (o *operationContext) Content() string {
	return o.content
}

func (o *operationContext) PersistedID() string {
	return o.persistedID
}

func (o *operationContext) Protocol() OperationProtocol {
	return o.protocol
}

func (o *operationContext) ClientInfo() ClientInfo {
	return *o.clientInfo
}

type QueryPlanStats struct {
	TotalSubgraphFetches int
	SubgraphFetches      map[string]int
}

func (p *QueryPlanStats) analyzePlanNode(plan *resolve.FetchTreeQueryPlanNode) {
	switch plan.Kind {
	case resolve.FetchTreeNodeKindSingle:
		p.analyzeSingleFetch(plan)
	case resolve.FetchTreeNodeKindSequence, resolve.FetchTreeNodeKindParallel:
		for _, child := range plan.Children {
			p.analyzePlanNode(child)
		}
	}
}

func (p *QueryPlanStats) analyzeSingleFetch(plan *resolve.FetchTreeQueryPlanNode) {
	key := plan.Fetch.SubgraphName

	p.TotalSubgraphFetches++

	if entry, ok := p.SubgraphFetches[key]; ok {
		p.SubgraphFetches[key] = entry + 1
	} else {
		p.SubgraphFetches[key] = 1
	}
}

func (o *operationContext) QueryPlanStats() (QueryPlanStats, error) {
	if o == nil || o.preparedPlan == nil || o.preparedPlan.preparedPlan == nil {
		return QueryPlanStats{}, errors.New("operation context is nil")
	}

	if o.preparedPlan == nil || o.preparedPlan.preparedPlan == nil {
		return QueryPlanStats{}, errors.New("prepared plan is nil")
	}

	qps := QueryPlanStats{
		TotalSubgraphFetches: 0,
		SubgraphFetches:      make(map[string]int),
	}

	if p, ok := o.preparedPlan.preparedPlan.(*plan.SynchronousResponsePlan); ok {
		if p.Response == nil {
			return QueryPlanStats{}, errors.New("synchronous response plan is nil")
		}

		if p.Response.Fetches == nil {
			return QueryPlanStats{}, errors.New("synchronous response plan has no fetches")
		}

		qps.analyzePlanNode(p.Response.Fetches.QueryPlan())
	} else {
		return QueryPlanStats{}, errors.New("query plan stats currently only support synchronous response plans")
	}

	return qps, nil
}

// isMutationRequest returns true if the current request is a mutation request
func isMutationRequest(ctx context.Context) bool {
	op := getRequestContext(ctx)
	if op == nil {
		return false
	}
	return op.Operation().Type() == "mutation"
}

type SubgraphResolver struct {
	subgraphsByURL map[string]*Subgraph
	subgraphsByID  map[string]*Subgraph
}

func NewSubgraphResolver(subgraphs []Subgraph) *SubgraphResolver {
	resolver := &SubgraphResolver{
		subgraphsByURL: make(map[string]*Subgraph, len(subgraphs)),
		subgraphsByID:  make(map[string]*Subgraph, len(subgraphs)),
	}
	for i := range subgraphs {
		sg := Subgraph{
			Id:        subgraphs[i].Id,
			Name:      subgraphs[i].Name,
			Url:       subgraphs[i].Url,
			UrlString: subgraphs[i].UrlString,
		}
		// TODO: In case there are multiple subgraphs with the same URL, the previous
		// one will be overwritten. To investigate if this causes an issue.
		if sg.UrlString != "" {
			resolver.subgraphsByURL[sg.UrlString] = &sg
		}
		if sg.Id != "" {
			resolver.subgraphsByID[sg.Id] = &sg
		}
	}
	return resolver
}

func (s *SubgraphResolver) ByID(subgraphID string) *Subgraph {
	return s.subgraphsByID[subgraphID]
}

func (s *SubgraphResolver) BySubgraphURL(u string) *Subgraph {
	if len(u) >= 4 && u[:4] == "http" {
		return s.subgraphsByURL[u]
	}
	if strings.HasPrefix(u, "wss") {
		u = "https" + u[3:]
	} else if strings.HasPrefix(u, "ws") {
		u = "http" + u[2:]
	}
	return s.subgraphsByURL[u]
}

func withSubgraphResolver(ctx context.Context, resolver *SubgraphResolver) context.Context {
	return context.WithValue(ctx, rcontext.SubgraphResolverContextKey, resolver)
}

func subgraphResolverFromContext(ctx context.Context) *SubgraphResolver {
	resolver, _ := ctx.Value(rcontext.SubgraphResolverContextKey).(*SubgraphResolver)
	return resolver
}

type requestContextOptions struct {
	operationContext              *operationContext
	requestLogger                 *zap.Logger
	metricSetAttributes           map[string]string
	metricsEnabled                bool
	traceEnabled                  bool
	mapper                        *attributeMapper
	metricAttributeExpressions    *attributeExpressions
	telemetryAttributeExpressions *attributeExpressions
	tracingAttributeExpressions   *attributeExpressions
	w                             http.ResponseWriter
	r                             *http.Request
}

func buildRequestContext(opts requestContextOptions) *requestContext {

	rootCtx := expr.Context{
		Request: expr.LoadRequest(opts.r),
	}

	return &requestContext{
		logger:         opts.requestLogger,
		keys:           map[string]any{},
		responseWriter: opts.w,
		request:        opts.r,
		operation:      opts.operationContext,
		telemetry: &requestTelemetryAttributes{
			metricSetAttrs:                opts.metricSetAttributes,
			metricsEnabled:                opts.metricsEnabled,
			traceEnabled:                  opts.traceEnabled,
			mapper:                        opts.mapper,
			telemetryAttributeExpressions: opts.telemetryAttributeExpressions,
			metricAttributeExpressions:    opts.metricAttributeExpressions,
			tracingAttributeExpressions:   opts.tracingAttributeExpressions,
		},
		expressionContext: rootCtx,
		subgraphResolver:  subgraphResolverFromContext(opts.r.Context()),
	}
}
