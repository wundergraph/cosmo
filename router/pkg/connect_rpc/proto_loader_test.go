package connect_rpc

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// createTestProtoFile creates a temporary proto file for testing
func createTestProtoFile(t *testing.T, dir, filename, content string) string {
	t.Helper()

	filePath := filepath.Join(dir, filename)
	err := os.WriteFile(filePath, []byte(content), 0644)
	require.NoError(t, err, "Failed to create test proto file")

	return filePath
}

// createTestProtoDir creates a temporary directory for test proto files
func createTestProtoDir(t *testing.T) string {
	t.Helper()

	tmpDir, err := os.MkdirTemp("", "proto-loader-test-*")
	require.NoError(t, err, "Failed to create temp directory")

	t.Cleanup(func() {
		os.RemoveAll(tmpDir)
	})

	return tmpDir
}

func TestNewProtoLoader_Success(t *testing.T) {
	// Create test directory with a simple proto file
	tmpDir := createTestProtoDir(t)

	protoContent := `
syntax = "proto3";

package test.v1;

service TestService {
  rpc GetTest(GetTestRequest) returns (GetTestResponse);
}

message GetTestRequest {
  int32 id = 1;
}

message GetTestResponse {
  int32 id = 1;
  string name = 2;
}
`

	protoFile := createTestProtoFile(t, tmpDir, "test.proto", protoContent)

	// Create proto loader
	logger := zap.NewNop()
	loader, err := NewProtoLoader([]string{protoFile}, logger)

	// Assertions
	require.NoError(t, err, "NewProtoLoader should not return error")
	require.NotNil(t, loader, "Loader should not be nil")

	services := loader.GetServices()
	assert.Len(t, services, 1, "Should load exactly one service")
	assert.Equal(t, "test.v1.TestService", string(services[0].FullName()))

	files := loader.GetFiles()
	assert.Len(t, files, 1, "Should load exactly one file")
}

func TestNewProtoLoader_MultipleFiles(t *testing.T) {
	tmpDir := createTestProtoDir(t)

	// Create first proto file
	proto1 := `
syntax = "proto3";

package employees.v1;

service EmployeeService {
  rpc GetEmployee(GetEmployeeRequest) returns (GetEmployeeResponse);
}

message GetEmployeeRequest {
  int32 id = 1;
}

message GetEmployeeResponse {
  int32 id = 1;
  string name = 2;
}
`

	// Create second proto file
	proto2 := `
syntax = "proto3";

package products.v1;

service ProductService {
  rpc GetProduct(GetProductRequest) returns (GetProductResponse);
}

message GetProductRequest {
  int32 id = 1;
}

message GetProductResponse {
  int32 id = 1;
  string title = 2;
}
`

	file1 := createTestProtoFile(t, tmpDir, "employees.proto", proto1)
	file2 := createTestProtoFile(t, tmpDir, "products.proto", proto2)

	// Create proto loader
	logger := zap.NewNop()
	loader, err := NewProtoLoader([]string{file1, file2}, logger)

	// Assertions
	require.NoError(t, err)
	require.NotNil(t, loader)

	services := loader.GetServices()
	assert.Len(t, services, 2, "Should load two services")

	// Check service names
	serviceNames := make([]string, len(services))
	for i, svc := range services {
		serviceNames[i] = string(svc.FullName())
	}
	assert.Contains(t, serviceNames, "employees.v1.EmployeeService")
	assert.Contains(t, serviceNames, "products.v1.ProductService")
}

func TestNewProtoLoader_NoProtoFiles(t *testing.T) {
	// Don't provide any proto files
	logger := zap.NewNop()
	loader, err := NewProtoLoader([]string{}, logger)

	// Assertions
	assert.Error(t, err, "Should return error when no proto files provided")
	assert.Nil(t, loader, "Loader should be nil on error")
	assert.Contains(t, err.Error(), "at least one proto file is required")
}

func TestNewProtoLoader_InvalidProtoSyntax(t *testing.T) {
	tmpDir := createTestProtoDir(t)

	// Create proto file with invalid syntax
	invalidProto := `
syntax = "proto3";

package test.v1;

service TestService {
  rpc GetTest(GetTestRequest) returns (GetTestResponse)  // Missing semicolon
}

message GetTestRequest {
  int32 id = 1
}
`

	protoFile := createTestProtoFile(t, tmpDir, "invalid.proto", invalidProto)

	logger := zap.NewNop()
	loader, err := NewProtoLoader([]string{protoFile}, logger)

	// Assertions
	assert.Error(t, err, "Should return error for invalid proto syntax")
	assert.Nil(t, loader, "Loader should be nil on error")
}

func TestProtoLoader_GetServiceByName(t *testing.T) {
	tmpDir := createTestProtoDir(t)

	protoContent := `
syntax = "proto3";

package test.v1;

service TestService {
  rpc GetTest(GetTestRequest) returns (GetTestResponse);
}

message GetTestRequest {
  int32 id = 1;
}

message GetTestResponse {
  string name = 1;
}
`

	protoFile := createTestProtoFile(t, tmpDir, "test.proto", protoContent)

	logger := zap.NewNop()
	loader, err := NewProtoLoader([]string{protoFile}, logger)
	require.NoError(t, err)

	// Test getting service by name
	service, err := loader.GetServiceByName("test.v1.TestService")
	assert.NoError(t, err)
	assert.NotNil(t, service)
	assert.Equal(t, "test.v1.TestService", string(service.FullName()))

	// Test getting non-existent service
	_, err = loader.GetServiceByName("nonexistent.Service")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "service not found")
}

func TestProtoLoader_GetMethodDescriptor(t *testing.T) {
	tmpDir := createTestProtoDir(t)

	protoContent := `
syntax = "proto3";

package test.v1;

service TestService {
  rpc GetTest(GetTestRequest) returns (GetTestResponse);
  rpc ListTests(ListTestsRequest) returns (ListTestsResponse);
}

message GetTestRequest {
  int32 id = 1;
}

message GetTestResponse {
  string name = 1;
}

message ListTestsRequest {}

message ListTestsResponse {
  repeated GetTestResponse tests = 1;
}
`

	protoFile := createTestProtoFile(t, tmpDir, "test.proto", protoContent)

	logger := zap.NewNop()
	loader, err := NewProtoLoader([]string{protoFile}, logger)
	require.NoError(t, err)

	// Test getting method descriptor
	method, err := loader.GetMethodDescriptor("test.v1.TestService", "GetTest")
	assert.NoError(t, err)
	assert.NotNil(t, method)
	assert.Equal(t, "GetTest", string(method.Name()))

	// Test getting second method
	method2, err := loader.GetMethodDescriptor("test.v1.TestService", "ListTests")
	assert.NoError(t, err)
	assert.NotNil(t, method2)
	assert.Equal(t, "ListTests", string(method2.Name()))

	// Test getting non-existent method
	_, err = loader.GetMethodDescriptor("test.v1.TestService", "NonExistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "method not found")

	// Test getting method from non-existent service
	_, err = loader.GetMethodDescriptor("nonexistent.Service", "GetTest")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "service not found")
}

func TestProtoLoader_StreamingMethods(t *testing.T) {
	tmpDir := createTestProtoDir(t)

	protoContent := `
syntax = "proto3";

package test.v1;

service StreamService {
  rpc ServerStream(StreamRequest) returns (stream StreamResponse);
  rpc ClientStream(stream StreamRequest) returns (StreamResponse);
  rpc BidiStream(stream StreamRequest) returns (stream StreamResponse);
}

message StreamRequest {
  string data = 1;
}

message StreamResponse {
  string result = 1;
}
`

	protoFile := createTestProtoFile(t, tmpDir, "stream.proto", protoContent)

	logger := zap.NewNop()
	loader, err := NewProtoLoader([]string{protoFile}, logger)
	require.NoError(t, err)

	// Get service
	service, err := loader.GetServiceByName("test.v1.StreamService")
	require.NoError(t, err)

	// Check methods exist
	methods := service.Methods()
	assert.Equal(t, 3, methods.Len(), "Should have 3 streaming methods")
}

func TestProtoLoader_WithNilLogger(t *testing.T) {
	tmpDir := createTestProtoDir(t)

	protoContent := `
syntax = "proto3";

package test.v1;

service TestService {
  rpc GetTest(GetTestRequest) returns (GetTestResponse);
}

message GetTestRequest {
  int32 id = 1;
}

message GetTestResponse {
  string name = 1;
}
`

	protoFile := createTestProtoFile(t, tmpDir, "test.proto", protoContent)

	// Create loader with nil logger (should use NopLogger)
	loader, err := NewProtoLoader([]string{protoFile}, nil)

	// Assertions
	require.NoError(t, err)
	require.NotNil(t, loader)
	assert.NotNil(t, loader.logger, "Logger should be initialized even when nil is passed")
}
