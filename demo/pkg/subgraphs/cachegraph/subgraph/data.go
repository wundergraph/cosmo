package subgraph

import (
	"sort"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs/cachegraph/subgraph/model"
)

var articlesData = []*model.Article{
	{
		ID:          "1",
		Title:       "Introduction to GraphQL Caching",
		Body:        "Entity caching allows you to cache resolved entities at the subgraph level.",
		AuthorName:  "Alice",
		PublishedAt: "2025-01-15T10:00:00Z",
		Tags:        []string{"graphql", "caching", "federation"},
	},
	{
		ID:          "2",
		Title:       "Advanced Federation Patterns",
		Body:        "Learn how to use composite keys and nested keys in federation.",
		AuthorName:  "Bob",
		PublishedAt: "2025-02-20T14:30:00Z",
		Tags:        []string{"federation", "advanced"},
	},
	{
		ID:          "3",
		Title:       "Cache Invalidation Strategies",
		Body:        "Explore different approaches to invalidating cached entities.",
		AuthorName:  "Charlie",
		PublishedAt: "2025-03-10T09:00:00Z",
		Tags:        []string{"caching", "patterns"},
	},
	{
		ID:          "4",
		Title:       "Performance Tuning with Entity Caching",
		Body:        "How to get the most out of entity caching in production.",
		AuthorName:  "Alice",
		PublishedAt: "2025-04-01T11:00:00Z",
		Tags:        []string{"performance", "caching"},
	},
}

type listingKey struct {
	SellerID string
	SKU      string
}

var listingsData = map[listingKey]*model.Listing{
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

func allListings() []*model.Listing {
	out := make([]*model.Listing, 0, len(listingsData))
	for _, l := range listingsData {
		out = append(out, l)
	}
	return out
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
// Recommended articles per viewer — different users get different recommendations
var recommendedArticlesByViewer = map[string][]string{
	"v1": {"2", "3"},      // Alice → Advanced Federation + Cache Invalidation
	"v2": {"1", "4"},      // Bob → Intro to Caching + Performance Tuning
	"v3": {"1", "2", "3"}, // Charlie → all except Performance Tuning
}

var metricsData = map[string]*model.Metric{
	"m1": {ID: "m1", Name: "requests_per_second", Value: 1523.7, Unit: "req/s"},
	"m2": {ID: "m2", Name: "error_rate", Value: 0.23, Unit: "percent"},
	"m3": {ID: "m3", Name: "p99_latency", Value: 42.5, Unit: "ms"},
}
