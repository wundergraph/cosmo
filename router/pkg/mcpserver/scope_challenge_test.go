package mcpserver

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestBestScopeChallenge(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name             string
		tokenScopes      []string
		combinedOrScopes [][]string
		want             []string
	}{
		// --- Simple OR scopes (single field, single-scope groups) ---
		// e.g. Query.topSecretFederationFacts → [["read:fact"], ["read:all"]]
		{
			name:             "returns nil when token satisfies first OR group",
			tokenScopes:      []string{"read:fact"},
			combinedOrScopes: [][]string{{"read:fact"}, {"read:all"}},
			want:             nil,
		},
		{
			name:             "returns nil when token satisfies second OR group",
			tokenScopes:      []string{"read:all"},
			combinedOrScopes: [][]string{{"read:fact"}, {"read:all"}},
			want:             nil,
		},
		{
			name:             "returns first group as challenge when token is empty and all groups tie",
			tokenScopes:      []string{},
			combinedOrScopes: [][]string{{"read:fact"}, {"read:all"}},
			want:             []string{"read:fact"},
		},
		{
			name:             "returns first group as challenge when token has only unrelated scopes",
			tokenScopes:      []string{"read:other"},
			combinedOrScopes: [][]string{{"read:fact"}, {"read:all"}},
			want:             []string{"read:fact"},
		},

		// --- Mutation with simple OR scopes ---
		// e.g. Mutation.addFact → [["write:fact"], ["write:all"]]
		{
			name:             "returns nil when token has matching write scope for first OR group",
			tokenScopes:      []string{"write:fact"},
			combinedOrScopes: [][]string{{"write:fact"}, {"write:all"}},
			want:             nil,
		},
		{
			name:             "returns nil when token has wildcard write scope for second OR group",
			tokenScopes:      []string{"write:all"},
			combinedOrScopes: [][]string{{"write:fact"}, {"write:all"}},
			want:             nil,
		},
		{
			name:             "returns first group as challenge when token has scope from wrong category",
			tokenScopes:      []string{"read:fact"},
			combinedOrScopes: [][]string{{"write:fact"}, {"write:all"}},
			want:             []string{"write:fact"},
		},
		{
			name:             "returns first group as challenge when token is empty for mutation",
			tokenScopes:      []string{},
			combinedOrScopes: [][]string{{"write:fact"}, {"write:all"}},
			want:             []string{"write:fact"},
		},

		// --- AND scopes with OR alternative ---
		// e.g. Employee.startDate → [["read:employee", "read:private"], ["read:all"]]
		{
			name:             "returns nil when token satisfies all scopes in an AND group",
			tokenScopes:      []string{"read:employee", "read:private"},
			combinedOrScopes: [][]string{{"read:employee", "read:private"}, {"read:all"}},
			want:             nil,
		},
		{
			name:             "returns nil when token satisfies alternative single-scope OR group",
			tokenScopes:      []string{"read:all"},
			combinedOrScopes: [][]string{{"read:employee", "read:private"}, {"read:all"}},
			want:             nil,
		},
		{
			name:             "returns first group when token partially matches on tie",
			tokenScopes:      []string{"read:employee"},
			combinedOrScopes: [][]string{{"read:employee", "read:private"}, {"read:all"}},
			want:             []string{"read:employee", "read:private"},
		},
		{
			name:             "returns first group when token has the other partial match on tie",
			tokenScopes:      []string{"read:private"},
			combinedOrScopes: [][]string{{"read:employee", "read:private"}, {"read:all"}},
			want:             []string{"read:employee", "read:private"},
		},
		{
			name:             "returns shorter group as challenge when token is empty and groups differ in size",
			tokenScopes:      []string{},
			combinedOrScopes: [][]string{{"read:employee", "read:private"}, {"read:all"}},
			want:             []string{"read:all"},
		},

		// --- Cross-product: multiple scoped fields ---
		// 3 scoped fields with cross-product yielding 6 groups (see plan Operation 5)
		{
			name:        "returns group with fewest missing scopes when token has wildcard",
			tokenScopes: []string{"read:all"},
			combinedOrScopes: [][]string{
				{"read:fact", "read:scalar", "read:miscellaneous"},
				{"read:fact", "read:scalar", "read:all", "read:miscellaneous"},
				{"read:fact", "read:all", "read:scalar", "read:miscellaneous"},
				{"read:fact", "read:all", "read:miscellaneous"},
				{"read:all", "read:scalar", "read:miscellaneous"},
				{"read:all", "read:miscellaneous"},
			},
			want: []string{"read:all", "read:miscellaneous"}, // missing only 1
		},
		{
			name:        "returns group with fewest missing scopes for partial match",
			tokenScopes: []string{"read:fact", "read:scalar"},
			combinedOrScopes: [][]string{
				{"read:fact", "read:scalar", "read:miscellaneous"},
				{"read:fact", "read:scalar", "read:all", "read:miscellaneous"},
				{"read:fact", "read:all", "read:scalar", "read:miscellaneous"},
				{"read:fact", "read:all", "read:miscellaneous"},
				{"read:all", "read:scalar", "read:miscellaneous"},
				{"read:all", "read:miscellaneous"},
			},
			want: []string{"read:fact", "read:scalar", "read:miscellaneous"}, // missing only "read:miscellaneous"
		},
		{
			name:        "returns group with fewest total scopes when token is empty",
			tokenScopes: []string{},
			combinedOrScopes: [][]string{
				{"read:fact", "read:scalar", "read:miscellaneous"},
				{"read:fact", "read:scalar", "read:all", "read:miscellaneous"},
				{"read:fact", "read:all", "read:scalar", "read:miscellaneous"},
				{"read:fact", "read:all", "read:miscellaneous"},
				{"read:all", "read:scalar", "read:miscellaneous"},
				{"read:all", "read:miscellaneous"},
			},
			want: []string{"read:all", "read:miscellaneous"}, // fewest total: 2
		},

		// --- Cross-subgraph aggregation ---
		// Products + Employees subgraph scoped fields, cross-product yields 4 groups
		{
			name:        "returns nil when token has wildcard scope satisfying aggregated groups",
			tokenScopes: []string{"read:all"},
			combinedOrScopes: [][]string{
				{"read:fact", "read:employee", "read:private"},
				{"read:fact", "read:all"},
				{"read:all", "read:employee", "read:private"},
				{"read:all"},
			},
			want: nil,
		},
		{
			name:        "returns closest group when token partially matches across subgraphs",
			tokenScopes: []string{"read:fact"},
			combinedOrScopes: [][]string{
				{"read:fact", "read:employee", "read:private"},
				{"read:fact", "read:all"},
				{"read:all", "read:employee", "read:private"},
				{"read:all"},
			},
			want: []string{"read:fact", "read:all"}, // missing 1, tied with group 4, first tie wins
		},
		{
			name:        "returns smallest group when token has unrelated partial match",
			tokenScopes: []string{"read:employee"},
			combinedOrScopes: [][]string{
				{"read:fact", "read:employee", "read:private"},
				{"read:fact", "read:all"},
				{"read:all", "read:employee", "read:private"},
				{"read:all"},
			},
			want: []string{"read:all"}, // missing 1, clear winner
		},
		{
			name:        "returns smallest group when token is empty across subgraphs",
			tokenScopes: []string{},
			combinedOrScopes: [][]string{
				{"read:fact", "read:employee", "read:private"},
				{"read:fact", "read:all"},
				{"read:all", "read:employee", "read:private"},
				{"read:all"},
			},
			want: []string{"read:all"}, // fewest missing: 1
		},

		// --- Edge cases ---
		{
			name:             "returns nil when combined scopes is nil",
			tokenScopes:      []string{"some:scope"},
			combinedOrScopes: nil,
			want:             nil,
		},
		{
			name:             "returns nil when combined scopes is empty",
			tokenScopes:      []string{"some:scope"},
			combinedOrScopes: [][]string{},
			want:             nil,
		},
		{
			name:             "returns the only group when single AND group is not satisfied",
			tokenScopes:      []string{"a"},
			combinedOrScopes: [][]string{{"a", "b", "c"}},
			want:             []string{"a", "b", "c"},
		},
		{
			name:             "returns nil when single AND group is fully satisfied",
			tokenScopes:      []string{"a", "b", "c"},
			combinedOrScopes: [][]string{{"a", "b", "c"}},
			want:             nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := bestScopeChallenge(tt.tokenScopes, tt.combinedOrScopes)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestBestScopeChallengeWithExisting(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name             string
		tokenScopes      []string
		combinedOrScopes [][]string
		includeExisting  bool
		want             []string
	}{
		{
			name:             "returns union of token scopes and best group when include existing is true",
			tokenScopes:      []string{"init", "mcp:tools:write", "a"},
			combinedOrScopes: [][]string{{"a", "b", "d"}, {"a", "c", "d"}},
			includeExisting:  true,
			want:             []string{"init", "mcp:tools:write", "a", "b", "d"},
		},
		{
			name:             "returns only the best group when include existing is false",
			tokenScopes:      []string{"init", "mcp:tools:write", "a"},
			combinedOrScopes: [][]string{{"a", "b", "d"}, {"a", "c", "d"}},
			includeExisting:  false,
			want:             []string{"a", "b", "d"},
		},
		{
			name:             "returns nil when token satisfies scopes even with include existing enabled",
			tokenScopes:      []string{"a", "b", "d"},
			combinedOrScopes: [][]string{{"a", "b", "d"}, {"a", "c", "d"}},
			includeExisting:  true,
			want:             nil,
		},
		{
			name:             "deduplicates overlapping scopes when merging token scopes with best group",
			tokenScopes:      []string{"read:employee"},
			combinedOrScopes: [][]string{{"read:employee", "read:private"}, {"read:all"}},
			includeExisting:  true,
			want:             []string{"read:employee", "read:private"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := bestScopeChallengeWithExisting(tt.tokenScopes, tt.combinedOrScopes, tt.includeExisting)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestSatisfiesAnyGroup(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		tokenScopes []string
		orScopes    [][]string
		want        bool
	}{
		{
			name:        "returns true when token satisfies first AND group",
			tokenScopes: []string{"a", "b"},
			orScopes:    [][]string{{"a", "b"}, {"c", "d"}},
			want:        true,
		},
		{
			name:        "returns true when token satisfies second AND group with extra scopes",
			tokenScopes: []string{"c", "d", "e"},
			orScopes:    [][]string{{"a", "b"}, {"c", "d"}},
			want:        true,
		},
		{
			name:        "returns false when token only partially matches each AND group",
			tokenScopes: []string{"a", "c"},
			orScopes:    [][]string{{"a", "b"}, {"c", "d"}},
			want:        false,
		},
		{
			name:        "returns true when required scopes are empty",
			tokenScopes: []string{},
			orScopes:    [][]string{},
			want:        true,
		},
		{
			name:        "returns true when required scopes are nil",
			tokenScopes: []string{},
			orScopes:    nil,
			want:        true,
		},
		{
			name:        "returns false when token is empty but scopes are required",
			tokenScopes: []string{},
			orScopes:    [][]string{{"a"}},
			want:        false,
		},
		{
			name:        "returns true when token is a superset of an AND group",
			tokenScopes: []string{"a", "b", "c", "d"},
			orScopes:    [][]string{{"a", "b"}},
			want:        true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := satisfiesAnyGroup(toSet(tt.tokenScopes), tt.orScopes)
			assert.Equal(t, tt.want, got)
		})
	}
}
