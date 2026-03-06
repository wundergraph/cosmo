package mcpserver

import "slices"

// SatisfiesAnyGroup checks whether tokenScopes satisfies at least one AND-group
// in the OR-of-AND scope requirements. Returns true if no requirements exist.
func SatisfiesAnyGroup(tokenScopes []string, orScopes [][]string) bool {
	if len(orScopes) == 0 {
		return true
	}
	for _, andGroup := range orScopes {
		if satisfiesAll(tokenScopes, andGroup) {
			return true
		}
	}
	return false
}

// BestScopeChallenge picks the AND-group closest to the client's current scopes.
// Returns the complete AND-group that the client should request, or nil if any
// group is already satisfied.
//
// Algorithm:
//  1. For each AND-group, count how many scopes the token is missing.
//  2. If any group has 0 missing, return nil (already satisfied).
//  3. Pick the group with the fewest missing scopes.
//  4. On ties, pick the first group (stable ordering).
func BestScopeChallenge(tokenScopes []string, combinedOrScopes [][]string) []string {
	if len(combinedOrScopes) == 0 {
		return nil
	}

	tokenSet := toSet(tokenScopes)

	bestIdx := -1
	bestMissing := -1

	for i, andGroup := range combinedOrScopes {
		missing := 0
		for _, scope := range andGroup {
			if _, ok := tokenSet[scope]; !ok {
				missing++
			}
		}
		if missing == 0 {
			return nil
		}
		if bestIdx == -1 || missing < bestMissing {
			bestIdx = i
			bestMissing = missing
		}
	}

	return combinedOrScopes[bestIdx]
}

// BestScopeChallengeWithExisting returns the challenge scopes, optionally including
// the token's existing scopes. When includeExisting is true, the result is the union
// of the token's current scopes and the best AND-group, deduplicated. This works
// around MCP client SDKs that replace rather than accumulate scopes on re-authorization.
func BestScopeChallengeWithExisting(tokenScopes []string, combinedOrScopes [][]string, includeExisting bool) []string {
	best := BestScopeChallenge(tokenScopes, combinedOrScopes)
	if best == nil {
		return nil
	}

	if !includeExisting {
		return best
	}

	// Union: token scopes first, then any scopes from the best group not already present
	seen := make(map[string]struct{}, len(tokenScopes)+len(best))
	result := make([]string, 0, len(tokenScopes)+len(best))

	for _, s := range tokenScopes {
		if _, ok := seen[s]; !ok {
			seen[s] = struct{}{}
			result = append(result, s)
		}
	}
	for _, s := range best {
		if _, ok := seen[s]; !ok {
			seen[s] = struct{}{}
			result = append(result, s)
		}
	}

	return result
}

// satisfiesAll returns true if tokenScopes contains every scope in required.
func satisfiesAll(tokenScopes []string, required []string) bool {
	for _, r := range required {
		if !slices.Contains(tokenScopes, r) {
			return false
		}
	}
	return true
}

// toSet converts a string slice to a set for O(1) lookups.
func toSet(ss []string) map[string]struct{} {
	m := make(map[string]struct{}, len(ss))
	for _, s := range ss {
		m[s] = struct{}{}
	}
	return m
}
