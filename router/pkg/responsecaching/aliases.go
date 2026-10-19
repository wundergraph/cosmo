package responsecaching

import (
	"maps"
	"slices"
	"sync"
)

// SubgraphAliases maps a base subgraph to the feature flag subgraphs that
// replace it, so invalidating the one reaches entries of the others. Replaced
// whole on every config load.
type SubgraphAliases struct {
	mu      sync.RWMutex
	aliases map[string][]string
}

// Set replaces the aliases with bases, each feature flag subgraph's base.
func (a *SubgraphAliases) Set(bases map[string]string) {
	if a == nil {
		return
	}
	aliases := make(map[string][]string)
	for _, flagged := range slices.Sorted(maps.Keys(bases)) {
		base := bases[flagged]
		aliases[base] = append(aliases[base], flagged)
	}
	a.mu.Lock()
	a.aliases = aliases
	a.mu.Unlock()
}

// Expand is subgraph and every subgraph standing in for it.
func (a *SubgraphAliases) Expand(subgraph string) []string {
	if a == nil {
		return []string{subgraph}
	}
	a.mu.RLock()
	defer a.mu.RUnlock()
	return append([]string{subgraph}, a.aliases[subgraph]...)
}
