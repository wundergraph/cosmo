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
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/schemaloader"
)

func TestNewVanguardService(t *testing.T) {
	t.Run("creates service successfully", func(t *testing.T) {
		protoLoader := GetSharedProtoLoader(t, "testdata/services/employee.v1")
		handler := NewTestRPCHandler(t, protoLoader)

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
		protoLoader := GetSharedProtoLoader(t, "testdata/services/employee.v1")

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
		protoLoader := GetSharedProtoLoader(t, "testdata/services/employee.v1")
		handler := NewTestRPCHandler(t, protoLoader)

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

func TestVanguardService_ValidateService(t *testing.T) {
	protoLoader := GetSharedProtoLoader(t, "testdata/services/employee.v1")
	handler := NewTestRPCHandler(t, protoLoader)

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
	protoLoader := GetSharedProtoLoader(t, "testdata/services/employee.v1")
	handler := NewTestRPCHandler(t, protoLoader)

	vs, err := NewVanguardService(VanguardServiceConfig{
		Handler:     handler,
		ProtoLoader: protoLoader,
		Logger:      zap.NewNop(),
	})
	require.NoError(t, err)

	t.Run("validates existing method", func(t *testing.T) {
		err := vs.ValidateMethod("employee.v1.EmployeeService", "GetEmployeeById")
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
	protoLoader := GetSharedProtoLoader(t, "testdata/services/employee.v1")
	handler := NewTestRPCHandler(t, protoLoader)

	vs, err := NewVanguardService(VanguardServiceConfig{
		Handler:     handler,
		ProtoLoader: protoLoader,
		Logger:      zap.NewNop(),
	})
	require.NoError(t, err)

	t.Run("gets method info successfully", func(t *testing.T) {
		info, err := vs.GetMethodInfo("employee.v1.EmployeeService", "GetEmployeeById")
		require.NoError(t, err)
		assert.NotNil(t, info)
		assert.Equal(t, "GetEmployeeById", info.Name)
	})

	t.Run("fails for non-existent method", func(t *testing.T) {
		_, err := vs.GetMethodInfo("employee.v1.EmployeeService", "NonExistent")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "method not found")
	})
}

func TestVanguardService_GetServiceInfo(t *testing.T) {
	protoLoader := GetSharedProtoLoader(t, "testdata/services/employee.v1")
	handler := NewTestRPCHandler(t, protoLoader)

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
		assert.Contains(t, info.Methods, "GetEmployeeById")
	})

	t.Run("fails for non-existent service", func(t *testing.T) {
		_, err := vs.GetServiceInfo("example.NonExistent")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "service not found")
	})
}

func TestVanguardService_ServiceHandler(t *testing.T) {
	protoLoader := GetSharedProtoLoader(t, "testdata/services/employee.v1")
	handler := NewTestRPCHandler(t, protoLoader)

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
		protoLoader := GetSharedProtoLoader(t, "testdata/services/employee.v1")
		
		// Build operations map with service-scoped approach before creating registry
		serviceName := "employee.v1.EmployeeService"
		operations := map[string]map[string]*schemaloader.Operation{
			serviceName: {
				"GetEmployeeById": &schemaloader.Operation{
					Name:            "GetEmployeeById",
					OperationType:   "query",
					OperationString: "query GetEmployeeById($id: Int!) { employee(id: $id) { id name } }",
				},
			},
		}
		opRegistry := NewOperationRegistry(operations)

		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   graphqlServer.URL,
			HTTPClient:        &http.Client{},
			Logger:            zap.NewNop(),
			OperationRegistry: opRegistry,
			ProtoLoader:       protoLoader,
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
		requestBody := map[string]any{
			"id": 1,
		}
		requestJSON, err := json.Marshal(requestBody)
		require.NoError(t, err)

		req := httptest.NewRequest("POST", "/employee.v1.EmployeeService/GetEmployeeById", bytes.NewReader(requestJSON))
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
		var response map[string]any
		err = json.Unmarshal(w.Body.Bytes(), &response)
		assert.NoError(t, err)
	})

	t.Run("returns 404 for unknown method name", func(t *testing.T) {
		services := protoLoader.GetServices()
		require.NotEmpty(t, services)
		var serviceDef *ServiceDefinition
		for _, svc := range services {
			serviceDef = svc
			break
		}
		require.NotNil(t, serviceDef)

		// Valid service name but non-existent method
		req := httptest.NewRequest("POST", "/employee.v1.EmployeeService/NonExistentMethod", nil)
		w := httptest.NewRecorder()

		serviceHandler := vs.createServiceHandler("employee.v1.EmployeeService", serviceDef)
		serviceHandler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
		assert.Contains(t, w.Body.String(), "method not found")
	})

	t.Run("returns 404 for wrong service name with valid method", func(t *testing.T) {
		services := protoLoader.GetServices()
		require.NotEmpty(t, services)
		var serviceDef *ServiceDefinition
		for _, svc := range services {
			serviceDef = svc
			break
		}
		require.NotNil(t, serviceDef)

		// Wrong service name but valid method name - should fail service validation
		req := httptest.NewRequest("POST", "/wrong.Service/GetEmployeeById", nil)
		w := httptest.NewRecorder()

		serviceHandler := vs.createServiceHandler("employee.v1.EmployeeService", serviceDef)
		serviceHandler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
		assert.Contains(t, w.Body.String(), "invalid path format")
	})

	t.Run("returns 404 for invalid path format with too many parts", func(t *testing.T) {
		services := protoLoader.GetServices()
		require.NotEmpty(t, services)
		var serviceDef *ServiceDefinition
		for _, svc := range services {
			serviceDef = svc
			break
		}
		require.NotNil(t, serviceDef)

		// Path with too many segments
		req := httptest.NewRequest("POST", "/employee.v1.EmployeeService/GetEmployeeById/extra", nil)
		w := httptest.NewRecorder()

		serviceHandler := vs.createServiceHandler("employee.v1.EmployeeService", serviceDef)
		serviceHandler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusNotFound, w.Code)
		assert.Contains(t, w.Body.String(), "invalid path format")
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
		req := httptest.NewRequest("POST", "/employee.v1.EmployeeService/GetEmployeeById", &errorReader{})
		w := httptest.NewRecorder()

		serviceHandler := vs.createServiceHandler("employee.v1.EmployeeService", serviceDef)
		serviceHandler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}

// errorReader is a reader that always returns an error
type errorReader struct{}

func (e *errorReader) Read(p []byte) (n int, err error) {
	return 0, io.ErrUnexpectedEOF
}
