package graph

// This file will not be regenerated automatically.
//
// It serves as dependency injection for your app, add any dependencies you require
// here.

import (
	"time"

	"deferdemo/recommendations/graph/model"
)

type Resolver struct{}

// deferLatency is the mock "expensive ML recommendation" latency applied only to
// the slow defer-target field resolvers (DESIGN §6). Values stay fixed/deterministic.
const deferLatency = 150 * time.Millisecond

// displayNames is the @shareable User.displayName owned by this subgraph (FIXTURES §1).
var displayNames = map[string]string{
	"u1": "Alice Author",
	"u2": "Bob Builder",
}

// recommendedArticleIDs: User.recommendedArticles join (FIXTURES §6).
var recommendedArticleIDs = map[string][]string{
	"u1": {"a2"},
	"u2": {"a1"},
}

// publishableRef identifies an abstract Publishable member by its concrete type
// and key id; title/publishedAt are @external and resolved by the content subgraph.
type publishableRef struct {
	typename string // "Article" | "Podcast"
	id       string
}

// relatedContentMembers: Article.relatedContent join (FIXTURES §6).
var relatedContentMembers = map[string][]publishableRef{
	"a1": {{"Article", "a2"}, {"Podcast", "p1"}},
	"a2": {{"Podcast", "p1"}},
}

func newPublishable(ref publishableRef) model.Publishable {
	if ref.typename == "Podcast" {
		return &model.Podcast{ID: ref.id}
	}
	return &model.Article{ID: ref.id}
}
