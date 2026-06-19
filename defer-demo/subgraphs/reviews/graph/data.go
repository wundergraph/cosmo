package graph

import "deferdemo/reviews/graph/model"

// Canonical fixture data (FIXTURES.md §5). All values fixed/deterministic.
//
// Reviews:
//   r1: rating 5, "Loved it.",      author u2, article a1
//   r2: rating 3, "It was fine.",   author u1, article a1
//   r3: rating 4, "Great read.",    author u1, article a2
//   r4: rating 5, "Best podcast.",  author u2, podcast p1
//   r5: rating 2, "Decent author.", author u1, review-of-user u1
//
// Join lists (canonical order):
//   Article("a1").reviews = [r1, r2]
//   Article("a2").reviews = [r3]
//   Podcast("p1").reviews = [r4]
//   User("u1").reviews    = [r2, r3, r5]  (authored by u1)
//   User("u2").reviews    = [r1, r4]      (authored by u2)

func newReview(id string, rating int, body, authorID, articleID string) *model.Review {
	r := &model.Review{
		ID:     id,
		Rating: rating,
		Body:   body,
		Author: &model.User{ID: authorID},
	}
	if articleID != "" {
		r.Article = &model.Article{ID: articleID}
	}
	return r
}

func reviewsByID() map[string]*model.Review {
	return map[string]*model.Review{
		"r1": newReview("r1", 5, "Loved it.", "u2", "a1"),
		"r2": newReview("r2", 3, "It was fine.", "u1", "a1"),
		"r3": newReview("r3", 4, "Great read.", "u1", "a2"),
		"r4": newReview("r4", 5, "Best podcast.", "u2", ""),
		"r5": newReview("r5", 2, "Decent author.", "u1", ""),
	}
}

func reviewIDsForArticle(id string) []string {
	switch id {
	case "a1":
		return []string{"r1", "r2"}
	case "a2":
		return []string{"r3"}
	}
	return nil
}

func reviewIDsForPodcast(id string) []string {
	if id == "p1" {
		return []string{"r4"}
	}
	return nil
}

func reviewIDsForUser(id string) []string {
	switch id {
	case "u1":
		return []string{"r2", "r3", "r5"}
	case "u2":
		return []string{"r1", "r4"}
	}
	return nil
}

func collectReviews(ids []string) []*model.Review {
	byID := reviewsByID()
	out := make([]*model.Review, 0, len(ids))
	for _, id := range ids {
		if r, ok := byID[id]; ok {
			out = append(out, r)
		}
	}
	return out
}
