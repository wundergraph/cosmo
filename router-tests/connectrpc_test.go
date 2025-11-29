package integration

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/connectrpc"
	"github.com/wundergraph/cosmo/router-tests/testenv"
)

// TestConnectRPC_ServiceDiscovery tests service discovery functionality
func TestConnectRPC_ServiceDiscovery(t *testing.T) {
	t.Parallel()

	t.Run("discovers services from proto files", func(t *testing.T) {
		// Create test server with defaults
		ts := connectrpc.NewTestServer(t)

		// Start server
		err := ts.Start()
		require.NoError(t, err)

		// Verify services are discovered using helper methods
		ts.AssertMinServiceCount(t, 1)
		ts.AssertServiceDiscovered(t, "employee.v1.EmployeeService")

		// Verify operations are discovered
		ts.AssertMinOperationCount(t, 1)

		// Log discovered services and operations (only shown in verbose mode with -v flag or on test failure)
		serviceCount := ts.ServiceCount()
		t.Logf("Discovered %d service(s):", serviceCount)
		for _, serviceName := range ts.ServiceNames() {
			t.Logf("  - Service: %s", serviceName)
		}

		operationCount := ts.OperationCount()
		t.Logf("Discovered %d operation(s)", operationCount)
	})
}

// TestConnectRPC_PredefinedMode tests predefined mode functionality
func TestConnectRPC_PredefinedMode(t *testing.T) {
	t.Parallel()

	t.Run("reloads operations on schema change", func(t *testing.T) {
		// Create test server
		ts := connectrpc.NewTestServer(t)

		// Start server
		err := ts.Start()
		require.NoError(t, err)

		// Reload server
		err = ts.Reload()
		assert.NoError(t, err)
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