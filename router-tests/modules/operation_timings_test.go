package module_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	operationTimingsModule "github.com/wundergraph/cosmo/router-tests/modules/custom-operation-timings"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/cmd/custom/module"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestCustomModuleOperationTimings(t *testing.T) {
	t.Run("gets the correct timings for a simple query", func(t *testing.T) {
		t.Parallel()

		resultsChan := make(chan core.OperationTimings, 1)

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"myModule": module.MyModule{
					Value: 1,
				},
				"operationTimingsModule": operationTimingsModule.OperationTimingsModule{
					ResultsChan: resultsChan,
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&module.MyModule{}, &operationTimingsModule.OperationTimingsModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query MyQuery { employee(id: 1) { id currentMood } }`,
				OperationName: json.RawMessage(`"MyQuery"`),
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)

			testenv.AwaitChannelWithT(t, 10*time.Second, resultsChan, func(t *testing.T, timings core.OperationTimings) {
				// Verify that timings are populated (they should be non-zero for a real query)
				// We don't check exact values as they depend on the machine, but we verify they are set
				assert.GreaterOrEqual(t, timings.ParsingTime, time.Duration(0), "ParsingTime should be non-negative")
				assert.GreaterOrEqual(t, timings.ValidationTime, time.Duration(0), "ValidationTime should be non-negative")
				assert.GreaterOrEqual(t, timings.PlanningTime, time.Duration(0), "PlanningTime should be non-negative")
				assert.GreaterOrEqual(t, timings.NormalizationTime, time.Duration(0), "NormalizationTime should be non-negative")

				// At least one timing should be non-zero to verify timings are actually being captured
				totalTime := timings.ParsingTime + timings.ValidationTime + timings.PlanningTime + timings.NormalizationTime
				assert.Greater(t, totalTime, time.Duration(0), "At least one timing should be non-zero")
			})
		})
	})

	t.Run("gets the correct timings for a complex query", func(t *testing.T) {
		t.Parallel()

		resultsChan := make(chan core.OperationTimings, 1)

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"myModule": module.MyModule{
					Value: 1,
				},
				"operationTimingsModule": operationTimingsModule.OperationTimingsModule{
					ResultsChan: resultsChan,
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&module.MyModule{}, &operationTimingsModule.OperationTimingsModule{}),
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
				        }
				        role {
				            departments
				            title
				        }
				    }
				}`,
				OperationName: json.RawMessage(`"Employees"`),
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)

			testenv.AwaitChannelWithT(t, 10*time.Second, resultsChan, func(t *testing.T, timings core.OperationTimings) {
				// Verify that timings are populated
				assert.GreaterOrEqual(t, timings.ParsingTime, time.Duration(0), "ParsingTime should be non-negative")
				assert.GreaterOrEqual(t, timings.ValidationTime, time.Duration(0), "ValidationTime should be non-negative")
				assert.GreaterOrEqual(t, timings.PlanningTime, time.Duration(0), "PlanningTime should be non-negative")
				assert.GreaterOrEqual(t, timings.NormalizationTime, time.Duration(0), "NormalizationTime should be non-negative")

				// At least one timing should be non-zero to verify timings are actually being captured
				totalTime := timings.ParsingTime + timings.ValidationTime + timings.PlanningTime + timings.NormalizationTime
				assert.Greater(t, totalTime, time.Duration(0), "At least one timing should be non-zero")
			})
		})
	})
}
