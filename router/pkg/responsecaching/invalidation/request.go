package invalidation

import (
	"fmt"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/caching"
)

// Kind names what an invalidation request selects entries by. Each corresponds
// to one of the secondary indexes the store maintains
type Kind string

const (
	KindSubgraph Kind = "subgraph"
	KindType     Kind = "type"
	KindCacheTag Kind = "cache_tag"
)

type Request struct {
	Kind      Kind     `json:"kind"`
	Subgraph  string   `json:"subgraph,omitempty"`
	Type      string   `json:"type,omitempty"`
	Subgraphs []string `json:"subgraphs,omitempty"`
	CacheTag  string   `json:"cache_tag,omitempty"`
}

// tags returns the index entries this request names, or why it names none.

func (r Request) tags(indexes config.ResponseCacheInvalidationConfig) ([]string, error) {
	var (
		subgraphs []string
		indexed   bool
		tagFor    func(subgraph string) string
	)

	switch r.Kind {
	case KindSubgraph:
		if r.Subgraph == "" {
			return nil, fmt.Errorf("a %q request requires a subgraph", KindSubgraph)
		}
		subgraphs, indexed = []string{r.Subgraph}, indexes.Subgraph
		tagFor = caching.SubgraphTag

	case KindType:
		if r.Subgraph == "" {
			return nil, fmt.Errorf("a %q request requires a subgraph: a type is indexed per subgraph, so there is no way to name one across all of them", KindType)
		}
		if r.Type == "" {
			return nil, fmt.Errorf("a %q request requires a type", KindType)
		}
		subgraphs, indexed = []string{r.Subgraph}, indexes.Type
		tagFor = func(subgraph string) string { return caching.TypeTag(subgraph, r.Type) }

	case KindCacheTag:
		if len(r.Subgraphs) == 0 {
			return nil, fmt.Errorf("a %q request requires at least one subgraph", KindCacheTag)
		}
		for _, subgraph := range r.Subgraphs {
			if subgraph == "" {
				return nil, fmt.Errorf("a %q request cannot name an empty subgraph", KindCacheTag)
			}
		}
		if r.CacheTag == "" {
			return nil, fmt.Errorf("a %q request requires a cache_tag", KindCacheTag)
		}
		subgraphs, indexed = r.Subgraphs, indexes.CacheTag
		tagFor = func(subgraph string) string { return caching.DeclaredTag(subgraph, r.CacheTag) }

	default:
		return nil, fmt.Errorf("unknown kind %q, expected one of %q, %q or %q", r.Kind, KindSubgraph, KindType, KindCacheTag)
	}

	// We don't return an error, so nothing will happen essentially
	if !indexed {
		return nil, nil
	}

	tags := make([]string, 0, len(subgraphs))
	for _, subgraph := range subgraphs {
		tags = append(tags, tagFor(subgraph))
	}

	return tags, nil
}

// Error is one reason an invalidation request was refused.
type Error struct {
	Index   int    `json:"index"`
	Kind    Kind   `json:"kind,omitempty"`
	Message string `json:"message"`
}

// errorResponse is what a refused request answers with.
type errorResponse struct {
	Errors []Error `json:"errors"`
}

// countResponse is what an accepted request answers with.
type countResponse struct {
	Count int `json:"count"`
}
