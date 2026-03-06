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
			name:             "simple OR: token satisfies first group",
			tokenScopes:      []string{"read:fact"},
			combinedOrScopes: [][]string{{"read:fact"}, {"read:all"}},
			want:             nil,
		},
		{
			name:             "simple OR: token satisfies second group",
			tokenScopes:      []string{"read:all"},
			combinedOrScopes: [][]string{{"read:fact"}, {"read:all"}},
			want:             nil,
		},
		{
			name:             "simple OR: empty token picks first group on tie",
			tokenScopes:      []string{},
			combinedOrScopes: [][]string{{"read:fact"}, {"read:all"}},
			want:             []string{"read:fact"},
		},
		{
			name:             "simple OR: unrelated token picks first group on tie",
			tokenScopes:      []string{"read:other"},
			combinedOrScopes: [][]string{{"read:fact"}, {"read:all"}},
			want:             []string{"read:fact"},
		},

		// --- Mutation with simple OR scopes ---
		// e.g. Mutation.addFact → [["write:fact"], ["write:all"]]
		{
			name:             "mutation OR: token has write:fact passes",
			tokenScopes:      []string{"write:fact"},
			combinedOrScopes: [][]string{{"write:fact"}, {"write:all"}},
			want:             nil,
		},
		{
			name:             "mutation OR: token has write:all passes",
			tokenScopes:      []string{"write:all"},
			combinedOrScopes: [][]string{{"write:fact"}, {"write:all"}},
			want:             nil,
		},
		{
			name:             "mutation OR: wrong category scope picks first group",
			tokenScopes:      []string{"read:fact"},
			combinedOrScopes: [][]string{{"write:fact"}, {"write:all"}},
			want:             []string{"write:fact"},
		},
		{
			name:             "mutation OR: empty token picks first group",
			tokenScopes:      []string{},
			combinedOrScopes: [][]string{{"write:fact"}, {"write:all"}},
			want:             []string{"write:fact"},
		},

		// --- AND scopes with OR alternative ---
		// e.g. Employee.startDate → [["read:employee", "read:private"], ["read:all"]]
		{
			name:             "AND group: token satisfies full AND group",
			tokenScopes:      []string{"read:employee", "read:private"},
			combinedOrScopes: [][]string{{"read:employee", "read:private"}, {"read:all"}},
			want:             nil,
		},
		{
			name:             "AND group: token satisfies shortcut group",
			tokenScopes:      []string{"read:all"},
			combinedOrScopes: [][]string{{"read:employee", "read:private"}, {"read:all"}},
			want:             nil,
		},
		{
			name:             "AND group: partial match picks first group on tie (1 missing each)",
			tokenScopes:      []string{"read:employee"},
			combinedOrScopes: [][]string{{"read:employee", "read:private"}, {"read:all"}},
			want:             []string{"read:employee", "read:private"},
		},
		{
			name:             "AND group: other partial match also picks first on tie",
			tokenScopes:      []string{"read:private"},
			combinedOrScopes: [][]string{{"read:employee", "read:private"}, {"read:all"}},
			want:             []string{"read:employee", "read:private"},
		},
		{
			name:             "AND group: empty token picks shorter group (read:all needs 1 vs 2)",
			tokenScopes:      []string{},
			combinedOrScopes: [][]string{{"read:employee", "read:private"}, {"read:all"}},
			want:             []string{"read:all"},
		},

		// --- Cross-product: multiple scoped fields ---
		// 3 scoped fields with cross-product yielding 6 groups (see plan Operation 5)
		{
			name:        "cross-product: token has read:all picks simplest group",
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
			name:        "cross-product: partial match narrows to best group",
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
			name:        "cross-product: empty token picks group with fewest total scopes",
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
			name:        "cross-subgraph: token has read:all passes single-scope group",
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
			name:        "cross-subgraph: partial match picks closest group",
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
			name:        "cross-subgraph: unrelated partial match picks smallest group",
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
			name:        "cross-subgraph: empty token picks smallest group",
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
			name:             "nil combined scopes returns nil",
			tokenScopes:      []string{"some:scope"},
			combinedOrScopes: nil,
			want:             nil,
		},
		{
			name:             "empty combined scopes returns nil",
			tokenScopes:      []string{"some:scope"},
			combinedOrScopes: [][]string{},
			want:             nil,
		},
		{
			name:             "single AND-group not satisfied returns that group",
			tokenScopes:      []string{"a"},
			combinedOrScopes: [][]string{{"a", "b", "c"}},
			want:             []string{"a", "b", "c"},
		},
		{
			name:             "single AND-group fully satisfied returns nil",
			tokenScopes:      []string{"a", "b", "c"},
			combinedOrScopes: [][]string{{"a", "b", "c"}},
			want:             nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := BestScopeChallenge(tt.tokenScopes, tt.combinedOrScopes)
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
			name:             "include existing: unions token scopes with best group",
			tokenScopes:      []string{"init", "mcp:tools:write", "a"},
			combinedOrScopes: [][]string{{"a", "b", "d"}, {"a", "c", "d"}},
			includeExisting:  true,
			want:             []string{"init", "mcp:tools:write", "a", "b", "d"},
		},
		{
			name:             "exclude existing: returns only best group",
			tokenScopes:      []string{"init", "mcp:tools:write", "a"},
			combinedOrScopes: [][]string{{"a", "b", "d"}, {"a", "c", "d"}},
			includeExisting:  false,
			want:             []string{"a", "b", "d"},
		},
		{
			name:             "include existing: passes returns nil",
			tokenScopes:      []string{"a", "b", "d"},
			combinedOrScopes: [][]string{{"a", "b", "d"}, {"a", "c", "d"}},
			includeExisting:  true,
			want:             nil,
		},
		{
			name:             "include existing: deduplicates overlapping scopes",
			tokenScopes:      []string{"read:employee"},
			combinedOrScopes: [][]string{{"read:employee", "read:private"}, {"read:all"}},
			includeExisting:  true,
			want:             []string{"read:employee", "read:private"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := BestScopeChallengeWithExisting(tt.tokenScopes, tt.combinedOrScopes, tt.includeExisting)
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
			name:        "satisfies first AND-group",
			tokenScopes: []string{"a", "b"},
			orScopes:    [][]string{{"a", "b"}, {"c", "d"}},
			want:        true,
		},
		{
			name:        "satisfies second AND-group with extra scopes",
			tokenScopes: []string{"c", "d", "e"},
			orScopes:    [][]string{{"a", "b"}, {"c", "d"}},
			want:        true,
		},
		{
			name:        "partial match on each group fails",
			tokenScopes: []string{"a", "c"},
			orScopes:    [][]string{{"a", "b"}, {"c", "d"}},
			want:        false,
		},
		{
			name:        "empty requirements always passes",
			tokenScopes: []string{},
			orScopes:    [][]string{},
			want:        true,
		},
		{
			name:        "nil requirements always passes",
			tokenScopes: []string{},
			orScopes:    nil,
			want:        true,
		},
		{
			name:        "empty token with requirements fails",
			tokenScopes: []string{},
			orScopes:    [][]string{{"a"}},
			want:        false,
		},
		{
			name:        "token superset of AND-group passes",
			tokenScopes: []string{"a", "b", "c", "d"},
			orScopes:    [][]string{{"a", "b"}},
			want:        true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := SatisfiesAnyGroup(tt.tokenScopes, tt.orScopes)
			assert.Equal(t, tt.want, got)
		})
	}
}