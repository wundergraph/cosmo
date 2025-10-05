package connect_rpc

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestNewProtoManager(t *testing.T) {
	logger := zap.NewNop()
	pm := NewProtoManager("/test/proto", logger)

	assert.Equal(t, "/test/proto", pm.protoDir)
	assert.NotNil(t, pm.services)
	assert.NotNil(t, pm.logger)
}

func TestProtoManager_ExtractMethodName(t *testing.T) {
	pm := NewProtoManager("", zap.NewNop())

	tests := []struct {
		name        string
		servicePath string
		expected    string
		expectError bool
	}{
		{
			name:        "valid service path",
			servicePath: "/service.v1.EmployeeService/GetEmployeeByID",
			expected:    "GetEmployeeByID",
			expectError: false,
		},
		{
			name:        "another valid service path",
			servicePath: "/api.v2.UserService/CreateUser",
			expected:    "CreateUser",
			expectError: false,
		},
		{
			name:        "invalid service path - too few parts",
			servicePath: "/invalid",
			expected:    "",
			expectError: true,
		},
		{
			name:        "invalid service path - too many parts",
			servicePath: "/service.v1.EmployeeService/GetEmployeeByID/extra",
			expected:    "",
			expectError: true,
		},
		{
			name:        "empty service path",
			servicePath: "",
			expected:    "",
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := pm.ExtractMethodName(tt.servicePath)

			if tt.expectError {
				assert.Error(t, err)
				assert.Empty(t, result)
			} else {
				assert.NoError(t, err)
				assert.Equal(t, tt.expected, result)
			}
		})
	}
}

func TestProtoManager_ParseRPCMethod(t *testing.T) {
	pm := NewProtoManager("", zap.NewNop())

	tests := []struct {
		name     string
		line     string
		expected *MethodInfo
	}{
		{
			name: "valid RPC method",
			line: "rpc GetEmployeeByID(GetEmployeeByIDRequest) returns (GetEmployeeByIDResponse);",
			expected: &MethodInfo{
				Name:       "GetEmployeeByID",
				InputType:  "GetEmployeeByIDRequest",
				OutputType: "GetEmployeeByIDResponse",
			},
		},
		{
			name: "RPC method with spaces",
			line: "  rpc CreateUser ( CreateUserRequest ) returns ( CreateUserResponse ) ;  ",
			expected: &MethodInfo{
				Name:       "CreateUser",
				InputType:  "CreateUserRequest",
				OutputType: "CreateUserResponse",
			},
		},
		{
			name:     "invalid line - not RPC",
			line:     "message GetEmployeeByIDRequest {",
			expected: nil,
		},
		{
			name:     "invalid line - malformed RPC",
			line:     "rpc GetEmployeeByID",
			expected: nil,
		},
		{
			name:     "empty line",
			line:     "",
			expected: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := pm.parseRPCMethod(tt.line)

			if tt.expected == nil {
				assert.Nil(t, result)
			} else {
				require.NotNil(t, result)
				assert.Equal(t, tt.expected.Name, result.Name)
				assert.Equal(t, tt.expected.InputType, result.InputType)
				assert.Equal(t, tt.expected.OutputType, result.OutputType)
			}
		})
	}
}

func TestProtoManager_LoadProtoFiles(t *testing.T) {
	// Create a temporary directory for testing
	tempDir, err := os.MkdirTemp("", "proto_test")
	require.NoError(t, err)
	defer os.RemoveAll(tempDir)

	// Create a sample proto file
	protoContent := `syntax = "proto3";

package service.v1;

option go_package = "github.com/example/service/v1";

// Employee service for managing employees
service EmployeeService {
  // Get an employee by ID
  rpc GetEmployeeByID(GetEmployeeByIDRequest) returns (GetEmployeeByIDResponse);
  
  // Create a new employee
  rpc CreateEmployee(CreateEmployeeRequest) returns (CreateEmployeeResponse);
}

message GetEmployeeByIDRequest {
  int32 employee_id = 1;
}

message GetEmployeeByIDResponse {
  Employee employee = 1;
}

message CreateEmployeeRequest {
  string name = 1;
  string email = 2;
}

message CreateEmployeeResponse {
  Employee employee = 1;
}

message Employee {
  int32 id = 1;
  string name = 2;
  string email = 3;
}
`

	protoFile := filepath.Join(tempDir, "employee.proto")
	err = os.WriteFile(protoFile, []byte(protoContent), 0644)
	require.NoError(t, err)

	// Test loading proto files
	pm := NewProtoManager(tempDir, zap.NewNop())
	err = pm.LoadProtoFiles()
	assert.NoError(t, err)

	// Verify service was loaded
	serviceInfo, err := pm.GetServiceInfo("/service.v1.EmployeeService/GetEmployeeByID")
	assert.NoError(t, err)
	assert.NotNil(t, serviceInfo)

	assert.Equal(t, "service.v1", serviceInfo.Package)
	assert.Equal(t, "EmployeeService", serviceInfo.ServiceName)
	assert.Len(t, serviceInfo.Methods, 2)

	// Check first method
	method1 := serviceInfo.Methods[0]
	assert.Equal(t, "GetEmployeeByID", method1.Name)
	assert.Equal(t, "GetEmployeeByIDRequest", method1.InputType)
	assert.Equal(t, "GetEmployeeByIDResponse", method1.OutputType)

	// Check second method
	method2 := serviceInfo.Methods[1]
	assert.Equal(t, "CreateEmployee", method2.Name)
	assert.Equal(t, "CreateEmployeeRequest", method2.InputType)
	assert.Equal(t, "CreateEmployeeResponse", method2.OutputType)
}

func TestProtoManager_LoadProtoFiles_NonExistentDirectory(t *testing.T) {
	pm := NewProtoManager("/non/existent/directory", zap.NewNop())
	err := pm.LoadProtoFiles()
	
	// Should not return an error for non-existent directory
	assert.NoError(t, err)
}

func TestProtoManager_LoadProtoFiles_EmptyDirectory(t *testing.T) {
	// Create a temporary empty directory
	tempDir, err := os.MkdirTemp("", "proto_test_empty")
	require.NoError(t, err)
	defer os.RemoveAll(tempDir)

	pm := NewProtoManager(tempDir, zap.NewNop())
	err = pm.LoadProtoFiles()
	assert.NoError(t, err)
	assert.Empty(t, pm.services)
}

func TestProtoManager_GetServiceInfo_NotFound(t *testing.T) {
	pm := NewProtoManager("", zap.NewNop())
	
	serviceInfo, err := pm.GetServiceInfo("/non.existent.Service/Method")
	assert.Error(t, err)
	assert.Nil(t, serviceInfo)
	assert.Contains(t, err.Error(), "service not found")
}

func TestIsProtoFile(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		expected bool
	}{
		{
			name:     "proto file",
			path:     "/path/to/service.proto",
			expected: true,
		},
		{
			name:     "proto file uppercase",
			path:     "/path/to/SERVICE.PROTO",
			expected: true,
		},
		{
			name:     "go file",
			path:     "/path/to/service.go",
			expected: false,
		},
		{
			name:     "text file",
			path:     "/path/to/readme.txt",
			expected: false,
		},
		{
			name:     "no extension",
			path:     "/path/to/service",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isProtoFile(tt.path)
			assert.Equal(t, tt.expected, result)
		})
	}
}