package core

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"slices"
	"sync"
	"time"

	cachedirective "github.com/pquerna/cachecontrol/cacheobject"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
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
			h.writer.Header()[k] = v
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

func NewHeaderPropagation(rules *config.HeaderRules) (*HeaderPropagation, error) {

	if rules == nil {
		return nil, nil
	}

	if rules.All == nil {
		rules.All = &config.GlobalHeaderRule{}
	}
	if rules.Subgraphs == nil {
		rules.Subgraphs = make(map[string]*config.GlobalHeaderRule)
	}

	hf := HeaderPropagation{
		rules: rules,
		regex: map[string]*regexp.Regexp{},
	}

	var rhrs []*config.RequestHeaderRule

	rhrs = append(rhrs, rules.All.Request...)

	for _, subgraph := range rules.Subgraphs {
		rhrs = append(rhrs, subgraph.Request...)
	}

	for i, rule := range rhrs {
		switch rule.Operation {
		case config.HeaderRuleOperationPropagate:
			if rule.Matching != "" {
				regex, err := regexp.Compile(rule.Matching)
				if err != nil {
					return nil, fmt.Errorf("invalid regex '%s' for header rule %d: %w", rule.Matching, i, err)
				}
				hf.regex[rule.Matching] = regex
			}
		default:
			return nil, fmt.Errorf("unhandled operation '%s' for header rule %+v", rule.Operation, rule)
		}
	}

	hf.hasRequestRules = len(rhrs) > 0

	var rhrrs []*config.ResponseHeaderRule

	rhrrs = append(rhrrs, rules.All.Response...)

	for _, subgraph := range rules.Subgraphs {
		rhrrs = append(rhrrs, subgraph.Response...)
	}

	for i, rule := range rhrrs {
		switch rule.Operation {
		case config.HeaderRuleOperationPropagate:
			if rule.Matching != "" {
				regex, err := regexp.Compile(rule.Matching)
				if err != nil {
					return nil, fmt.Errorf("invalid regex '%s' for header rule %d: %w", rule.Matching, i, err)
				}
				hf.regex[rule.Matching] = regex
			}
		default:
			return nil, fmt.Errorf("unhandled operation '%s' for header rule %+v", rule.Operation, rule)
		}
	}

	hf.hasResponseRules = len(rhrrs) > 0

	return &hf, nil
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
	}

	if rule.Matching != "" {
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
	}
}

func (h *HeaderPropagation) applyResponseRuleKeyValue(res *http.Response, propagation *responseHeaderPropagation, rule *config.ResponseHeaderRule, key, value string) {
	switch rule.Algorithm {
	case config.ResponseHeaderRuleAlgorithmFirstWrite:
		propagation.m.Lock()
		if _, ok := propagation.header[key]; !ok {
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
		h.applyResponseRuleMostRestrictiveCacheControl(res, propagation, key)
	}
}

func (h *HeaderPropagation) applyRequestRule(ctx RequestContext, request *http.Request, rule *config.RequestHeaderRule) {

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

func (h *HeaderPropagation) applyResponseRuleMostRestrictiveCacheControl(res *http.Response, propagation *responseHeaderPropagation, cacheControlKey string) {
	reqDir, _ := cachedirective.ParseRequestCacheControl(res.Request.Header.Get(cacheControlKey))
	resDir, _ := cachedirective.ParseResponseCacheControl(res.Header.Get(cacheControlKey))
	expiresHeader, _ := http.ParseTime(res.Header.Get("Expires"))
	dateHeader, _ := http.ParseTime(res.Header.Get("Date"))
	lastModifiedHeader, _ := http.ParseTime(res.Header.Get("Last-Modified"))

	obj := &cachedirective.Object{
		RespDirectives:         resDir,
		RespHeaders:            res.Header,
		RespStatusCode:         res.StatusCode,
		RespExpiresHeader:      expiresHeader,
		RespDateHeader:         dateHeader,
		RespLastModifiedHeader: lastModifiedHeader,

		//CacheIsPrivate: false,

		ReqDirectives: reqDir,
		ReqHeaders:    res.Request.Header,
		ReqMethod:     res.Request.Method,

		NowUTC: time.Now().UTC(),
	}
	rv := cachedirective.ObjectResults{}

	cachedirective.CachableObject(obj, &rv)
	cachedirective.ExpirationObject(obj, &rv)

	fmt.Println("Errors: ", rv.OutErr)
	fmt.Println("Reasons to not cache: ", rv.OutReasons)
	fmt.Println("Warning headers to add: ", rv.OutWarnings)
	fmt.Println("Expiration: ", rv.OutExpirationTime.String())

	propagation.m.Lock()
	defer propagation.m.Unlock()

	if propagation.previousCacheControl == nil {
		propagation.previousCacheControl = obj
		propagation.header.Set(cacheControlKey, res.Header.Get(cacheControlKey))
		return
	}

	// TODO: if the previous cache control is more restrictive than the current one, keep it, otherwise, update it
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
