package graph

import "deferdemo/accounts/graph/model"

// Canonical fixture data (FIXTURES.md §1, §2). Fixed and deterministic.

var orgO1 = &model.Organization{
	ID:          "o1",
	Name:        "Example Media Co",
	MemberCount: 12,
}

var organizations = map[string]*model.Organization{
	"o1": orgO1,
}

var users = map[string]*model.User{
	"u1": {
		ID:                "u1",
		Username:          "alice",
		DisplayName:       "Alice Author",
		Email:             "alice@example.com",
		InternalAuthToken: "tok_alice_001",
		Organization:      orgO1,
	},
	"u2": {
		ID:                "u2",
		Username:          "bob",
		DisplayName:       "Bob Builder",
		Email:             "bob@example.com",
		InternalAuthToken: "tok_bob_002",
		Organization:      orgO1,
	},
}

// userOrder is the canonical ordering for the users list query.
var userOrder = []string{"u1", "u2"}
