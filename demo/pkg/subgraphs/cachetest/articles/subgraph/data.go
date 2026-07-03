package subgraph

import "github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachetest/articles/subgraph/model"

type articleFixture struct {
	Title string
	Body  string
	Tags  []string
}

// articleFixtures keep article fields stable across entity resolutions so the
// synthetic entity-caching graph can model the same query shape repeatedly.
var articleFixtures = map[string]articleFixture{
	"a1": {
		Title: "The Rise of Federated GraphQL",
		Body:  "Federated GraphQL lets teams split ownership while keeping one graph.",
		Tags:  []string{"federation", "graphql"},
	},
	"a2": {
		Title: "Caching Strategies for Modern APIs",
		Body:  "Layered caching trades complexity for latency and load reduction.",
		Tags:  []string{"caching", "performance"},
	},
	"a3": {
		Title: "A Practical Guide to @requestScoped",
		Body:  "@requestScoped deduplicates repeated field reads within one request.",
		Tags:  []string{"request-scoped", "graphql"},
	},
}

// relatedArticleIDs maps each article to its related articles. Used by the
// Article.relatedArticles resolver to enable nested-selection tests.
var relatedArticleIDs = map[string][]string{
	"a1": {"a2", "a3"},
	"a2": {"a1", "a3"},
	"a3": {"a1", "a2"},
}

func allArticleIDs() []string {
	return []string{"a1", "a2", "a3"}
}

// buildArticle returns a populated Article including relatedArticles (as
// stubs — downstream entity lookups re-resolve them if the query selects
// nested fields).
func buildArticle(id string) *model.Article {
	fixture := articleFixtures[id]
	relatedIDs := relatedArticleIDs[id]
	related := make([]*model.Article, 0, len(relatedIDs))
	for _, rid := range relatedIDs {
		relatedFixture := articleFixtures[rid]
		related = append(related, &model.Article{
			ID:    rid,
			Title: relatedFixture.Title,
			Body:  relatedFixture.Body,
			Tags:  relatedFixture.Tags,
		})
	}
	return &model.Article{
		ID:              id,
		Title:           fixture.Title,
		Body:            fixture.Body,
		Tags:            fixture.Tags,
		RelatedArticles: related,
	}
}
