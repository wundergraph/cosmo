package module_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	verifyModule "github.com/wundergraph/cosmo/router-tests/modules/verify-cost-analysis"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestCostModuleExposition(t *testing.T) {
	t.Parallel()

	t.Run("module can access cost when cost control is enabled", func(t *testing.T) {
		t.Parallel()

		resultsChan := make(chan verifyModule.CapturedCost, 1)

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"verifyCost": verifyModule.VerifyCostModule{
					ResultsChan: resultsChan,
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&verifyModule.VerifyCostModule{}),
			},
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.CostControl = &config.CostControl{
					Enabled:           true,
					Mode:              config.CostControlModeMeasure,
					EstimatedListSize: 10,
				}
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query GetEmployee { employee(id: 1) { id } }`,
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)

			testenv.AwaitChannelWithT(t, 10*time.Second, resultsChan, func(t *testing.T, captured verifyModule.CapturedCost) {
				assert.NoError(t, captured.Error, "Cost() should not return an error when cost control is enabled")
				assert.Greater(t, captured.Cost.Estimated, 0, "Estimated cost should be greater than 0 for a query with object fields")

				// Log the cost for demonstration purposes
				t.Logf("Query estimated cost: %d (could be used for rate limiting)", captured.Cost.Estimated)
				// In a real module, you could use this cost for:
				// - Rate limiting (deduct from user's cost budget)
				// - Logging/metrics
				// - Custom rejection logic
				// - Billing/monetization

			})
		})
	})

	t.Run("module receives error when cost control is disabled", func(t *testing.T) {
		t.Parallel()

		resultsChan := make(chan verifyModule.CapturedCost, 1)

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"verifyCost": verifyModule.VerifyCostModule{
					ResultsChan: resultsChan,
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&verifyModule.VerifyCostModule{}),
			},
			ModifySecurityConfiguration: func(securityConfiguration *config.SecurityConfiguration) {
				securityConfiguration.CostControl = nil
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query GetEmployee { employee(id: 1) { id } }`,
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)

			testenv.AwaitChannelWithT(t, 10*time.Second, resultsChan, func(t *testing.T, captured verifyModule.CapturedCost) {
				assert.Error(t, captured.Error, "Cost() should return an error when cost control is disabled")
				assert.Equal(t, 0, captured.Cost.Estimated, "Estimated cost should be 0 when cost control is disabled")
			})
		})
	})
}
