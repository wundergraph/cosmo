package integration

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

// TestConnectRPC_ServiceDiscovery tests service discovery functionality
func TestConnectRPC_ServiceDiscovery(t *testing.T) {
	t.Parallel()

	t.Run("discovers services from proto files", func(t *testing.T) {
		ts := NewTestConnectRPCServer(t, ConnectRPCServerOptions{})
		
		err := ts.Start()
		require.NoError(t, err)

		// Verify services are discovered
		serviceCount := ts.GetServiceCount()
		assert.Greater(t, serviceCount, 0, "should discover at least one service")

		serviceNames := ts.GetServiceNames()
		assert.NotEmpty(t, serviceNames, "should have service names")
		assert.Contains(t, serviceNames, "employee.v1.EmployeeService")

		// Log discovered services and operations
		t.Logf("Discovered %d service(s):", serviceCount)
		for _, serviceName := range serviceNames {
			t.Logf("  - Service: %s", serviceName)
		}
		
		operationCount := ts.GetOperationCount()
		t.Logf("Discovered %d operation(s)", operationCount)
	})
}

// TestConnectRPC_Integration tests integration with router testenv
func TestConnectRPC_Integration(t *testing.T) {
	t.Parallel()

	t.Run("integrates with router testenv", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{}, func(t *testing.T, xEnv *testenv.Environment) {
			// Verify router is running
			assert.NotNil(t, xEnv.Router)
			assert.NotEmpty(t, xEnv.RouterURL)

			// Make a GraphQL request to verify router works
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `{ __typename }`,
			})
			assert.Contains(t, res.Body, "__typename")
		})
	})
}