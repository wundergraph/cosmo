// Package cache_tags provides a custom router module that collects cache tags
// and Cache-Control policies from subgraph responses. It targets synchronous
// GraphQL responses; HTTP headers cannot be changed after a deferred or
// streaming response has started.
package cache_tags

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/wundergraph/cosmo/router/core"
	"golang.org/x/net/http/httpguts"
)

const (
	moduleID                  = "cacheTagsModule"
	requestStateContextKey    = "cache_tags_module_request_state"
	cacheControlHeaderName    = "Cache-Control"
	cacheTagValueDelimiter    = ","
	cacheTagOutputDelimiter   = ","
	cacheControlJoinDelimiter = ", "
)

// CacheTagsModule collects the configured header from every subgraph response
// and exposes the merged values on the federated response.
type CacheTagsModule struct {
	HeaderName string `mapstructure:"header_name"`
}

func (m *CacheTagsModule) Provision(_ *core.ModuleContext) error {
	headerName := strings.TrimSpace(m.HeaderName)
	if headerName == "" {
		return fmt.Errorf("header_name must not be empty")
	}
	if !httpguts.ValidHeaderFieldName(headerName) {
		return fmt.Errorf("header_name %q is not a valid HTTP header name", headerName)
	}

	m.HeaderName = http.CanonicalHeaderKey(headerName)
	switch m.HeaderName {
	case cacheControlHeaderName, "Connection", "Content-Length", "Trailer", "Transfer-Encoding":
		return fmt.Errorf("header_name must not be a reserved response header: %s", m.HeaderName)
	}

	return nil
}

// Middleware initializes the aggregation state before any subgraph requests
// are made. Module instances are shared by all requests, so the mutable state
// must live on the request context instead of the module.
func (m *CacheTagsModule) Middleware(ctx core.RequestContext, next http.Handler) {
	state := &requestState{
		responseWriter: ctx.ResponseWriter(),
		tags:           make(map[string]struct{}),
	}
	ctx.Set(requestStateContextKey, state)

	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

// OnOriginRequest intentionally leaves the request unchanged. Registering a
// pre-origin handler makes the router disable request deduplication unless it
// is force-enabled. That guarantees every client request receives its own
// OnOriginResponse callbacks and therefore its own collected headers.
func (m *CacheTagsModule) OnOriginRequest(request *http.Request, _ core.RequestContext) (*http.Request, *http.Response) {
	return request, nil
}

// OnOriginResponse is called concurrently for subgraph responses. It adds the
// response's cache tags to the request-local set and retains the most
// restrictive Cache-Control policy.
func (m *CacheTagsModule) OnOriginResponse(response *http.Response, ctx core.RequestContext) *http.Response {
	if response == nil {
		return nil
	}

	value, ok := ctx.Get(requestStateContextKey)
	if !ok {
		return nil
	}
	state, ok := value.(*requestState)
	if !ok {
		return nil
	}

	state.merge(m.HeaderName, response.Header)

	// Returning a non-nil response would short-circuit the remaining
	// post-origin handlers. This module only observes the response.
	return nil
}

func (m *CacheTagsModule) Module() core.ModuleInfo {
	return core.ModuleInfo{
		ID:       moduleID,
		Priority: 1,
		New: func() core.Module {
			return &CacheTagsModule{}
		},
	}
}

type requestState struct {
	mu             sync.Mutex
	responseWriter http.ResponseWriter
	tags           map[string]struct{}
	cacheControl   cacheControlPolicy
}

func (s *requestState) merge(tagHeaderName string, subgraphHeaders http.Header) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, value := range subgraphHeaders.Values(tagHeaderName) {
		for tag := range strings.SplitSeq(value, cacheTagValueDelimiter) {
			tag = strings.TrimSpace(tag)
			if tag != "" {
				s.tags[tag] = struct{}{}
			}
		}
	}

	if policy, ok := parseCacheControl(subgraphHeaders.Values(cacheControlHeaderName)); ok {
		s.cacheControl.merge(policy)
	}

	s.applyHeaders(tagHeaderName)
}

func (s *requestState) applyHeaders(tagHeaderName string) {
	if len(s.tags) > 0 {
		tags := make([]string, 0, len(s.tags))
		for tag := range s.tags {
			tags = append(tags, tag)
		}
		sort.Strings(tags)
		s.responseWriter.Header().Set(tagHeaderName, strings.Join(tags, cacheTagOutputDelimiter))
	}

	if s.cacheControl.present {
		s.responseWriter.Header().Set(cacheControlHeaderName, s.cacheControl.headerValue())
	}
}

type cacheControlPolicy struct {
	present   bool
	noStore   bool
	noCache   bool
	private   bool
	public    bool
	hasMaxAge bool
	maxAge    uint64
}

// parseCacheControl extracts the directives needed to build the combined
// policy. Multiple max-age directives are reduced to their lowest value.
func parseCacheControl(values []string) (cacheControlPolicy, bool) {
	policy := cacheControlPolicy{}
	for directive := range strings.SplitSeq(strings.Join(values, cacheControlJoinDelimiter), ",") {
		name, value, hasValue := strings.Cut(strings.TrimSpace(directive), "=")
		switch {
		case strings.EqualFold(name, "no-store"):
			policy.present = true
			policy.noStore = true
		case strings.EqualFold(name, "no-cache"):
			policy.present = true
			policy.noCache = true
		case strings.EqualFold(name, "private"):
			policy.present = true
			policy.private = true
		case strings.EqualFold(name, "public"):
			policy.present = true
			policy.public = true
		case strings.EqualFold(name, "max-age") && hasValue:
			maxAge, err := strconv.ParseUint(strings.Trim(strings.TrimSpace(value), `"`), 10, 64)
			if err == nil && (!policy.hasMaxAge || maxAge < policy.maxAge) {
				policy.present = true
				policy.hasMaxAge = true
				policy.maxAge = maxAge
			}
		}
	}

	return policy, policy.present
}

func (p *cacheControlPolicy) merge(other cacheControlPolicy) {
	p.present = p.present || other.present
	p.noStore = p.noStore || other.noStore
	p.noCache = p.noCache || other.noCache
	p.private = p.private || other.private
	p.public = p.public || other.public
	if other.hasMaxAge && (!p.hasMaxAge || other.maxAge < p.maxAge) {
		p.hasMaxAge = true
		p.maxAge = other.maxAge
	}
}

func (p cacheControlPolicy) headerValue() string {
	if p.noStore {
		return "no-store"
	}

	parts := make([]string, 0, 2)
	if p.noCache {
		parts = append(parts, "no-cache")
	} else if p.hasMaxAge {
		parts = append(parts, fmt.Sprintf("max-age=%d", p.maxAge))
	}

	if p.private {
		parts = append(parts, "private")
	} else if p.public {
		parts = append(parts, "public")
	}

	return strings.Join(parts, cacheControlJoinDelimiter)
}

var (
	_ core.Module                  = (*CacheTagsModule)(nil)
	_ core.Provisioner             = (*CacheTagsModule)(nil)
	_ core.RouterMiddlewareHandler = (*CacheTagsModule)(nil)
	_ core.EnginePreOriginHandler  = (*CacheTagsModule)(nil)
	_ core.EnginePostOriginHandler = (*CacheTagsModule)(nil)
)
