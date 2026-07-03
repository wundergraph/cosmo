package subgraph

// userProfileIDByAuthorizationToken maps the demo Authorization bearer tokens to
// user ids. Used by the UserProfile resolver to vary its response per caller so
// that @openfed__queryCache(includeHeaders: true) has a detectable signal.
// Kept in a separate file so gqlgen's regen of schema.resolvers.go does not
// touch it.
var userProfileIDByAuthorizationToken = map[string]string{
	"Bearer token-alice":   "u1",
	"Bearer token-bob":     "u2",
	"Bearer token-charlie": "u3",
}
