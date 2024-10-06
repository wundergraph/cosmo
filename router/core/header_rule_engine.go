package core

import (
	"context"
	"fmt"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"io"
	"net/http"
	"regexp"
	"slices"
	"sync"
	"time"

	cachedirective "github.com/pquerna/cachecontrol/cacheobject"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

var (
	_              EnginePreOriginHandler = (*HeaderPropagation)(nil)
	ignoredHeaders                        = []string{
		"Alt-Svc",
		"Connection",
		"Proxy-Connection", // non-standard but still sent by libcurl and rejected by e.g. google

		// Hop-by-hop headers
		// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Connection
		"Keep-Alive",
		"Proxy-Authenticate",
		"Proxy-Authorization",
		"Te",      // canonicalized version of "TE"
		"Trailer", // not Trailers per URL above; https://www.rfc-editor.org/errata_search.php?eid=4522
		"Transfer-Encoding",
		"Upgrade",

		// Content Negotiation. We must never propagate the client headers to the upstream
		// The router has to decide on its own what to send to the upstream
		"Content-Type",
		"Accept-Encoding",
		"Accept-Charset",
		"Accept",
	}
)

type responseHeaderPropagationKey struct{}

type responseHeaderPropagation struct {
	header               http.Header
	m                    *sync.Mutex
	previousCacheControl *cachedirective.Object
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

func HeaderPropagationWriter(w http.ResponseWriter, ctx context.Context) io.Writer {
	propagation := getResponseHeaderPropagation(ctx)
	if propagation == nil {
		return w
	}
	return &headerPropagationWriter{
		writer:            w,
		headerPropagation: propagation,
		propagateHeaders:  true,
	}
}

type headerPropagationWriter struct {
	writer            http.ResponseWriter
	headerPropagation *responseHeaderPropagation
	propagateHeaders  bool
}

func (h *headerPropagationWriter) Write(p []byte) (n int, err error) {
	if h.propagateHeaders {
		for k, v := range h.headerPropagation.header {
			for _, el := range v {
				h.writer.Header().Add(k, el)
			}
		}
		h.propagateHeaders = false
	}
	return h.writer.Write(p)
}

// HeaderPropagation is a pre-origin handler that can be used to propagate and
// manipulate headers from the client request to the upstream
type HeaderPropagation struct {
	regex            map[string]*regexp.Regexp
	rules            *config.HeaderRules
	hasRequestRules  bool
	hasResponseRules bool
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
		rules: rules,
		regex: map[string]*regexp.Regexp{},
	}

	rhrs, rhrrs := hf.getAllRules()
	hf.hasRequestRules = len(rhrs) > 0
	hf.hasResponseRules = len(rhrrs) > 0

	if err := hf.collectRuleMatchers(rhrs, rhrrs); err != nil {
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

func (hf *HeaderPropagation) getAllRules() ([]*config.RequestHeaderRule, []*config.ResponseHeaderRule) {
	rhrs := hf.rules.All.Request
	for _, subgraph := range hf.rules.Subgraphs {
		rhrs = append(rhrs, subgraph.Request...)
	}

	rhrrs := hf.rules.All.Response
	for _, subgraph := range hf.rules.Subgraphs {
		rhrrs = append(rhrrs, subgraph.Response...)
	}

	return rhrs, rhrrs
}

func (hf *HeaderPropagation) processRule(rule config.HeaderRule, index int) error {
	switch rule.GetOperation() {
	case config.HeaderRuleOperationSet:
	case config.HeaderRuleOperationPropagate:
		if rule.GetMatching() != "" {
			regex, err := regexp.Compile(rule.GetMatching())
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

func (h *HeaderPropagation) OnOriginRequest(request *http.Request, ctx RequestContext) (*http.Request, *http.Response) {
	for _, rule := range h.rules.All.Request {
		h.applyRequestRule(ctx, request, rule)
	}

	subgraph := ctx.ActiveSubgraph(request)
	if subgraph != nil {
		if subgraphRules, ok := h.rules.Subgraphs[subgraph.Name]; ok {
			for _, rule := range subgraphRules.Request {
				h.applyRequestRule(ctx, request, rule)
			}
		}
	}

	return request, nil
}

func (h *HeaderPropagation) OnOriginResponse(resp *http.Response, ctx RequestContext) *http.Response {
	propagation := getResponseHeaderPropagation(resp.Request.Context())
	if propagation == nil {
		return resp
	}

	for _, rule := range h.rules.All.Response {
		h.applyResponseRule(propagation, resp, rule)
	}

	subgraph := ctx.ActiveSubgraph(resp.Request)
	if subgraph != nil {
		if subgraphRules, ok := h.rules.Subgraphs[subgraph.Name]; ok {
			for _, rule := range subgraphRules.Response {
				h.applyResponseRule(propagation, resp, rule)
			}
		}
	}

	return resp
}

func (h *HeaderPropagation) applyResponseRule(propagation *responseHeaderPropagation, res *http.Response, rule *config.ResponseHeaderRule) {
	if rule.Operation == config.HeaderRuleOperationSet {
		propagation.header.Set(rule.Name, rule.Value)
		return
	}

	if rule.Operation != config.HeaderRuleOperationPropagate {
		return
	}

	if rule.Named != "" {
		if slices.Contains(ignoredHeaders, rule.Named) {
			return
		}

		value := res.Header.Get(rule.Named)
		if value != "" {
			h.applyResponseRuleKeyValue(res, propagation, rule, rule.Named, value)
		} else if rule.Default != "" {
			h.applyResponseRuleKeyValue(res, propagation, rule, rule.Named, rule.Default)
		}

		return
	} else if rule.Matching != "" {
		if regex, ok := h.regex[rule.Matching]; ok {
			for name := range res.Header {
				if regex.MatchString(name) {
					if slices.Contains(ignoredHeaders, name) {
						continue
					}
					h.applyResponseRuleKeyValue(res, propagation, rule, name, res.Header.Get(name))
				}
			}
		}
	} else if rule.Algorithm == config.ResponseHeaderRuleAlgorithmMostRestrictiveCacheControl {
		// Explicitly apply the CacheControl algorithm on the headers
		h.applyResponseRuleKeyValue(res, propagation, rule, "", "")
	}
}

func (h *HeaderPropagation) applyResponseRuleKeyValue(res *http.Response, propagation *responseHeaderPropagation, rule *config.ResponseHeaderRule, key, value string) {
	switch rule.Algorithm {
	case config.ResponseHeaderRuleAlgorithmFirstWrite:
		propagation.m.Lock()
		if val := propagation.header.Get(key); val == "" {
			propagation.header.Set(key, value)
		}
		propagation.m.Unlock()
	case config.ResponseHeaderRuleAlgorithmLastWrite:
		propagation.m.Lock()
		propagation.header.Set(key, value)
		propagation.m.Unlock()
	case config.ResponseHeaderRuleAlgorithmAppend:
		propagation.m.Lock()
		propagation.header.Add(key, value)
		propagation.m.Unlock()
	case config.ResponseHeaderRuleAlgorithmMostRestrictiveCacheControl:
		h.applyResponseRuleMostRestrictiveCacheControl(res, propagation, rule)
	}
}

func (h *HeaderPropagation) applyRequestRule(ctx RequestContext, request *http.Request, rule *config.RequestHeaderRule) {
	if rule.Operation == config.HeaderRuleOperationSet {
		request.Header.Set(rule.Name, rule.Value)
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
		if slices.Contains(ignoredHeaders, rule.Rename) {
			return
		}

		value := ctx.Request().Header.Get(rule.Named)
		if value != "" {
			request.Header.Set(rule.Rename, ctx.Request().Header.Get(rule.Named))
			request.Header.Del(rule.Named)
			return
		} else if rule.Default != "" {
			request.Header.Set(rule.Rename, rule.Default)
			request.Header.Del(rule.Named)
			return
		}

		return
	}

	/**
	 *	Propagate the header as is
	 */

	if rule.Named != "" {
		if slices.Contains(ignoredHeaders, rule.Named) {
			return
		}

		value := ctx.Request().Header.Get(rule.Named)
		if value != "" {
			request.Header.Set(rule.Named, ctx.Request().Header.Get(rule.Named))
		} else if rule.Default != "" {
			request.Header.Set(rule.Named, rule.Default)
		}

		return
	}

	/**
	 * Matching based on regex
	 */

	if regex, ok := h.regex[rule.Matching]; ok {
		for name := range ctx.Request().Header {
			// Headers are case-insensitive, but Go canonicalize them
			// Issue: https://github.com/golang/go/issues/37834
			if regex.MatchString(name) {

				/**
				 *	Rename the header before propagating and delete the original
				 */
				if rule.Rename != "" && rule.Named == "" {

					if slices.Contains(ignoredHeaders, rule.Rename) {
						continue
					}

					value := ctx.Request().Header.Get(name)
					if value != "" {
						request.Header.Set(rule.Rename, ctx.Request().Header.Get(name))
						request.Header.Del(name)
					} else if rule.Default != "" {
						request.Header.Set(rule.Rename, rule.Default)
						request.Header.Del(name)
					}

					continue
				}

				/**
				 *	Propagate the header as is
				 */
				if slices.Contains(ignoredHeaders, name) {
					continue
				}
				request.Header.Set(name, ctx.Request().Header.Get(name))
			}
		}
	}
}

func (h *HeaderPropagation) applyResponseRuleMostRestrictiveCacheControl(res *http.Response, propagation *responseHeaderPropagation, rule *config.ResponseHeaderRule) {
	cacheControlKey := "Cache-Control"

	ctx := res.Request.Context()
	tracer := rtrace.TracerFromContext(ctx)
	commonAttributes := []attribute.KeyValue{
		otel.WgOperationProtocol.String(OperationProtocolHTTP.String()),
	}

	_, span := tracer.Start(ctx, "HeaderPropagation - RestrictiveCacheControl",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(commonAttributes...),
	)

	// Set no-cache for all mutations, to ensure that requests to mutate data always work as expected (without returning cached data)
	if resolve.SingleFlightDisallowed(ctx) {
		var noCache = "no-cache"
		propagation.header.Set(cacheControlKey, noCache)
		return
	}

	reqCacheHeader := res.Request.Header.Get(cacheControlKey)
	reqDir, _ := cachedirective.ParseRequestCacheControl(reqCacheHeader)
	resCacheHeader := res.Header.Get(cacheControlKey)
	resDir, _ := cachedirective.ParseResponseCacheControl(resCacheHeader)
	expiresHeaderVal := res.Header.Get("Expires")
	expiresHeader, _ := http.ParseTime(expiresHeaderVal)
	dateHeader, _ := http.ParseTime(res.Header.Get("Date"))
	lastModifiedHeader, _ := http.ParseTime(res.Header.Get("Last-Modified"))

	obj := &cachedirective.Object{
		RespDirectives:         resDir,
		RespHeaders:            res.Header,
		RespStatusCode:         res.StatusCode,
		RespExpiresHeader:      expiresHeader,
		RespDateHeader:         dateHeader,
		RespLastModifiedHeader: lastModifiedHeader,

		ReqDirectives: reqDir,
		ReqHeaders:    res.Request.Header,
		ReqMethod:     res.Request.Method,

		NowUTC: time.Now().UTC(),
	}
	rv := cachedirective.ObjectResults{}

	cachedirective.CachableObject(obj, &rv)
	cachedirective.ExpirationObject(obj, &rv)

	span.SetAttributes(
		otel.WgResponseCacheControlReasons.String(fmt.Sprint(rv.OutReasons)),
		otel.WgResponseCacheControlWarnings.String(fmt.Sprint(rv.OutWarnings)),
		otel.WgResponseCacheControlExpiration.String(rv.OutExpirationTime.String()),
	)

	propagation.m.Lock()
	defer propagation.m.Unlock()

	defaultResponseCache, _ := cachedirective.ParseResponseCacheControl(rule.Default)
	defaultCacheControlObj := &cachedirective.Object{
		RespDirectives: defaultResponseCache,
	}

	if propagation.previousCacheControl == nil {
		if rule.Default != "" {
			propagation.previousCacheControl = defaultCacheControlObj
			propagation.header.Set(cacheControlKey, rule.Default)
		} else if reqCacheHeader == "" && resCacheHeader == "" && expiresHeaderVal == "" {
			// There is no default/previous value to set, and since no cache control headers have been set, exit early
			return
		} else {
			propagation.previousCacheControl = obj
			propagation.header.Set(cacheControlKey, res.Header.Get(cacheControlKey))
			return
		}
	} else if rule.Default != "" && isMoreRestrictive(defaultCacheControlObj, propagation.previousCacheControl) {
		// Overwriting previous cache control with the current subgraph default
		propagation.previousCacheControl = defaultCacheControlObj
		propagation.header.Set(cacheControlKey, rule.Default)
	}

	if !expiresHeader.IsZero() && (propagation.previousCacheControl.RespExpiresHeader.IsZero() || expiresHeader.Before(propagation.previousCacheControl.RespExpiresHeader)) {
		propagation.previousCacheControl = obj
		propagation.header.Set("Expires", res.Header.Get("Expires"))
	}

	// Compare the previous cache control with the current one to find the most restrictive
	if !isMoreRestrictive(propagation.previousCacheControl, obj) {
		// The current cache control is more restrictive, so update it
		propagation.previousCacheControl = obj
		propagation.header.Set(cacheControlKey, res.Header.Get(cacheControlKey))
	}
}

// isMoreRestrictive compares two cachedirective.Object instances and returns true if the first is more restrictive
func isMoreRestrictive(prev *cachedirective.Object, curr *cachedirective.Object) bool {
	// Example comparison logic: check if "no-store" or "no-cache" are present, which are more restrictive
	if prev.RespDirectives.NoStore || curr.RespDirectives.NoStore {
		return true // No store is the most restrictive
	}
	if prev.RespDirectives.NoCachePresent && !curr.RespDirectives.NoCachePresent {
		return true // No-cache is more restrictive than not having it
	}
	if curr.RespDirectives.NoCachePresent && !prev.RespDirectives.NoCachePresent {
		return false // Current response has no-cache, which is more restrictive
	}

	// Compare max-age: the shorter max-age is more restrictive
	if prev.RespDirectives.MaxAge > 0 && curr.RespDirectives.MaxAge > 0 {
		return prev.RespDirectives.MaxAge < curr.RespDirectives.MaxAge
	}

	// If neither has max-age, but one has other expiration controls like Expires header, use that
	if !prev.RespExpiresHeader.IsZero() && !curr.RespExpiresHeader.IsZero() {
		return prev.RespExpiresHeader.Before(curr.RespExpiresHeader)
	}

	// Fallback: if they are equal in restrictiveness, keep the previous one
	return true
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
func PropagatedHeaders(rules []*config.RequestHeaderRule) (headerNames []string, headerNameRegexps []*regexp.Regexp, err error) {
	for _, rule := range rules {
		switch rule.Operation {
		case config.HeaderRuleOperationSet:
			if rule.Name == "" || rule.Value == "" {
				return nil, nil, fmt.Errorf("invalid header set rule %+v, no header name/value combination", rule)
			}
			headerNames = append(headerNames, rule.Name)
		case config.HeaderRuleOperationPropagate:
			if rule.Matching != "" {
				re, err := regexp.Compile(rule.Matching)
				if err != nil {
					return nil, nil, fmt.Errorf("error compiling regular expression %q in header rule %+v: %w", rule.Matching, rule, err)
				}
				headerNameRegexps = append(headerNameRegexps, re)
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
