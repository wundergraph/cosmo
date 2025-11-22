package connectrpc

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/schemaloader"
	"go.uber.org/zap"
)

func TestNewVanguardService(t *testing.T) {
	t.Run("creates service successfully", func(t *testing.T) {
		protoLoader := setupTestProtoLoaderFromDir(t, "testdata/employee_only")
		handler := setupTestRPCHandler(t, protoLoader)

		vs, err := NewVanguardService(VanguardServiceConfig{
			Handler:     handler,
			ProtoLoader: protoLoader,
			Logger:      zap.NewNop(),
		})

		require.NoError(t, err)
		assert.NotNil(t, vs)
		assert.Equal(t, 1, vs.GetServiceCount(), "Should have exactly 1 service from employee_only directory")
	})

	t.Run("fails with nil handler", func(t *testing.T) {
		protoLoader := setupTestProtoLoaderFromDir(t, "testdata/employee_only")

		_, err := NewVanguardService(VanguardServiceConfig{
			Handler:     nil,
			ProtoLoader: protoLoader,
			Logger:      zap.NewNop(),
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "handler cannot be nil")
	})

	t.Run("fails with nil proto loader", func(t *testing.T) {
		handler := &RPCHandler{}

		_, err := NewVanguardService(VanguardServiceConfig{
			Handler:     handler,
			ProtoLoader: nil,
			Logger:      zap.NewNop(),
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "proto loader cannot be nil")
	})

	t.Run("uses nop logger when nil", func(t *testing.T) {
		protoLoader := setupTestProtoLoaderFromDir(t, "testdata/employee_only")
		handler := setupTestRPCHandler(t, protoLoader)

		vs, err := NewVanguardService(VanguardServiceConfig{
			Handler:     handler,
			ProtoLoader: protoLoader,
			Logger:      nil,
		})

		require.NoError(t, err)
		assert.NotNil(t, vs)
		assert.NotNil(t, vs.logger)
	})

	t.Run("fails with no proto services", func(t *testing.T) {
		// Create empty proto loader
		protoLoader := NewProtoLoader(zap.NewNop())

		handler := &RPCHandler{}

		_, err := NewVanguardService(VanguardServiceConfig{
			Handler:     handler,
			ProtoLoader: protoLoader,
			Logger:      zap.NewNop(),
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "no proto services found")
	})
}

func TestVanguardService_GetServices(t *testing.T) {
	protoLoader := setupTestProtoLoaderFromDir(t, "testdata/employee_only")
	handler := setupTestRPCHandler(t, protoLoader)

	vs, err := NewVanguardService(VanguardServiceConfig{
		Handler:     handler,
		ProtoLoader: protoLoader,
		Logger:      zap.NewNop(),
	})
	require.NoError(t, err)

	services := vs.GetServices()
	assert.Len(t, services, 1, "Should have exactly 1 service from employee_only directory")
	assert.NotNil(t, services[0])
}

func TestVanguardService_GetServiceNames(t *testing.T) {
	protoLoader := setupTestProtoLoaderFromDir(t, "testdata/employee_only")
	handler := setupTestRPCHandler(t, protoLoader)

	vs, err := NewVanguardService(VanguardServiceConfig{
		Handler:     handler,
		ProtoLoader: protoLoader,
		Logger:      zap.NewNop(),
	})
	require.NoError(t, err)

	names := vs.GetServiceNames()
	assert.Len(t, names, 1, "Should have exactly 1 service from employee_only directory")
	assert.Contains(t, names, "employee.v1.EmployeeService")
}

func TestVanguardService_ValidateService(t *testing.T) {
	protoLoader := setupTestProtoLoaderFromDir(t, "testdata/employee_only")
	handler := setupTestRPCHandler(t, protoLoader)

	vs, err := NewVanguardService(VanguardServiceConfig{
		Handler:     handler,
		ProtoLoader: protoLoader,
		Logger:      zap.NewNop(),
	})
	require.NoError(t, err)

	t.Run("validates existing service", func(t *testing.T) {
		err := vs.ValidateService("employee.v1.EmployeeService")
		assert.NoError(t, err)
	})

	t.Run("fails for non-existent service", func(t *testing.T) {
		err := vs.ValidateService("example.NonExistent")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "service not found")
	})
}

func TestVanguardService_ValidateMethod(t *testing.T) {
	protoLoader := setupTestProtoLoaderFromDir(t, "testdata/employee_only")
	handler := setupTestRPCHandler(t, protoLoader)

	vs, err := NewVanguardService(VanguardServiceConfig{
		Handler:     handler,
		ProtoLoader: protoLoader,
		Logger:      zap.NewNop(),
	})
	require.NoError(t, err)

	t.Run("validates existing method", func(t *testing.T) {
		err := vs.ValidateMethod("employee.v1.EmployeeService", "QueryGetEmployeeById")
		assert.NoError(t, err)
	})

	t.Run("fails for non-existent method", func(t *testing.T) {
		err := vs.ValidateMethod("employee.v1.EmployeeService", "NonExistent")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "method not found")
	})

	t.Run("fails for non-existent service", func(t *testing.T) {
		err := vs.ValidateMethod("example.NonExistent", "QueryGetUser")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "method not found")
	})
}

func TestVanguardService_GetMethodInfo(t *testing.T) {
	protoLoader := setupTestProtoLoaderFromDir(t, "testdata/employee_only")
	handler := setupTestRPCHandler(t, protoLoader)

	vs, err := NewVanguardService(VanguardServiceConfig{
		Handler:     handler,
		ProtoLoader: protoLoader,
		Logger:      zap.NewNop(),
	})
	require.NoError(t, err)

	t.Run("gets method info successfully", func(t *testing.T) {
		info, err := vs.GetMethodInfo("employee.v1.EmployeeService", "QueryGetEmployeeById")
		require.NoError(t, err)
		assert.NotNil(t, info)
		assert.Equal(t, "QueryGetEmployeeById", info.Name)
	})

	t.Run("fails for non-existent method", func(t *testing.T) {
		_, err := vs.GetMethodInfo("employee.v1.EmployeeService", "NonExistent")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "method not found")
	})
}

func TestVanguardService_GetServiceInfo(t *testing.T) {
	protoLoader := setupTestProtoLoaderFromDir(t, "testdata/employee_only")
	handler := setupTestRPCHandler(t, protoLoader)

	vs, err := NewVanguardService(VanguardServiceConfig{
		Handler:     handler,
		ProtoLoader: protoLoader,
		Logger:      zap.NewNop(),
	})
	require.NoError(t, err)

	t.Run("gets service info successfully", func(t *testing.T) {
		info, err := vs.GetServiceInfo("employee.v1.EmployeeService")
		require.NoError(t, err)
		assert.NotNil(t, info)
		assert.Equal(t, "employee.v1.EmployeeService", info.FullName)
		assert.Equal(t, "EmployeeService", info.ServiceName)
		assert.Contains(t, info.Methods, "QueryGetEmployeeById")
	})

	t.Run("fails for non-existent service", func(t *testing.T) {
		_, err := vs.GetServiceInfo("example.NonExistent")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "service not found")
	})
}

func TestVanguardService_ServiceHandler(t *testing.T) {
	protoLoader := setupTestProtoLoaderFromDir(t, "testdata/employee_only")
	handler := setupTestRPCHandler(t, protoLoader)

	vs, err := NewVanguardService(VanguardServiceConfig{
		Handler:     handler,
		ProtoLoader: protoLoader,
		Logger:      zap.NewNop(),
	})
	require.NoError(t, err)

	t.Run("handles valid request", func(t *testing.T) {
		// Create a mock GraphQL server
		graphqlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{"employee":{"id":1,"name":"Test Employee"}}}`))
		}))
		defer graphqlServer.Close()

		// Create handler with mock server
		protoLoader := setupTestProtoLoaderFromDir(t, "testdata/employee_only")
		opRegistry := NewOperationRegistry(zap.NewNop())
		
		// Manually add a test operation to the registry
		opRegistry.AddOperation(&schemaloader.Operation{
			Name:            "QueryGetEmployeeById",
			OperationType:   "query",
			OperationString: "query QueryGetEmployeeById($id: Int!) { employee(id: $id) { id name } }",
		})
		
		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   graphqlServer.URL,
			HTTPClient:        &http.Client{},
			Logger:            zap.NewNop(),
			OperationRegistry: opRegistry,
		})
		require.NoError(t, err)

		// Get service definition
		services := protoLoader.GetServices()
		require.NotEmpty(t, services, "Should have at least one service")
		var serviceDef *ServiceDefinition
		for _, svc := range services {
			serviceDef = svc
			break
		}
		require.NotNil(t, serviceDef)

		vs, err := NewVanguardService(VanguardServiceConfig{
			Handler:     handler,
			ProtoLoader: protoLoader,
			Logger:      zap.NewNop(),
		})
		require.NoError(t, err)

		// Create a test request
		requestBody := map[string]interface{}{
			"id": 1,
		}
		requestJSON, err := json.Marshal(requestBody)
		require.NoError(t, err)

		req := httptest.NewRequest("POST", "/employee.v1.EmployeeService/QueryGetEmployeeById", bytes.NewReader(requestJSON))
		req.Header.Set("Content-Type", "application/json")

		// Create a response recorder
		w := httptest.NewRecorder()

		// Get the service handler
		serviceHandler := vs.createServiceHandler("employee.v1.EmployeeService", serviceDef)

		// Handle the request
		serviceHandler.ServeHTTP(w, req)

		// Check response
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "application/json", w.Header().Get("Content-Type"))

		// Verify response body is valid JSON
		var response map[string]interface{}
		err = json.Unmarshal(w.Body.Bytes(), &response)
		assert.NoError(t, err)
	})

	t.Run("handles invalid method path", func(t *testing.T) {
		services := protoLoader.GetServices()
		require.NotEmpty(t, services)
		var serviceDef *ServiceDefinition
		for _, svc := range services {
			serviceDef = svc
			break
		}
		require.NotNil(t, serviceDef)

		req := httptest.NewRequest("POST", "/invalid/path", nil)
		w := httptest.NewRecorder()

		serviceHandler := vs.createServiceHandler("employee.v1.EmployeeService", serviceDef)
		serviceHandler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
	})

	t.Run("handles wrong service name in path", func(t *testing.T) {
		services := protoLoader.GetServices()
		require.NotEmpty(t, services)
		var serviceDef *ServiceDefinition
		for _, svc := range services {
			serviceDef = svc
			break
		}
		require.NotNil(t, serviceDef)

		req := httptest.NewRequest("POST", "/wrong.Service/QueryGetUser", nil)
		w := httptest.NewRecorder()

		serviceHandler := vs.createServiceHandler("employee.v1.EmployeeService", serviceDef)
		serviceHandler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
	})

	t.Run("handles request body read error", func(t *testing.T) {
		services := protoLoader.GetServices()
		require.NotEmpty(t, services)
		var serviceDef *ServiceDefinition
		for _, svc := range services {
			serviceDef = svc
			break
		}
		require.NotNil(t, serviceDef)

		// Create a request with a body that will error on read
		req := httptest.NewRequest("POST", "/employee.v1.EmployeeService/QueryGetEmployeeById", &errorReader{})
		w := httptest.NewRecorder()

		serviceHandler := vs.createServiceHandler("employee.v1.EmployeeService", serviceDef)
		serviceHandler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}

func TestVanguardService_ExtractMethodName(t *testing.T) {
	protoLoader := setupTestProtoLoaderFromDir(t, "testdata/employee_only")
	handler := setupTestRPCHandler(t, protoLoader)

	vs, err := NewVanguardService(VanguardServiceConfig{
		Handler:     handler,
		ProtoLoader: protoLoader,
		Logger:      zap.NewNop(),
	})
	require.NoError(t, err)

	tests := []struct {
		name        string
		path        string
		serviceName string
		want        string
	}{
		{
			name:        "valid path with leading slash",
			path:        "/employee.v1.EmployeeService/QueryGetEmployeeById",
			serviceName: "employee.v1.EmployeeService",
			want:        "QueryGetEmployeeById",
		},
		{
			name:        "valid path without leading slash",
			path:        "employee.v1.EmployeeService/QueryGetEmployeeById",
			serviceName: "employee.v1.EmployeeService",
			want:        "QueryGetEmployeeById",
		},
		{
			name:        "invalid path - no method",
			path:        "/employee.v1.EmployeeService",
			serviceName: "employee.v1.EmployeeService",
			want:        "",
		},
		{
			name:        "invalid path - wrong service",
			path:        "/wrong.Service/QueryGetUser",
			serviceName: "employee.v1.EmployeeService",
			want:        "",
		},
		{
			name:        "invalid path - too many parts",
			path:        "/employee.v1.EmployeeService/QueryGetEmployeeById/extra",
			serviceName: "employee.v1.EmployeeService",
			want:        "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := vs.extractMethodName(tt.path, tt.serviceName)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestVanguardService_GetFileDescriptors(t *testing.T) {
	protoLoader := setupTestProtoLoaderFromDir(t, "testdata/employee_only")
	handler := setupTestRPCHandler(t, protoLoader)

	vs, err := NewVanguardService(VanguardServiceConfig{
		Handler:     handler,
		ProtoLoader: protoLoader,
		Logger:      zap.NewNop(),
	})
	require.NoError(t, err)

	descriptors := vs.GetFileDescriptors()
	assert.NotEmpty(t, descriptors)
}

// Helper functions

func setupTestProtoLoaderFromDir(t *testing.T, dir string) *ProtoLoader {
	t.Helper()

	loader := NewProtoLoader(zap.NewNop())
	err := loader.LoadFromDirectory(dir)
	require.NoError(t, err)

	return loader
}

func setupTestRPCHandler(t *testing.T, protoLoader *ProtoLoader) *RPCHandler {
	t.Helper()

	// Create operation registry
	opRegistry := NewOperationRegistry(zap.NewNop())
	
	// Manually add test operations to the registry
	// In a real scenario, these would be loaded from .graphql files
	opRegistry.AddOperation(&schemaloader.Operation{
		Name:            "QueryGetEmployeeById",
		OperationType:   "query",
		OperationString: "query QueryGetEmployeeById($id: Int!) { employee(id: $id) { id name } }",
	})

	// Create a mock HTTP client
	httpClient := &http.Client{}

	handler, err := NewRPCHandler(HandlerConfig{
		GraphQLEndpoint:   "http://localhost:4000/graphql",
		HTTPClient:        httpClient,
		Logger:            zap.NewNop(),
		OperationRegistry: opRegistry,
	})
	require.NoError(t, err)

	return handler
}

// errorReader is a reader that always returns an error
type errorReader struct{}

func (e *errorReader) Read(p []byte) (n int, err error) {
	return 0, io.ErrUnexpectedEOF
}