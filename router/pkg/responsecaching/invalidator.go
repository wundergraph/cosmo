package responsecaching

import (
	"context"
	"time"
)

// InvalidationWindow is how long a store remembers an invalidation of a tag,
// to drop writes read before it. It outlasts any fetch in flight then.
const InvalidationWindow = 5 * time.Minute

// Invalidator removes cached entries by the tags they were indexed under. It is
// declared here rather than beside the engine's Cache because invalidation is
// the router's half of response caching: the engine only ever writes the index.
type Invalidator interface {
	// InvalidateByTags removes every entry each tag names, and then the tag's
	// own index entry, returning how many entry keys it removed.
	InvalidateByTags(ctx context.Context, tags []string) (int, error)
}
