package integration

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// makeConsultancyUpcNullable modifies the graphqlSchema and graphqlClientSchema
// to change Consultancy.upc from ID! to ID (nullable),
// creating a scalar nullability difference with Cosmo.upc which stays ID!.
func makeConsultancyUpcNullable(routerConfig *nodev1.RouterConfig) {
	old := "type Consultancy {\n  upc: ID!\n  lead: Employee!\n  isLeadAvailable: Boolean\n  name: ProductName!\n}"
	updated := "type Consultancy {\n  upc: ID\n  lead: Employee!\n  isLeadAvailable: Boolean\n  name: ProductName!\n}"

	routerConfig.EngineConfig.GraphqlSchema = strings.Replace(
		routerConfig.EngineConfig.GraphqlSchema, old, updated, 1,
	)
	if routerConfig.EngineConfig.GraphqlClientSchema != nil {
		modified := strings.Replace(
			*routerConfig.EngineConfig.GraphqlClientSchema, old, updated, 1,
		)
		routerConfig.EngineConfig.GraphqlClientSchema = &modified
	}
}

// makeConsultancyLeadNullable modifies the graphqlSchema and graphqlClientSchema
// to change Consultancy.lead from Employee! to Employee (nullable),
// creating a non-scalar nullability difference with Cosmo.lead which stays Employee!.
func makeConsultancyLeadNullable(routerConfig *nodev1.RouterConfig) {
	old := "type Consultancy {\n  upc: ID!\n  lead: Employee!\n  isLeadAvailable: Boolean\n  name: ProductName!\n}"
	updated := "type Consultancy {\n  upc: ID!\n  lead: Employee\n  isLeadAvailable: Boolean\n  name: ProductName!\n}"

	routerConfig.EngineConfig.GraphqlSchema = strings.Replace(
		routerConfig.EngineConfig.GraphqlSchema, old, updated, 1,
	)
	if routerConfig.EngineConfig.GraphqlClientSchema != nil {
		modified := strings.Replace(
			*routerConfig.EngineConfig.GraphqlClientSchema, old, updated, 1,
		)
		routerConfig.EngineConfig.GraphqlClientSchema = &modified
	}
}

func TestRelaxedFieldSelectionNullability(t *testing.T) {
	t.Parallel()

	t.Run("default rejects differing scalar nullability on union members", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				makeConsultancyUpcNullable(routerConfig)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ products { ... on Consultancy { upc } ... on Cosmo { upc } } }`,
			})
			require.Equal(t, `{"errors":[{"message":"fields 'upc' conflict because they return conflicting types 'ID' and 'ID!'","path":["query","products","Cosmo"]}]}`, res.Body)
		})
	})

	t.Run("relaxed mode allows differing scalar nullability on non-overlapping types", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.RelaxSubgraphOperationFieldSelectionMergingNullability = true
			},
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				makeConsultancyUpcNullable(routerConfig)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ products { ... on Consultancy { upc } ... on Cosmo { upc } } }`,
			})
			require.Equal(t, `{"data":{"products":[{"upc":"consultancy"},{"upc":"cosmo"},{}]}}`, res.Body)
		})
	})

	t.Run("relaxed mode allows differing non-scalar nullability on non-overlapping types", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
				cfg.RelaxSubgraphOperationFieldSelectionMergingNullability = true
			},
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				makeConsultancyLeadNullable(routerConfig)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ products { ... on Consultancy { lead { id } } ... on Cosmo { lead { id } } } }`,
			})
			require.Equal(t, `{"data":{"products":[{"lead":{"id":1}},{"lead":{"id":2}},{}]}}`, res.Body)
		})
	})

	t.Run("identical nullability works without relaxation flag", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				makeConsultancyUpcNullable(routerConfig)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ products { ... on Consultancy { name } ... on Cosmo { name } } }`,
			})
			require.Equal(t, `{"data":{"products":[{"name":"CONSULTANCY"},{"name":"COSMO"},{}]}}`, res.Body)
		})
	})

	t.Run("default rejects differing non-scalar nullability on union members", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			ModifyRouterConfig: func(routerConfig *nodev1.RouterConfig) {
				makeConsultancyLeadNullable(routerConfig)
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ products { ... on Consultancy { lead { id } } ... on Cosmo { lead { id } } } }`,
			})
			require.Equal(t, `{"errors":[{"message":"differing types 'Employee' and 'Employee!' for objectName 'lead'","path":["query","products","Cosmo"]}]}`, res.Body)
		})
	})
}
