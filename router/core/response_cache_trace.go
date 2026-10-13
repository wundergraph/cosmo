package core

import (
	"net/http"
	"strings"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
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
	Emitted         bool     `json:"emitted"`
	Size            int      `json:"size"`
	UntruncatedSize int      `json:"untruncated_size"`
	MaxBytes        int      `json:"max_bytes"`
	Dropped         []string `json:"dropped,omitempty"`
}

type responseCacheInvalidationTrace struct {
	CacheTag bool `json:"cache_tag"`
	Subgraph bool `json:"subgraph"`
	Type     bool `json:"type"`
	// Endpoint is where invalidation requests go, when served.
	Endpoint string `json:"endpoint,omitempty"`
}

// responseCacheTraceDetailsFunc is resolve.ResponseCacheOptions.TraceDetails for one request.
func (h *GraphQLHandler) responseCacheTraceDetailsFunc(resolveCtx *resolve.Context) func(surrogateKeys []string) any {
	return func(surrogateKeys []string) any {
		details := responseCacheTraceDetails{
			Invalidation: responseCacheInvalidationTrace{
				CacheTag: h.responseCacheInvalidation.CacheTag,
				Subgraph: h.responseCacheInvalidation.Subgraph,
				Type:     h.responseCacheInvalidation.Type,
			},
		}
		if endpoint := h.responseCacheInvalidation.Endpoint; endpoint.Enabled {
			details.Invalidation.Endpoint = "http://" + endpoint.ListenAddr + endpoint.Path
		}
		if h.responseCacheTagHeader.Enabled {
			details.TagHeader = describeCacheTagHeader(surrogateKeys, h.responseCacheTagHeader, resolveCtx.SubgraphErrors() == nil)
		}
		return details
	}
}

// describeCacheTagHeader is what buildCacheTagHeader makes of the request's surrogate keys.
func describeCacheTagHeader(surrogateKeys []string, cfg config.ResponseCacheTagHeaderConfig, noSubgraphErrors bool) *cacheTagHeaderTrace {
	value := buildCacheTagHeader(surrogateKeys, cfg.Delimiter, cfg.MaxBytes)
	trace := &cacheTagHeaderTrace{
		Name:            cfg.Name,
		Value:           value,
		Emitted:         noSubgraphErrors && value != "",
		Size:            len(value),
		UntruncatedSize: len(strings.Join(surrogateKeys, cfg.Delimiter)),
		MaxBytes:        cfg.MaxBytes,
	}

	kept := make(map[string]struct{})
	if value != "" {
		for _, key := range strings.Split(value, cfg.Delimiter) {
			kept[key] = struct{}{}
		}
	}
	for _, key := range surrogateKeys {
		if _, ok := kept[key]; !ok {
			trace.Dropped = append(trace.Dropped, key)
		}
	}

	switch {
	case len(surrogateKeys) == 0:
		trace.Outcome = cacheTagHeaderOutcomeEmpty
	case len(trace.Dropped) == 0:
		trace.Outcome = cacheTagHeaderOutcomeComplete
	default:
		trace.Outcome = cacheTagHeaderOutcomeTruncated
	}
	return trace
}

// setResponseCacheStatusHeader sets ResponseCacheStatusHeader once every fetch has reported.
func setResponseCacheStatusHeader(header http.Header, reqCtx *requestContext) {
	if status, ok := reqCtx.responseCacheStatus(); ok {
		header.Set(ResponseCacheStatusHeader, strings.ToUpper(status.String()))
	}
}
