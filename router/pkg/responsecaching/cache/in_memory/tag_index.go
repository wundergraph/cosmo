package in_memory

import (
	"sync"
	"time"
)

// tagIndexPruneInterval is the least time between two sweeps, so a burst of
// writes pays for one walk of the index rather than one each.
const tagIndexPruneInterval = 30 * time.Second

// tagIndex maps a tag to the entries carrying it, and each entry to when it was
// due to expire. Ristretto cannot be iterated and does not say when an entry
// leaves, so the index prunes on its own note of expiry rather than on being
// told.
type tagIndex struct {
	mu        sync.Mutex
	tags      map[string]map[string]time.Time
	lastPrune time.Time
}

func newTagIndex() *tagIndex {
	return &tagIndex{tags: make(map[string]map[string]time.Time), lastPrune: time.Now()}
}

// add records that key carries each of tags until expiresAt. A key already in a
// tag has its expiry moved rather than being added twice.
func (t *tagIndex) add(key string, tags []string, expiresAt time.Time) {
	if len(tags) == 0 {
		return
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	for _, tag := range tags {
		keys, ok := t.tags[tag]
		if !ok {
			keys = make(map[string]time.Time, 1)
			t.tags[tag] = keys
		}
		keys[key] = expiresAt
	}
}

// prune drops expired members, and any tag left with none. A no-op until
// tagIndexPruneInterval has passed.
func (t *tagIndex) prune(now time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()

	if now.Sub(t.lastPrune) < tagIndexPruneInterval {
		return
	}
	t.lastPrune = now

	for tag, keys := range t.tags {
		for key, expiresAt := range keys {
			if expiresAt.After(now) {
				continue
			}
			delete(keys, key)
		}
		if len(keys) == 0 {
			delete(t.tags, tag)
		}
	}
}
