package integration

import (
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"testing"
)

func TestBaseGraph(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id productCount } }`,
		})
		require.JSONEq(t, employeesIDData, res.Body)
	})

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query: `{ employees { id productCount } }`,
		})
		require.JSONEq(t, employeesIDData, res.Body)
	})
}

func TestProductsFeatureGraph(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Header: map[string][]string{
				"X-Feature-Flag": {"myff"},
			},
			Query: `{ employees { id productCount } }`,
		})
		require.JSONEq(t, employeesIDData, res.Body)
	})
}
