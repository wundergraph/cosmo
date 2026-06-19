package graph

import "deferdemo/content/graph/model"

// Canonical fixture data per FIXTURES.md (content subgraph owns Article, Podcast).
// Values are fixed/deterministic.

// authorRef returns a User reference with only the fields content owns.
// displayName is @external; populated only where content @provides it
// (featuredArticle). Elsewhere it stays empty so the router fetches it
// from accounts.
func articleA1() *model.Article {
	return &model.Article{
		ID:           "a1",
		Slug:         "hello",
		Locale:       "en",
		Title:        "Hello World",
		Body:         "This is the hello article body.",
		WordCount:    400,
		PublishedAt:  "2024-01-15T00:00:00Z",
		HeroImageURL: "https://cdn.example.com/hero/a1.jpg",
		Author:       &model.User{ID: "u1"},
	}
}

func articleA2() *model.Article {
	return &model.Article{
		ID:           "a2",
		Slug:         "world",
		Locale:       "en",
		Title:        "World News",
		Body:         "This is the world article body.",
		WordCount:    1000,
		PublishedAt:  "2024-02-20T00:00:00Z",
		HeroImageURL: "https://cdn.example.com/hero/a2.jpg",
		Author:       &model.User{ID: "u2"},
	}
}

func podcastP1() *model.Podcast {
	return &model.Podcast{
		ID:              "p1",
		Title:           "The Hello Podcast",
		PublishedAt:     "2024-03-10T00:00:00Z",
		DurationSeconds: 1800,
		Host:            &model.User{ID: "u1"},
	}
}

func articleByID(id string) *model.Article {
	switch id {
	case "a1":
		return articleA1()
	case "a2":
		return articleA2()
	}
	return nil
}

func podcastByID(id string) *model.Podcast {
	if id == "p1" {
		return podcastP1()
	}
	return nil
}
