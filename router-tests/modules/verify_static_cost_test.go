package module_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	verifyModule "github.com/wundergraph/cosmo/router-tests/modules/verify-static-cost"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestStaticCostModuleExposition(t *testing.T) {
	t.Parallel()

	t.Run("module can access static cost when cost analysis is enabled", func(t *testing.T) {
		t.Parallel()

		resultsChan := make(chan verifyModule.CapturedStaticCost, 1)

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"verifyStaticCost": verifyModule.VerifyStaticCostModule{
					ResultsChan: resultsChan,
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&verifyModule.VerifyStaticCostModule{}),
			},
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.CostAnalysis = &config.CostAnalysis{
					Enabled:     true,
					StaticLimit: 100,
					ListSize:    10,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query GetEmployee { employee(id: 1) { id } }`,
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)

			testenv.AwaitChannelWithT(t, 10*time.Second, resultsChan, func(t *testing.T, captured verifyModule.CapturedStaticCost) {
				assert.NoError(t, captured.Error, "StaticCost() should not return an error when cost analysis is enabled")
				assert.Greater(t, captured.Cost, 0, "Static cost should be greater than 0 for a query with object fields")

				// Log the cost for demonstration purposes
				t.Logf("Query static cost: %d (could be used for rate limiting)", captured.Cost)
				// In a real module, you could use this cost for:
				// - Rate limiting (deduct from user's cost budget)
				// - Logging/metrics
				// - Custom rejection logic
				// - Billing/monetization

			})
		})
	})

	t.Run("module receives error when cost analysis is disabled", func(t *testing.T) {
		t.Parallel()

		resultsChan := make(chan verifyModule.CapturedStaticCost, 1)

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"verifyStaticCost": verifyModule.VerifyStaticCostModule{
					ResultsChan: resultsChan,
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&verifyModule.VerifyStaticCostModule{}),
			},
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.CostAnalysis = nil
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query GetEmployee { employee(id: 1) { id } }`,
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)

			testenv.AwaitChannelWithT(t, 10*time.Second, resultsChan, func(t *testing.T, captured verifyModule.CapturedStaticCost) {
				assert.Error(t, captured.Error, "StaticCost() should return an error when cost analysis is disabled")
				assert.Equal(t, 0, captured.Cost, "Cost should be 0 when cost analysis is disabled")
			})
		})
	})
}
