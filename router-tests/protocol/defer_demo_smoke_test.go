package integration

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
)

func TestDeferDemoSmoke(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		RouterConfigJSONTemplate: testenv.ConfigDeferDemoJSONTemplate,
		EnableDeferDemoSubgraphs: true,
	}, func(t *testing.T, xEnv *testenv.Environment) {
		require.Len(t, xEnv.Servers, 12)

		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `query { storefront { id name price priceHistory { date value } reviews { id body stars } ratingSummary { average count } } }`,
		})

		assert.Equal(t, `{"data":{"storefront":[{"id":"1","name":"Router","price":199,"priceHistory":[{"date":"2026-01-01","value":189},{"date":"2026-06-01","value":199}],"reviews":[{"id":"1-1","body":"Great","stars":5},{"id":"1-2","body":"Solid","stars":4}],"ratingSummary":{"average":4.5,"count":2}},{"id":"2","name":"Composer","price":299,"priceHistory":[{"date":"2026-01-01","value":289},{"date":"2026-06-01","value":299}],"reviews":[{"id":"2-1","body":"Great","stars":5},{"id":"2-2","body":"Solid","stars":4}],"ratingSummary":{"average":4.5,"count":2}},{"id":"3","name":"Studio","price":499,"priceHistory":[{"date":"2026-01-01","value":489},{"date":"2026-06-01","value":499}],"reviews":[{"id":"3-1","body":"Great","stars":5},{"id":"3-2","body":"Solid","stars":4}],"ratingSummary":{"average":4.5,"count":2}}]}}`, res.Body)
		assert.Equal(t, int64(1), xEnv.SubgraphRequestCount.Catalog.Load())
		assert.Equal(t, int64(1), xEnv.SubgraphRequestCount.Pricing.Load())
		assert.Equal(t, int64(1), xEnv.SubgraphRequestCount.Reviews.Load())
	})
}
