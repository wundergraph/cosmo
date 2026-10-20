package core

import (
	"net"
	"net/http"
	"strings"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

// ResponseCacheStatusHeader reports the request's response cache status, with the other cache debug headers.
const ResponseCacheStatusHeader = "X-WG-Response-Cache"

// Cache-Tag header outcomes in ART.
const (
	cacheTagHeaderOutcomeEmpty     = "empty"
	cacheTagHeaderOutcomeComplete  = "complete"
	cacheTagHeaderOutcomeTruncated = "truncated"
	// Did not fit, and on_overflow private sent none.
	cacheTagHeaderOutcomePrivate = "private"
)

// responseCacheTraceDetails is the router's part of the request's response cache trace.
type responseCacheTraceDetails struct {
	TagHeader    *cacheTagHeaderTrace           `json:"tag_header,omitempty"`
	Invalidation responseCacheInvalidationTrace `json:"invalidation"`
}

type cacheTagHeaderTrace struct {
	Name    string `json:"name"`
	Value   string `json:"value,omitempty"`
	Outcome string `json:"outcome"`
	// Emitted is false on a response with subgraph errors, which is marked no-store instead.
	Emitted bool `json:"emitted"`
	Size    int  `json:"size"`
	// UntruncatedSize is the header with every usable key, before max_bytes.
	UntruncatedSize int `json:"untruncated_size"`
	MaxBytes        int `json:"max_bytes"`
	// Tiers are the configured tiers; Excluded are keys of the others.
	Tiers    []string `json:"tiers"`
	Excluded []string `json:"excluded,omitempty"`
	// Dropped did not fit max_bytes; Rejected can never be in the header.
	Dropped  []string `json:"dropped,omitempty"`
	Rejected []string `json:"rejected,omitempty"`
}

type responseCacheInvalidationTrace struct {
	CacheTag bool `json:"cache_tag"`
	Subgraph bool `json:"subgraph"`
	Type     bool `json:"type"`
	// Endpoint is where invalidation requests go, when served.
	Endpoint string `json:"endpoint,omitempty"`
}

// responseCacheTraceDetailsFunc is resolve.ResponseCacheOptions.TraceDetails for one request.
// canEmitTagHeader reports whether this response's writer will set the Cache-Tag header.
func (h *GraphQLHandler) responseCacheTraceDetailsFunc(canEmitTagHeader func() bool) func(surrogateKeys []caching.SurrogateKey) any {
	return func(surrogateKeys []caching.SurrogateKey) any {
		details := responseCacheTraceDetails{
			Invalidation: responseCacheInvalidationTrace{
				CacheTag: h.responseCacheInvalidation.CacheTag,
				Subgraph: h.responseCacheInvalidation.Subgraph,
				Type:     h.responseCacheInvalidation.Type,
			},
		}
		if endpoint := h.responseCacheInvalidation.Endpoint; endpoint.Enabled {
			details.Invalidation.Endpoint = invalidationEndpointURL(endpoint.ListenAddr, endpoint.Path)
		}
		if h.responseCacheTagHeader.Enabled {
			details.TagHeader = describeCacheTagHeader(surrogateKeys, &h.responseCacheTagHeader, canEmitTagHeader())
		}
		return details
	}
}

// describeCacheTagHeader is what cacheTagHeader.set makes of the request's surrogate keys.
func describeCacheTagHeader(surrogateKeys []caching.SurrogateKey, h *cacheTagHeader, canEmit bool) *cacheTagHeaderTrace {
	value, overflow := buildCacheTagHeader(surrogateKeys, h.tiers, h.Delimiter, h.MaxBytes)
	private := overflow && h.OnOverflow == config.ResponseCacheTagHeaderOverflowPrivate
	if private {
		value = ""
	}
	trace := &cacheTagHeaderTrace{
		Name:     h.Name,
		Value:    value,
		Emitted:  canEmit && value != "",
		Size:     len(value),
		MaxBytes: h.MaxBytes,
		Tiers:    h.Tiers,
	}

	kept := make(map[string]struct{})
	if value != "" {
		for key := range strings.SplitSeq(value, h.Delimiter) {
			kept[key] = struct{}{}
		}
	}
	for _, key := range caching.SurrogateKeyValues(surrogateKeys) {
		if !usableCacheTag(key, h.Delimiter) {
			trace.Rejected = append(trace.Rejected, key)
		}
	}
	usable := cacheTagHeaderKeys(surrogateKeys, h.tiers, h.Delimiter)
	allowed := make(map[string]struct{}, len(usable))
	for i, key := range usable {
		allowed[key.Value] = struct{}{}
		if i > 0 {
			trace.UntruncatedSize += len(h.Delimiter)
		}
		trace.UntruncatedSize += len(key.Value)
		if _, ok := kept[key.Value]; !ok {
			trace.Dropped = append(trace.Dropped, key.Value)
		}
	}
	for _, key := range caching.SurrogateKeyValues(surrogateKeys) {
		if _, ok := allowed[key]; !ok && usableCacheTag(key, h.Delimiter) {
			trace.Excluded = append(trace.Excluded, key)
		}
	}

	switch {
	case len(usable) == 0:
		trace.Outcome = cacheTagHeaderOutcomeEmpty
	case private:
		trace.Outcome = cacheTagHeaderOutcomePrivate
	case len(trace.Dropped) == 0:
		trace.Outcome = cacheTagHeaderOutcomeComplete
	default:
		trace.Outcome = cacheTagHeaderOutcomeTruncated
	}
	return trace
}

// invalidationEndpointURL is where a browser on the router's machine reaches
// the endpoint: an unspecified host is localhost. Empty when listenAddr has no port.
func invalidationEndpointURL(listenAddr, path string) string {
	host, port, err := net.SplitHostPort(listenAddr)
	if err != nil {
		return ""
	}
	if ip := net.ParseIP(host); host == "" || (ip != nil && ip.IsUnspecified()) {
		host = "localhost"
	}
	return "http://" + net.JoinHostPort(host, port) + path
}

// setResponseCacheStatusHeader sets ResponseCacheStatusHeader once every fetch has reported.
func setResponseCacheStatusHeader(header http.Header, reqCtx *requestContext) {
	if status, ok := reqCtx.responseCacheStatus(); ok {
		header.Set(ResponseCacheStatusHeader, strings.ToUpper(status.String()))
	}
}
