package subgraph

type articleMetaFixture struct {
	ViewCount     int
	Rating        float64
	ReviewSummary string
}

var articleMetaFixtures = map[string]articleMetaFixture{
	"a1": {
		ViewCount:     128,
		Rating:        4.8,
		ReviewSummary: "Strong overview of federation tradeoffs and rollout patterns.",
	},
	"a2": {
		ViewCount:     256,
		Rating:        4.6,
		ReviewSummary: "Practical caching patterns with clear latency examples.",
	},
	"a3": {
		ViewCount:     384,
		Rating:        4.9,
		ReviewSummary: "Concrete request-scoped guidance with useful caveats.",
	},
}
