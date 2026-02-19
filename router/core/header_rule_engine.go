package core

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/cespare/xxhash/v2"
 	"github.com/expr-lang/expr/vm"
	cachedirective "github.com/pquerna/cachecontrol/cacheobject"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/internal/headers"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

var (
	_ EnginePostOriginHandler = (*HeaderPropagation)(nil)
	cacheControlKey       = "Cache-Control"
	expiresKey            = "Expires"
	noCache               = "no-cache"
	caseInsensitiveRegexp = "(?i)"
)

type responseHeaderPropagationKey struct{}

type responseHeaderPropagation struct {
	header               http.Header
	m                    *sync.Mutex
	previousCacheControl *cachedirective.Object
	setCacheControl      bool
}

func WithResponseHeaderPropagation(ctx *resolve.Context) *resolve.Context {
	return ctx.WithContext(context.WithValue(ctx.Context(), responseHeaderPropagationKey{}, &responseHeaderPropagation{
		header: make(http.Header),
		m:      &sync.Mutex{},
	}))
}

func getResponseHeaderPropagation(ctx context.Context) *responseHeaderPropagation {
	v := ctx.Value(responseHeaderPropagationKey{})
	if v == nil {
		return nil
	}
	return v.(*responseHeaderPropagation)
}

func HeaderPropagationWriter(w http.ResponseWriter, resolveCtx *resolve.Context, setContentLength bool) io.Writer {
	propagation := getResponseHeaderPropagation(resolveCtx.Context())
	return &headerPropagationWriter{
		writer:            w,
		headerPropagation: propagation,
		propagateHeaders:  propagation != nil,
		setContentLength:  setContentLength,
		resolveCtx:        resolveCtx,
	}
}

type headerPropagationWriter struct {
	setContentLength          bool
	propagateHeaders          bool
	writer                    http.ResponseWriter
	headerPropagation         *responseHeaderPropagation
	resolveCtx                *resolve.Context
	didSetSubgraphErrors      bool
	routerHeaderPropagation   *HeaderPropagation
	reqCtx                    *requestContext
	didApplyRouterRespHeaders bool
}

func (h *headerPropagationWriter) Write(p []byte) (n int, err error) {
	if h.setContentLength {
		// setContentLength assumes this Write is called exactly once with the entire body
		h.writer.Header().Set("Content-Length", strconv.Itoa(len(p)))
		h.setContentLength = false
	}
	if h.propagateHeaders {
		wh := h.writer.Header()
		for k, v := range h.headerPropagation.header {
			for _, el := range v {
				wh.Add(k, el)
			}
		}
		h.propagateHeaders = false
	}
	if errs := h.resolveCtx.SubgraphErrors(); errs != nil && !h.didSetSubgraphErrors {
		h.writer.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
		h.didSetSubgraphErrors = true
		trackFinalResponseError(h.resolveCtx.Context(), errs)
	}
	if h.routerHeaderPropagation != nil && !h.didApplyRouterRespHeaders {
		h.didApplyRouterRespHeaders = true
		if err := h.routerHeaderPropagation.ApplyRouterResponseHeaderRules(h.writer, h.reqCtx); err != nil {
			if h.reqCtx != nil {
				h.reqCtx.logger.Error("Failed to apply router response header rules", zap.Error(err))
			}
		}
	}
	return h.writer.Write(p)
}

// HeaderPropagation is a pre-origin handler that can be used to propagate and
// manipulate headers from the client request to the upstream
type HeaderPropagation struct {
	regex                       map[string]*regexp.Regexp
	rules                       *config.HeaderRules
	compiledRules               map[string]*vm.Program
	compiledRouterResponseRules map[string]*vm.Program
	hasRequestRules             bool
	hasResponseRules            bool
	// Precomputed request rule presence for fast-path checks
	hasAllRequestRules      bool
	subgraphHasRequestRules map[string]bool
}

func initHeaderRules(rules *config.HeaderRules) {
	if rules.All == nil {
		rules.All = &config.GlobalHeaderRule{}
	}
	if rules.Subgraphs == nil {
		rules.Subgraphs = make(map[string]*config.GlobalHeaderRule)
	}
}

func NewHeaderPropagation(rules *config.HeaderRules) (*HeaderPropagation, error) {
	if rules == nil {
		return nil, nil
	}

	initHeaderRules(rules)
	hf := HeaderPropagation{
		rules:                       rules,
		regex:                       map[string]*regexp.Regexp{},
		compiledRules:               map[string]*vm.Program{},
		compiledRouterResponseRules: map[string]*vm.Program{},
	}

	rhrs, rhrrs, rrs := hf.getAllRules()
	hf.hasRequestRules = len(rhrs) > 0
	hf.hasResponseRules = len(rhrrs) > 0

	// Pre-compute request rule presence
	hf.hasAllRequestRules = len(hf.rules.All.Request) > 0
	if !hf.hasAllRequestRules {
		// Only build a per-subgraph map if we don't have global rules
		hf.subgraphHasRequestRules = make(map[string]bool, len(hf.rules.Subgraphs))
		for name, sg := range hf.rules.Subgraphs {
			if sg != nil && len(sg.Request) > 0 {
				hf.subgraphHasRequestRules[name] = true
			}
		}
	}

	if err := hf.collectRuleMatchers(rhrs, rhrrs); err != nil {
		return nil, err
	}

	if err := hf.compileExpressionRules(rhrs, rrs); err != nil {
		return nil, err
	}

	return &hf, nil
}

func AddCacheControlPolicyToRules(rules *config.HeaderRules, cacheControl config.CacheControlPolicy) *config.HeaderRules {
	if rules == nil {
		rules = &config.HeaderRules{}
		if !cacheControl.Enabled && cacheControl.Subgraphs == nil {
			return nil
		}
	}

	initHeaderRules(rules)
	if cacheControl.Enabled {
		rules.All.Response = append(rules.All.Response, &config.ResponseHeaderRule{
			Operation: config.HeaderRuleOperationPropagate,
			Algorithm: config.ResponseHeaderRuleAlgorithmMostRestrictiveCacheControl,
			Default:   cacheControl.Value,
		})
	}

	for _, graph := range cacheControl.Subgraphs {
		subgraphRules, ok := rules.Subgraphs[graph.Name]
		if !ok {
			subgraphRules = &config.GlobalHeaderRule{Response: make([]*config.ResponseHeaderRule, 0)}
		}

		subgraphRules.Response = append(subgraphRules.Response, &config.ResponseHeaderRule{
			Operation: config.HeaderRuleOperationPropagate,
			Algorithm: config.ResponseHeaderRuleAlgorithmMostRestrictiveCacheControl,
			Default:   graph.Value,
		})

		rules.Subgraphs[graph.Name] = subgraphRules
	}

	return rules
}

func (hf *HeaderPropagation) getAllRules() ([]*config.RequestHeaderRule, []*config.ResponseHeaderRule, []*config.RouterResponseHeaderRule) {
	rhrs := hf.rules.All.Request
	for _, subgraph := range hf.rules.Subgraphs {
		rhrs = append(rhrs, subgraph.Request...)
	}

	rhrrs := hf.rules.All.Response
	for _, subgraph := range hf.rules.Subgraphs {
		rhrrs = append(rhrrs, subgraph.Response...)
	}

	return rhrs, rhrrs, hf.rules.Router.Response
}

func (hf *HeaderPropagation) processRule(rule config.HeaderRule, index int) error {
	switch rule.GetOperation() {
	case config.HeaderRuleOperationSet:
	case config.HeaderRuleOperationPropagate:
		if rule.GetMatching() != "" {
			regex, err := regexp.Compile(caseInsensitiveRegexp + rule.GetMatching())
			if err != nil {
				return fmt.Errorf("invalid regex '%s' for header rule %d: %w", rule.GetMatching(), index, err)
			}
			hf.regex[rule.GetMatching()] = regex
		}
	default:
		return fmt.Errorf("unhandled operation '%s' for header rule %+v", rule.GetOperation(), rule)
	}
	return nil
}

func (hf *HeaderPropagation) collectRuleMatchers(rhrs []*config.RequestHeaderRule, rhrrs []*config.ResponseHeaderRule) error {
	for i, rule := range rhrs {
		if err := hf.processRule(rule, i); err != nil {
			return err
		}
	}

	for i, rule := range rhrrs {
		if err := hf.processRule(rule, i); err != nil {
			return err
		}
	}

	return nil
}

func (hf *HeaderPropagation) compileExpressionRules(requestRules []*config.RequestHeaderRule, routerResponseRules []*config.RouterResponseHeaderRule) error {
	manager := expr.CreateNewExprManager()
	for _, rule := range requestRules {
		if rule.Expression == "" {
			continue
		}
		if _, ok := hf.compiledRules[rule.Expression]; ok {
			continue
		}
		program, err := manager.CompileExpression(rule.Expression, reflect.String)
		if err != nil {
			return fmt.Errorf("error compiling expression %s for header rule %s: %w", rule.Expression, rule.Name, err)
		}
		hf.compiledRules[rule.Expression] = program
	}
	for _, rule := range routerResponseRules {
		if rule.Expression == "" {
			continue
		}
		if _, ok := hf.compiledRouterResponseRules[rule.Expression]; ok {
			continue
		}
		program, err := manager.CompileExpression(rule.Expression, reflect.String)
		if err != nil {
			return fmt.Errorf("error compiling expression %s for header rule %s: %w", rule.Expression, rule.Name, err)
		}
		hf.compiledRouterResponseRules[rule.Expression] = program
	}
	return nil
}

func (h *HeaderPropagation) HasRequestRules() bool {
	if h == nil {
		return false
	}
	return h.hasRequestRules
}

func (h *HeaderPropagation) HasResponseRules() bool {
	if h == nil {
		return false
	}
	return h.hasResponseRules
}

// BuildRequestHeaderForSubgraph builds headers for an outbound subgraph request
// as if the propagation rules were applied during transport. It returns the
// resulting headers and a stable hash over all header names and values that is
// independent of map iteration order.
func (h *HeaderPropagation) BuildRequestHeaderForSubgraph(subgraphName string, ctx *requestContext) (http.Header, uint64) {
	if h == nil || h.rules == nil || ctx == nil || ctx.Request() == nil {
		return http.Header{}, 0
	}

	// Fast-path: if we know no request rules apply to this subgraph, skip cache and building
	if !h.hasRequestRulesForSubgraph(subgraphName) {
		return nil, 0
	}

	// Build headers in a fresh map without relying on a subgraph request seed.
	outHeader := make(http.Header)

	// Apply global rules
	for _, rule := range h.rules.All.Request {
		h.applyRequestRuleToHeader(ctx, outHeader, rule)
	}

	// Apply subgraph-specific rules
	if subgraphName != "" {
		if subRules, ok := h.rules.Subgraphs[subgraphName]; ok {
			for _, rule := range subRules.Request {
				h.applyRequestRuleToHeader(ctx, outHeader, rule)
			}
		}
	}

	headerHash := hashHeaderStable(outHeader)
	return outHeader, headerHash
}

// hasRequestRulesForSubgraph returns true if there are request header rules
// that would apply to the given subgraph. The result is computed at creation time.
func (h *HeaderPropagation) hasRequestRulesForSubgraph(subgraphName string) bool {
	if h == nil || h.rules == nil {
		return false
	}
	if h.hasAllRequestRules {
		// At least one global rule applies to all subgraphs
		return true
	}
	if subgraphName == "" {
		// No subgraph specified and no global rules
		return false
	}
	return h.subgraphHasRequestRules != nil && h.subgraphHasRequestRules[subgraphName]
}

// hashHeaderStable computes a deterministic 64-bit hash over the provided header map.
// It is independent of map iteration order and minimizes allocations.
func hashHeaderStable(hdr http.Header) uint64 {
	if len(hdr) == 0 {
		return 0
	}

	keys := make([]string, len(hdr))
	i := 0
	for k := range hdr {
		keys[i] = k
		i++
	}
	sort.Strings(keys)

	d := xxhash.New()
	for _, k := range keys {
		_, _ = d.WriteString(k)
		_, _ = d.WriteString("\x00")
		// Iterate values without creating copies to avoid allocations
		vals := hdr[k]
		for i := 0; i < len(vals); i++ {
			_, _ = d.WriteString(vals[i])
			_, _ = d.WriteString("\x00")
		}
		_, _ = d.WriteString("\x01")
	}

	return d.Sum64()
}

// ApplyResponseHeaderRules applies response header rules for a subgraph fetch.
// Called from OnFinished for every fetch (both singleflight leaders and followers).
func (h *HeaderPropagation) ApplyResponseHeaderRules(ctx context.Context, headers http.Header, subgraphName string, statusCode int, request *http.Request) {
	propagation := getResponseHeaderPropagation(ctx)
	if propagation == nil {
		return
	}

	resp := &http.Response{
		StatusCode: statusCode,
		Header:     headers,
	}
	if request != nil {
		resp.Request = request
	} else {
		resp.Request = (&http.Request{}).WithContext(ctx)
	}

	for _, rule := range h.rules.All.Response {
		h.applyResponseRule(propagation, resp, rule)
	}

	if subgraphName != "" {
		if subgraphRules, ok := h.rules.Subgraphs[subgraphName]; ok {
			for _, rule := range subgraphRules.Response {
				h.applyResponseRule(propagation, resp, rule)
			}
		}
	}
}

func (h *HeaderPropagation) OnOriginResponse(resp *http.Response, ctx RequestContext) *http.Response {
	// Response header rules are now applied in the engine loader hooks (OnFinished)
	// via ApplyResponseHeaderRules, not here. This ensures both singleflight leaders
	// and followers are handled uniformly. This method is kept for module compatibility.
	return resp
}

func (h *HeaderPropagation) applyResponseRule(propagation *responseHeaderPropagation, res *http.Response, rule *config.ResponseHeaderRule) {
	if rule.Operation == config.HeaderRuleOperationSet {
		propagation.m.Lock()
		propagation.header.Set(rule.Name, rule.Value)
		if rule.Name == cacheControlKey {
			// Handle the case where the cache control header is set explicitly
			propagation.setCacheControl = true
		}
		propagation.m.Unlock()
		return
	}

	if rule.Operation != config.HeaderRuleOperationPropagate {
		return
	}

	if rule.Named != "" {
		if _, ok := headers.SkippedHeaders[rule.Named]; ok {
			return
		}

		values := res.Header.Values(rule.Named)
		if len(values) > 0 {
			h.applyResponseRuleKeyValue(res, propagation, rule, rule.Named, values)
		} else if rule.Default != "" {
			h.applyResponseRuleKeyValue(res, propagation, rule, rule.Named, []string{rule.Default})
		}

		return
	} else if rule.Matching != "" {
		if regex, ok := h.regex[rule.Matching]; ok {
			for name := range res.Header {
				result := regex.MatchString(name)
				if rule.NegateMatch {
					result = !result
				}
				if result {
					if _, ok := headers.SkippedHeaders[name]; ok {
						continue
					}
					values := res.Header.Values(name)
					h.applyResponseRuleKeyValue(res, propagation, rule, name, values)
				}
			}
		}
	} else if rule.Algorithm == config.ResponseHeaderRuleAlgorithmMostRestrictiveCacheControl {
		// Explicitly apply the CacheControl algorithm on the headers
		h.applyResponseRuleKeyValue(res, propagation, rule, "", []string{""})
	}
}

func (h *HeaderPropagation) applyResponseRuleKeyValue(res *http.Response, propagation *responseHeaderPropagation, rule *config.ResponseHeaderRule, key string, values []string) {
	// Since we'll be setting the header map directly, we need to canonicalize the key
	key = http.CanonicalHeaderKey(key)
	switch rule.Algorithm {
	case config.ResponseHeaderRuleAlgorithmFirstWrite:
		propagation.m.Lock()
		if val := propagation.header.Get(key); val == "" {
			propagation.header[key] = values
		}
		propagation.m.Unlock()
	case config.ResponseHeaderRuleAlgorithmLastWrite:
		propagation.m.Lock()
		propagation.header[key] = values
		propagation.m.Unlock()
	case config.ResponseHeaderRuleAlgorithmAppend:
		propagation.m.Lock()
		existing := propagation.header.Get(key)
		newVal := strings.Join(values, ",")
		if existing != "" {
			propagation.header.Set(key, existing+","+newVal)
		} else {
			propagation.header.Set(key, newVal)
		}
		propagation.m.Unlock()
	case config.ResponseHeaderRuleAlgorithmMostRestrictiveCacheControl:
		h.applyResponseRuleMostRestrictiveCacheControl(res, propagation, rule)
	}
}

func (h *HeaderPropagation) applyRequestRuleToHeader(ctx *requestContext, header http.Header, rule *config.RequestHeaderRule) {
	if rule.Operation == config.HeaderRuleOperationSet {
		if rule.ValueFrom != nil && rule.ValueFrom.ContextField != "" {
			val := getCustomDynamicAttributeValue(rule.ValueFrom, ctx, nil)
			value := fmt.Sprintf("%v", val)
			if value != "" {
				header.Set(rule.Name, value)
			}
			return
		}

		if rule.Expression != "" {
			value, err := h.getRequestRuleExpressionValue(rule, ctx)
			if err != nil {
				ctx.SetError(err)
			} else if value != "" {
				header.Set(rule.Name, value)
			}
			return
		}

		header.Set(rule.Name, rule.Value)
		return
	}

	if rule.Operation != config.HeaderRuleOperationPropagate {
		return
	}

	/**
	 *	Rename the header before propagating and delete the original
	 */

	if rule.Rename != "" && rule.Named != "" {
		// Ignore the rule when the target header is in the ignored list
		if _, ok := headers.SkippedHeaders[rule.Rename]; ok {
			return
		}

		value := ctx.Request().Header.Get(rule.Named)
		if value != "" {
			header.Set(rule.Rename, ctx.Request().Header.Get(rule.Named))
			header.Del(rule.Named)
			return
		} else if rule.Default != "" {
			header.Set(rule.Rename, rule.Default)
			header.Del(rule.Named)
			return
		}

		return
	}

	/**
	 *	Propagate the header as is
	 */

	if rule.Named != "" {
		if _, ok := headers.SkippedHeaders[rule.Named]; ok {
			return
		}

		values := ctx.Request().Header.Values(rule.Named)
		if len(values) > 0 {
			header[http.CanonicalHeaderKey(rule.Named)] = values
		} else if rule.Default != "" {
			header.Set(rule.Named, rule.Default)
		}

		return
	}

	/**
	 * Matching based on regex
	 */

	if regex, ok := h.regex[rule.Matching]; ok {
		// Headers are case-insensitive, but Go canonicalize them
		// Issue: https://github.com/golang/go/issues/37834
		for name := range ctx.Request().Header {
			result := regex.MatchString(name)
			if rule.NegateMatch {
				result = !result
			}

			if result {
				/**
				 *	Rename the header before propagating and delete the original
				 */
				if rule.Rename != "" && rule.Named == "" {

					if _, ok := headers.SkippedHeaders[rule.Rename]; ok {
						continue
					}

					value := ctx.Request().Header.Get(name)
					if value != "" {
						header.Set(rule.Rename, ctx.Request().Header.Get(name))
						header.Del(name)
					} else if rule.Default != "" {
						header.Set(rule.Rename, rule.Default)
						header.Del(name)
					}

					continue
				}

				/**
				 *	Propagate the header as is
				 */
				if _, ok := headers.SkippedHeaders[name]; ok {
					continue
				}
				header.Set(name, ctx.Request().Header.Get(name))
			}
		}
	}
}

func (h *HeaderPropagation) applyResponseRuleMostRestrictiveCacheControl(res *http.Response, propagation *responseHeaderPropagation, rule *config.ResponseHeaderRule) {
	propagation.m.Lock()
	if propagation.setCacheControl {
		propagation.m.Unlock()
		// Handle the case where the cache control header is set explicitly using the set propagation rule
		return
	}
	previousCacheControl := propagation.previousCacheControl
	propagation.m.Unlock()

	ctx := res.Request.Context()
	tracer := rtrace.TracerFromContext(ctx)
	commonAttributes := []attribute.KeyValue{
		otel.WgOperationProtocol.String(OperationProtocolHTTP.String()),
	}

	_, span := tracer.Start(ctx, "HeaderPropagation - RestrictiveCacheControl",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(commonAttributes...),
	)
	defer span.End()

	// Set no-cache for all mutations, to ensure that requests to mutate data always work as expected (without returning cached data)
	if resolve.GetOperationTypeFromContext(ctx) == ast.OperationTypeMutation {
		propagation.m.Lock()
		if propagation.setCacheControl {
			propagation.m.Unlock()
			return
		}
		propagation.header.Set(cacheControlKey, noCache)
		propagation.m.Unlock()
		return
	}

	reqCacheHeader := res.Request.Header.Get(cacheControlKey)
	resCacheHeader := res.Header.Get(cacheControlKey)
	expiresHeader, _ := http.ParseTime(res.Header.Get(expiresKey))
	dateHeader, _ := http.ParseTime(res.Header.Get("Date"))
	lastModifiedHeader, _ := http.ParseTime(res.Header.Get("Last-Modified"))

	if previousCacheControl == nil && reqCacheHeader == "" && resCacheHeader == "" && expiresHeader.IsZero() && rule.Default == "" {
		// There is no default/previous value to set, and since no cache control headers have been set, exit early
		return
	}

	reqDir, _ := cachedirective.ParseRequestCacheControl(reqCacheHeader)
	resDir, _ := cachedirective.ParseResponseCacheControl(resCacheHeader)
	obj := &cachedirective.Object{
		RespDirectives:         resDir,
		RespHeaders:            res.Header,
		RespStatusCode:         res.StatusCode,
		RespExpiresHeader:      expiresHeader,
		RespDateHeader:         dateHeader,
		RespLastModifiedHeader: lastModifiedHeader,
		ReqDirectives:          reqDir,
		ReqHeaders:             res.Request.Header,
		NowUTC:                 time.Now().UTC(),
	}
	rv := cachedirective.ObjectResults{}
	cachedirective.CachableObject(obj, &rv)
	cachedirective.ExpirationObject(obj, &rv)

	span.SetAttributes(
		otel.WgResponseCacheControlReasons.String(fmt.Sprint(rv.OutReasons)),
		otel.WgResponseCacheControlWarnings.String(fmt.Sprint(rv.OutWarnings)),
		otel.WgResponseCacheControlExpiration.String(rv.OutExpirationTime.String()),
	)

	var defaultPolicy *cachedirective.Object
	if rule.Default != "" {
		defaultResponseCache, _ := cachedirective.ParseResponseCacheControl(rule.Default)
		defaultPolicy = &cachedirective.Object{RespDirectives: defaultResponseCache}
	}

	propagation.m.Lock()
	defer propagation.m.Unlock()
	if propagation.setCacheControl {
		// We compute restrictivePolicy outside the lock. If a concurrent
		// response applied an explicit `set` Cache-Control rule in the meantime,
		// that explicit value must win; drop this computed result.
		return
	}
	// Merge with the current shared state under lock to avoid lost updates when
	// multiple subgraph responses compute policies concurrently.
	policies := []*cachedirective.Object{obj}
	if defaultPolicy != nil {
		policies = append(policies, defaultPolicy)
	}
	if propagation.previousCacheControl != nil {
		policies = append(policies, propagation.previousCacheControl)
	}

	restrictivePolicy, cacheControlHeader := createMostRestrictivePolicy(policies)
	propagation.previousCacheControl = restrictivePolicy
	if cacheControlHeader != "" {
		propagation.header.Set(cacheControlKey, cacheControlHeader)
	}

	// Update the Expires header if applicable
	if !expiresHeader.IsZero() && !restrictivePolicy.RespExpiresHeader.IsZero() {
		propagation.header.Set(expiresKey, restrictivePolicy.RespExpiresHeader.Format(http.TimeFormat))
	}
}

func (h *HeaderPropagation) getRequestRuleExpressionValue(rule *config.RequestHeaderRule, reqCtx *requestContext) (value string, err error) {
	if reqCtx == nil {
		return "", fmt.Errorf("context cannot be nil")
	}
	program, ok := h.compiledRules[rule.Expression]
	if !ok {
		return "", fmt.Errorf("expression %s not found in compiled rules for header rule %s", rule.Expression, rule.Name)
	}
	value, err = expr.ResolveStringExpression(program, reqCtx.expressionContext)
	if err != nil {
		return "", fmt.Errorf("unable to resolve expression %q for header rule %s: %s", rule.Expression, rule.Name, err.Error())
	}
	return
}

func (h *HeaderPropagation) getRouterResponseRuleExpressionValue(rule *config.RouterResponseHeaderRule, reqCtx *requestContext) (value string, err error) {
	if reqCtx == nil {
		return "", fmt.Errorf("context cannot be nil")
	}
	program, ok := h.compiledRouterResponseRules[rule.Expression]
	if !ok {
		return "", fmt.Errorf("expression %s not found in compiled rules for header rule %s", rule.Expression, rule.Name)
	}
	value, err = expr.ResolveStringExpression(program, reqCtx.expressionContext)
	if err != nil {
		return "", fmt.Errorf("unable to resolve expression %q for header rule %s: %w", rule.Expression, rule.Name, err)
	}
	return
}

// ApplyRouterResponseHeaderRules applies router response header rules to the response writer
func (h *HeaderPropagation) ApplyRouterResponseHeaderRules(w http.ResponseWriter, reqCtx *requestContext) error {
	for _, rule := range h.rules.Router.Response {
		if rule.Expression == "" {
			continue
		}
		value, err := h.getRouterResponseRuleExpressionValue(rule, reqCtx)
		if err != nil {
			return fmt.Errorf("failed to evaluate router response header expression for %s: %w", rule.Name, err)
		}
		if value != "" {
			w.Header().Set(rule.Name, value)
		}
	}

	return nil
}

func createMostRestrictivePolicy(policies []*cachedirective.Object) (*cachedirective.Object, string) {
	result := cachedirective.Object{
		RespDirectives: &cachedirective.ResponseCacheDirectives{},
	}
	var minMaxAge cachedirective.DeltaSeconds = -1
	isPrivate := false
	isPublic := false

	for _, policy := range policies {
		// Check no-store and no-cache first
		if policy.RespDirectives.NoStore {
			result.RespDirectives.NoStore = true
			return &result, "no-store"
		}
		if policy.RespDirectives.NoCachePresent {
			result.RespDirectives.NoCachePresent = true
		}

		// Determine the shortest max-age if available
		if policy.RespDirectives.MaxAge > 0 && (minMaxAge == -1 || policy.RespDirectives.MaxAge < minMaxAge) {
			minMaxAge = policy.RespDirectives.MaxAge
		}

		// Track if any policy specifies "private"
		if policy.RespDirectives.PrivatePresent {
			isPrivate = true
		} else if policy.RespDirectives.Public {
			isPublic = true
		}

		// Handle expires header comparisons
		if policy.RespExpiresHeader.Before(result.RespExpiresHeader) || result.RespExpiresHeader.IsZero() {
			result.RespExpiresHeader = policy.RespExpiresHeader
		}
	}

	// Set the calculated max-age and privacy level on the result
	if minMaxAge > 0 {
		result.RespDirectives.MaxAge = minMaxAge
	}
	result.RespDirectives.PrivatePresent = isPrivate

	// Format the final Cache-Control header
	headerParts := []string{}
	if result.RespDirectives.NoCachePresent {
		headerParts = append(headerParts, noCache)
	} else if minMaxAge > 0 {
		headerParts = append(headerParts, fmt.Sprintf("max-age=%d", minMaxAge))
	}
	if isPrivate {
		headerParts = append(headerParts, "private")
	} else if isPublic {
		headerParts = append(headerParts, "public")
	}
	cacheControlHeader := strings.Join(headerParts, ", ")

	return &result, cacheControlHeader
}

// SubgraphRules returns the list of header rules for the subgraph with the given name
func SubgraphRules(rules *config.HeaderRules, subgraphName string) []*config.RequestHeaderRule {
	if rules == nil {
		return nil
	}
	var subgraphRules []*config.RequestHeaderRule
	if rules.All != nil {
		subgraphRules = append(subgraphRules, rules.All.Request...)
	}
	if rules.Subgraphs != nil {
		if subgraphSpecificRules, ok := rules.Subgraphs[subgraphName]; ok {
			subgraphRules = append(subgraphRules, subgraphSpecificRules.Request...)
		}
	}
	return subgraphRules
}

// FetchURLRules returns the list of header rules for first subgraph that matches the given URL
func FetchURLRules(rules *config.HeaderRules, subgraphs []*nodev1.Subgraph, routingURL string) []*config.RequestHeaderRule {
	var subgraphName string
	for _, subgraph := range subgraphs {
		if subgraph.RoutingUrl == routingURL {
			subgraphName = subgraph.Name
			break
		}
	}
	return SubgraphRules(rules, subgraphName)
}

// PropagatedHeaders returns the list of header names and regular expressions
// that will be propagated when applying the given rules.
func PropagatedHeaders(rules []*config.RequestHeaderRule) (headerNames []string, headerNameRegexps []graphql_datasource.RegularExpression, err error) {
	for _, rule := range rules {
		switch rule.Operation {
		case config.HeaderRuleOperationSet:
			if rule.Name == "" || (rule.Value == "" && rule.ValueFrom == nil && rule.Expression == "") {
				return nil, nil, fmt.Errorf("invalid header set rule %+v, no header name/value combination", rule)
			}
			headerNames = append(headerNames, rule.Name)
		case config.HeaderRuleOperationPropagate:
			if rule.Matching != "" {
				// Header Names are case insensitive: https://www.w3.org/Protocols/rfc2616/rfc2616.html
				re, err := regexp.Compile(caseInsensitiveRegexp + rule.Matching)
				if err != nil {
					return nil, nil, fmt.Errorf("error compiling regular expression %q in header rule %+v: %w", rule.Matching, rule, err)
				}
				headerNameRegexps = append(headerNameRegexps, graphql_datasource.RegularExpression{
					Pattern:     re,
					NegateMatch: rule.NegateMatch,
				})
			} else if rule.Named != "" {
				headerNames = append(headerNames, rule.Named)
			} else {
				return nil, nil, fmt.Errorf("invalid header propagation rule %+v, no header name nor regular expression", rule)
			}
		default:
			return nil, nil, fmt.Errorf("invalid header rule operation %q in rule %+v", rule.Operation, rule)
		}
	}
	return headerNames, headerNameRegexps, nil
}
