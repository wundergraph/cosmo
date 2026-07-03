package subgraph

import (
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachegraph/subgraph/model"
)

// defaultArticles is the seed data for a fresh article store. Each Resolver
// clones this so mutations are isolated per server instance.
var defaultArticles = []*model.Article{
	{
		ID:          "1",
		Slug:        "introduction-to-graphql-caching",
		Title:       "Introduction to GraphQL Caching",
		Body:        "Entity caching allows you to cache resolved entities at the subgraph level.",
		AuthorName:  "Alice",
		PublishedAt: "2025-01-15T10:00:00Z",
		Tags:        []string{"graphql", "caching", "federation"},
	},
	{
		ID:          "2",
		Slug:        "advanced-federation-patterns",
		Title:       "Advanced Federation Patterns",
		Body:        "Learn how to use composite keys and nested keys in federation.",
		AuthorName:  "Bob",
		PublishedAt: "2025-02-20T14:30:00Z",
		Tags:        []string{"federation", "advanced"},
	},
	{
		ID:          "3",
		Slug:        "cache-invalidation-strategies",
		Title:       "Cache Invalidation Strategies",
		Body:        "Explore different approaches to invalidating cached entities.",
		AuthorName:  "Charlie",
		PublishedAt: "2025-03-10T09:00:00Z",
		Tags:        []string{"caching", "patterns"},
	},
	{
		ID:          "4",
		Slug:        "performance-tuning-with-entity-caching",
		Title:       "Performance Tuning with Entity Caching",
		Body:        "How to get the most out of entity caching in production.",
		AuthorName:  "Alice",
		PublishedAt: "2025-04-01T11:00:00Z",
		Tags:        []string{"performance", "caching"},
	},
}

// recommendedArticlesByViewer is read-only seed data — different users get
// different recommendations. Shared across stores because it is never mutated.
var recommendedArticlesByViewer = map[string][]string{
	"v1": {"2", "3"},      // Alice → Advanced Federation + Cache Invalidation
	"v2": {"1", "4"},      // Bob → Intro to Caching + Performance Tuning
	"v3": {"1", "2", "3"}, // Charlie → all except Performance Tuning
}

type listingKey struct {
	SellerID string
	SKU      string
}

// defaultListings is the seed data for a fresh listing store.
func defaultListings() map[listingKey]*model.Listing {
	return map[listingKey]*model.Listing{
		{SellerID: "s1", SKU: "WIDGET-01"}: {
			SellerID: "s1",
			Sku:      "WIDGET-01",
			Title:    "Premium Widget",
			Price:    29.99,
			Currency: "USD",
			InStock:  true,
		},
		{SellerID: "s1", SKU: "GADGET-02"}: {
			SellerID: "s1",
			Sku:      "GADGET-02",
			Title:    "Deluxe Gadget",
			Price:    49.99,
			Currency: "USD",
			InStock:  true,
		},
		{SellerID: "s2", SKU: "GIZMO-01"}: {
			SellerID: "s2",
			Sku:      "GIZMO-01",
			Title:    "Compact Gizmo",
			Price:    19.50,
			Currency: "EUR",
			InStock:  false,
		},
		{SellerID: "s2", SKU: "THING-03"}: {
			SellerID: "s2",
			Sku:      "THING-03",
			Title:    "Multi-Purpose Thing",
			Price:    9.99,
			Currency: "EUR",
			InStock:  true,
		},
	}
}

// articleStore is a mutex-guarded store for mutable article data. Used by the
// query, mutation, entity, and viewer resolvers.
type articleStore struct {
	mu       sync.RWMutex
	articles []*model.Article
}

func newArticleStore() *articleStore {
	return &articleStore{articles: cloneArticles(defaultArticles)}
}

func (s *articleStore) all() []*model.Article {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneArticles(s.articles)
}

func (s *articleStore) find(id string) *model.Article {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, a := range s.articles {
		if a.ID == id {
			return cloneArticle(a)
		}
	}
	return nil
}

func (s *articleStore) findBySlug(slug string) *model.Article {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, a := range s.articles {
		if a.Slug == slug {
			return cloneArticle(a)
		}
	}
	return nil
}

func (s *articleStore) byIDs(ids []string) []*model.Article {
	idSet := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		idSet[id] = struct{}{}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []*model.Article
	for _, a := range s.articles {
		if _, ok := idSet[a.ID]; ok {
			out = append(out, cloneArticle(a))
		}
	}
	return out
}

func (s *articleStore) update(id, title string) *model.Article {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.articles {
		if a.ID == id {
			a.Title = title
			return cloneArticle(a)
		}
	}
	return nil
}

func (s *articleStore) create(title, body, authorName string) *model.Article {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := fmt.Sprintf("%d", len(s.articles)+1)
	a := &model.Article{
		ID:          id,
		Slug:        "article-" + id,
		Title:       title,
		Body:        body,
		AuthorName:  authorName,
		PublishedAt: time.Now().Format(time.RFC3339),
		Tags:        []string{},
	}
	s.articles = append(s.articles, a)
	return cloneArticle(a)
}

func (s *articleStore) recommendedForViewer(viewerID string) []*model.Article {
	ids := recommendedArticlesByViewer[viewerID]
	if len(ids) == 0 {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []*model.Article
	for _, id := range ids {
		for _, a := range s.articles {
			if a.ID == id {
				out = append(out, cloneArticle(a))
				break
			}
		}
	}
	return out
}

// listingStore is a mutex-guarded store for mutable listing data.
type listingStore struct {
	mu       sync.RWMutex
	listings map[listingKey]*model.Listing
}

func newListingStore() *listingStore {
	return &listingStore{listings: defaultListings()}
}

func (s *listingStore) get(sellerID, sku string) *model.Listing {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if l, ok := s.listings[listingKey{SellerID: sellerID, SKU: sku}]; ok {
		return cloneListing(l)
	}
	return nil
}

func (s *listingStore) all() []*model.Listing {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*model.Listing, 0, len(s.listings))
	for _, l := range s.listings {
		out = append(out, cloneListing(l))
	}
	return out
}

func (s *listingStore) delete(sellerID, sku string) *model.Listing {
	k := listingKey{SellerID: sellerID, SKU: sku}
	s.mu.Lock()
	defer s.mu.Unlock()
	l, ok := s.listings[k]
	if !ok {
		return nil
	}
	delete(s.listings, k)
	return cloneListing(l)
}

func cloneArticle(a *model.Article) *model.Article {
	if a == nil {
		return nil
	}
	c := *a
	if a.Tags != nil {
		c.Tags = append([]string(nil), a.Tags...)
	}
	return &c
}

func cloneArticles(in []*model.Article) []*model.Article {
	out := make([]*model.Article, len(in))
	for i, a := range in {
		out[i] = cloneArticle(a)
	}
	return out
}

func cloneListing(l *model.Listing) *model.Listing {
	if l == nil {
		return nil
	}
	c := *l
	return &c
}

// --- read-only seed data below (no writers) ---

var venuesData = map[string]*model.Venue{
	"v1": {
		Address:  &model.Address{ID: "v1"},
		Name:     "Grand Conference Hall",
		Capacity: 500,
		City:     "Berlin",
	},
	"v2": {
		Address:  &model.Address{ID: "v2"},
		Name:     "Innovation Hub",
		Capacity: 150,
		City:     "Munich",
	},
	"v3": {
		Address:  &model.Address{ID: "v3"},
		Name:     "Tech Campus Auditorium",
		Capacity: 1000,
		City:     "Hamburg",
	},
}

func allVenues() []*model.Venue {
	out := make([]*model.Venue, 0, len(venuesData))
	for _, v := range venuesData {
		out = append(out, v)
	}
	return out
}

// UserProfile data — keyed by user ID, returns different data based on role
var userProfilesData = map[string]*model.UserProfile{
	"u1": {ID: "u1", Username: "alice", Email: "alice@example.com", Role: "admin"},
	"u2": {ID: "u2", Username: "bob", Email: "bob@example.com", Role: "editor"},
	"u3": {ID: "u3", Username: "charlie", Email: "charlie@example.com", Role: "viewer"},
}

// Catalog data — for partial cache load testing
var catalogsData = map[string]*model.Catalog{
	"c1": {ID: "c1", Name: "Electronics", Category: "tech", ItemCount: 342},
	"c2": {ID: "c2", Name: "Books", Category: "media", ItemCount: 1205},
	"c3": {ID: "c3", Name: "Clothing", Category: "fashion", ItemCount: 567},
}

func allCatalogs() []*model.Catalog {
	out := make([]*model.Catalog, 0, len(catalogsData))
	for _, c := range catalogsData {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].ID < out[j].ID
	})
	return out
}

// Metric data — for shadow mode testing
var metricsData = map[string]*model.Metric{
	"m1": {ID: "m1", Name: "requests_per_second", Value: 1523.7, Unit: "req/s"},
	"m2": {ID: "m2", Name: "error_rate", Value: 0.23, Unit: "percent"},
	"m3": {ID: "m3", Name: "p99_latency", Value: 42.5, Unit: "ms"},
}
