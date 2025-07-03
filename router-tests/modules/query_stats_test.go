package module_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	queryStatsModule "github.com/wundergraph/cosmo/router-tests/modules/custom-query-stats"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/cmd/custom/module"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestCustomModuleQueryStats(t *testing.T) {
	t.Run("gets the correct stats for a simple query", func(t *testing.T) {
		t.Parallel()

		resultsChan := make(chan core.QueryPlanStats, 1)

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"myModule": module.MyModule{
					Value: 1,
				},
				"queryStatsModule": queryStatsModule.QueryStatsModule{
					ResultsChan: resultsChan,
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&module.MyModule{}, &queryStatsModule.QueryStatsModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employee(id: 1) { id currentMood hobbies { employees { currentMood } } } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)

			testenv.AwaitChannelWithT(t, 10*time.Second, resultsChan, func(t *testing.T, qps core.QueryPlanStats) {
				assert.Equal(t, 4, qps.TotalSubgraphFetches)
				assert.Equal(t, map[string]int{"employees": 1, "hobbies": 1, "mood": 2}, qps.SubgraphFetches)
			})
		})
	})

	t.Run("gets the correct stats for a very complex query", func(t *testing.T) {
		t.Parallel()

		resultsChan := make(chan core.QueryPlanStats, 1)

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"myModule": module.MyModule{
					Value: 1,
				},
				"queryStatsModule": queryStatsModule.QueryStatsModule{
					ResultsChan: resultsChan,
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&module.MyModule{}, &queryStatsModule.QueryStatsModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `
				query Employees {
				    employees {
				        id
				        tag
				        notes
				        updatedAt
				        currentMood
				        derivedMood
				        isAvailable
				        products
				        details {
				            forename
				            surname
				            middlename
				            hasChildren
				            maritalStatus
				            nationality
				            location {
				                key {
				                    name
				                }
				            }
				            pastLocations {
				                type
				                name
				                country {
				                    key {
				                        name
				                    }
				                }
				            }
				            pets {
				                class
				                gender
				                name
				            }
				        }
				        role {
				            departments
				            title
				            employees {
				                id
				                tag
				                notes
				                updatedAt
				                currentMood
				                derivedMood
				                isAvailable
				                products
				            }
				        }
				    }
				}`,
				OperationName: json.RawMessage(`"Employees"`),
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)

			testenv.AwaitChannelWithT(t, 10*time.Second, resultsChan, func(t *testing.T, qps core.QueryPlanStats) {
				assert.Equal(t, 10, qps.TotalSubgraphFetches)

				expectedSubgraphFetches := map[string]int{
					"availability": 2,
					"employees":    3,
					"family":       1,
					"mood":         2,
					"products":     2,
				}

				assert.Equal(t, expectedSubgraphFetches, qps.SubgraphFetches)
			})
		})
	})
}
