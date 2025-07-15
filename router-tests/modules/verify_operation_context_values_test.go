package module_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	verifyModule "github.com/wundergraph/cosmo/router-tests/modules/verify-operation-context-values"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap/zapcore"
)

func TestVerifyOperationContextValues(t *testing.T) {
	t.Run("verifies all operation context values are set correctly", func(t *testing.T) {
		t.Parallel()

		resultsChan := make(chan verifyModule.CapturedOperationValues, 1)

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"verifyOperationContextValues": verifyModule.VerifyOperationContextValuesModule{
					ResultsChan: resultsChan,
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&verifyModule.VerifyOperationContextValuesModule{}),
			},
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Send a GraphQL query with variables that are actually used
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `query GetEmployee($empId: Int!) { 
					employee(id: $empId) { 
						id 
						details {
							forename
							surname
						}
						tag
					} 
				}`,
				Variables:     json.RawMessage(`{"empId": 1}`),
				OperationName: json.RawMessage(`"GetEmployee"`),
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)

			// Wait for the module to capture the operation context values
			testenv.AwaitChannelWithT(t, 10*time.Second, resultsChan, func(t *testing.T, captured verifyModule.CapturedOperationValues) {
				// Verify operation name
				assert.Equal(t, "GetEmployee", captured.Name, "Operation name should be set correctly")

				// Verify operation type
				assert.Equal(t, "query", captured.Type, "Operation type should be 'query'")

				// Verify operation hash is set (non-zero)
				assert.NotZero(t, captured.Hash, "Operation hash should be set")

				// Verify operation content is set and contains the normalized query
				assert.Equal(t, captured.Content, "query GetEmployee($a: Int!){employee(id: $a){id details {forename surname} tag}}", "Operation content should be set")

				// Verify Variables() method returns the correct variables
				assert.NotNil(t, captured.Variables, "Variables should not be nil")

				// Verify the variables JSON contains the expected values
				assert.JSONEq(t, `{"empId": 1}`, captured.VariablesJSON, "Variables JSON should match the sent variables")

				// Verify we can access individual variables
				empIdVar := captured.Variables.Get("empId")
				assert.NotNil(t, empIdVar, "Should be able to access 'empId' variable")
				assert.Equal(t, 1, empIdVar.GetInt(), "empId variable should be 1")

				// Verify client info is populated (at least the basic structure)
				assert.NotNil(t, captured.ClientInfo, "Client info should be set")
			})
		})
	})

	t.Run("verifies context values with empty variables", func(t *testing.T) {
		t.Parallel()

		resultsChan := make(chan verifyModule.CapturedOperationValues, 1)

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"verifyOperationContextValues": verifyModule.VerifyOperationContextValuesModule{
					ResultsChan: resultsChan,
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&verifyModule.VerifyOperationContextValuesModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Send a simple query without variables
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:         `query SimpleQuery { employees { id } }`,
				OperationName: json.RawMessage(`"SimpleQuery"`),
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)

			// Wait for the module to capture the operation context values
			testenv.AwaitChannelWithT(t, 10*time.Second, resultsChan, func(t *testing.T, captured verifyModule.CapturedOperationValues) {
				// Verify operation name
				assert.Equal(t, "SimpleQuery", captured.Name, "Operation name should be set correctly")

				// Verify operation type
				assert.Equal(t, "query", captured.Type, "Operation type should be 'query'")

				// Verify Variables() method works with empty variables
				assert.NotNil(t, captured.Variables, "Variables should not be nil even when empty")

				// Verify the variables JSON is an empty object
				assert.JSONEq(t, `{}`, captured.VariablesJSON, "Variables JSON should be empty object when no variables provided")
			})
		})
	})

	t.Run("verifies context values with mutation", func(t *testing.T) {
		t.Parallel()

		resultsChan := make(chan verifyModule.CapturedOperationValues, 1)

		cfg := config.Config{
			Graph: config.Graph{},
			Modules: map[string]any{
				"verifyOperationContextValues": verifyModule.VerifyOperationContextValuesModule{
					ResultsChan: resultsChan,
				},
			},
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithModulesConfig(cfg.Modules),
				core.WithCustomModules(&verifyModule.VerifyOperationContextValuesModule{}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// Send a mutation with variables
			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query: `mutation UpdateEmployee($empId: Int!, $newTag: String!) { 
					updateEmployeeTag(id: $empId, tag: $newTag) { 
						id 
						tag 
					} 
				}`,
				Variables:     json.RawMessage(`{"empId": 1, "newTag": "Updated by test"}`),
				OperationName: json.RawMessage(`"UpdateEmployee"`),
			})
			require.NoError(t, err)
			assert.Equal(t, 200, res.Response.StatusCode)

			// Wait for the module to capture the operation context values
			testenv.AwaitChannelWithT(t, 10*time.Second, resultsChan, func(t *testing.T, captured verifyModule.CapturedOperationValues) {
				// Verify operation name
				assert.Equal(t, "UpdateEmployee", captured.Name, "Operation name should be set correctly")

				// Verify operation type is mutation
				assert.Equal(t, "mutation", captured.Type, "Operation type should be 'mutation'")

				// Verify Variables() method returns the correct mutation variables
				assert.NotNil(t, captured.Variables, "Variables should not be nil")

				// Verify the variables contain the mutation input
				empIdVar := captured.Variables.Get("empId")
				assert.NotNil(t, empIdVar, "Should be able to access 'empId' variable")
				assert.Equal(t, 1, empIdVar.GetInt(), "empId variable should be 1")

				newTagVar := captured.Variables.Get("newTag")
				assert.NotNil(t, newTagVar, "Should be able to access 'newTag' variable")

				// Verify string variable
				newTagBytes := newTagVar.GetStringBytes()
				assert.Equal(t, "Updated by test", string(newTagBytes), "newTag should be 'Updated by test'")
			})
		})
	})
}
