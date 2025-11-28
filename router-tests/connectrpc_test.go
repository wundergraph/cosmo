package integration

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/connectrpc"
	"go.uber.org/zap"
)

// TestConnectRPC_ServiceDiscovery tests service discovery functionality
func TestConnectRPC_ServiceDiscovery(t *testing.T) {
	t.Parallel()

	t.Run("discovers services from proto files", func(t *testing.T) {
		// Create a mock GraphQL server
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{"employees":[{"id":1}]}}`))
		}))
		defer graphqlServer.Close()

		server, err := connectrpc.NewServer(connectrpc.ServerConfig{
			ServicesDir:     "../router/pkg/connectrpc/testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)
		defer func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			server.Stop(ctx)
		}()

		// Verify services are discovered
		serviceCount := server.GetServiceCount()
		assert.Greater(t, serviceCount, 0, "should discover at least one service")

		serviceNames := server.GetServiceNames()
		assert.NotEmpty(t, serviceNames, "should have service names")
		assert.Contains(t, serviceNames, "employee.v1.EmployeeService")

		// Log discovered services and operations (only shown in verbose mode with -v flag or on test failure)
		t.Logf("Discovered %d service(s):", serviceCount)
		for _, serviceName := range serviceNames {
			t.Logf("  - Service: %s", serviceName)
		}
		
		operationCount := server.GetOperationCount()
		t.Logf("Discovered %d operation(s)", operationCount)
	})
}

// TestConnectRPC_PredefinedMode tests predefined mode functionality
func TestConnectRPC_PredefinedMode(t *testing.T) {
	t.Parallel()

	t.Run("reloads operations on schema change", func(t *testing.T) {
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer graphqlServer.Close()

		server, err := connectrpc.NewServer(connectrpc.ServerConfig{
			ServicesDir:     "../router/pkg/connectrpc/testdata",
			GraphQLEndpoint: graphqlServer.URL,
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)
		defer func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			server.Stop(ctx)
		}()

		// Reload server
		err = server.Reload()
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
