package core

import (
	"net"
	"net/http"
	"strings"

	"github.com/wundergraph/cosmo/router/pkg/config"
)

// ResponseCacheStatusHeader reports the request's response cache status, with the other cache debug headers.
const ResponseCacheStatusHeader = "X-WG-Response-Cache"

// Cache-Tag header outcomes in ART.
const (
	cacheTagHeaderOutcomeEmpty     = "empty"
	cacheTagHeaderOutcomeComplete  = "complete"
	cacheTagHeaderOutcomeTruncated = "truncated"
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
func (h *GraphQLHandler) responseCacheTraceDetailsFunc(canEmitTagHeader func() bool) func(surrogateKeys []string) any {
	return func(surrogateKeys []string) any {
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
			details.TagHeader = describeCacheTagHeader(surrogateKeys, h.responseCacheTagHeader, canEmitTagHeader())
		}
		return details
	}
}

// describeCacheTagHeader is what buildCacheTagHeader makes of the request's surrogate keys.
func describeCacheTagHeader(surrogateKeys []string, cfg config.ResponseCacheTagHeaderConfig, canEmit bool) *cacheTagHeaderTrace {
	value := buildCacheTagHeader(surrogateKeys, cfg.Delimiter, cfg.MaxBytes)
	trace := &cacheTagHeaderTrace{
		Name:     cfg.Name,
		Value:    value,
		Emitted:  canEmit && value != "",
		Size:     len(value),
		MaxBytes: cfg.MaxBytes,
	}

	kept := make(map[string]struct{})
	if value != "" {
		for key := range strings.SplitSeq(value, cfg.Delimiter) {
			kept[key] = struct{}{}
		}
	}
	usable := 0
	for _, key := range surrogateKeys {
		if !usableCacheTag(key, cfg.Delimiter) {
			trace.Rejected = append(trace.Rejected, key)
			continue
		}
		if usable > 0 {
			trace.UntruncatedSize += len(cfg.Delimiter)
		}
		trace.UntruncatedSize += len(key)
		usable++
		if _, ok := kept[key]; !ok {
			trace.Dropped = append(trace.Dropped, key)
		}
	}

	switch {
	case usable == 0:
		trace.Outcome = cacheTagHeaderOutcomeEmpty
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
