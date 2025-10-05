package connect_rpc

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestNewOperationMapper_Success(t *testing.T) {
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

	// Load proto
	logger := zap.NewNop()
	loader, err := NewProtoLoader([]string{protoFile}, logger)
	require.NoError(t, err)

	// Create operation mapper
	services := loader.GetServices()
	mapper, err := NewOperationMapper(services, logger)

	// Assertions
	require.NoError(t, err)
	require.NotNil(t, mapper)

	operations := mapper.GetAllOperations()
	assert.Len(t, operations, 1, "Should have one operation")

	op, exists := operations["GetTest"]
	require.True(t, exists, "GetTest operation should exist")
	assert.Equal(t, "GetTest", op.Name)
	assert.Equal(t, "query", op.OperationType)
	assert.NotEmpty(t, op.Query)
}

func TestOperationMapper_ReconstructOperation_Query(t *testing.T) {
	tmpDir := createTestProtoDir(t)

	protoContent := `
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
  string email = 3;
}
`

	protoFile := createTestProtoFile(t, tmpDir, "employees.proto", protoContent)

	logger := zap.NewNop()
	loader, err := NewProtoLoader([]string{protoFile}, logger)
	require.NoError(t, err)

	services := loader.GetServices()
	mapper, err := NewOperationMapper(services, logger)
	require.NoError(t, err)

	// Get the operation
	op, err := mapper.GetOperation("GetEmployee")
	require.NoError(t, err)

	// Assertions
	assert.Equal(t, "GetEmployee", op.Name)
	assert.Equal(t, "query", op.OperationType)
	assert.Contains(t, op.Query, "query GetEmployee")
	assert.Contains(t, op.Query, "$id: Int!")
	assert.Contains(t, op.Query, "id")
	assert.Contains(t, op.Query, "name")
	assert.Contains(t, op.Query, "email")

	// Check variables
	assert.Len(t, op.Variables, 1)
	assert.Equal(t, "Int!", op.Variables["id"])
}

func TestOperationMapper_ReconstructOperation_Subscription(t *testing.T) {
	tmpDir := createTestProtoDir(t)

	protoContent := `
syntax = "proto3";

package stream.v1;

service StreamService {
  rpc Subscribe(SubscribeRequest) returns (stream SubscribeResponse);
}

message SubscribeRequest {
  string topic = 1;
}

message SubscribeResponse {
  string message = 1;
}
`

	protoFile := createTestProtoFile(t, tmpDir, "stream.proto", protoContent)

	logger := zap.NewNop()
	loader, err := NewProtoLoader([]string{protoFile}, logger)
	require.NoError(t, err)

	services := loader.GetServices()
	mapper, err := NewOperationMapper(services, logger)
	require.NoError(t, err)

	// Get the operation
	op, err := mapper.GetOperation("Subscribe")
	require.NoError(t, err)

	// Assertions
	assert.Equal(t, "Subscribe", op.Name)
	assert.Equal(t, "subscription", op.OperationType, "Streaming methods should be subscriptions")
	assert.Contains(t, op.Query, "subscription Subscribe")
}

func TestOperationMapper_ProtoFieldToGraphQLField(t *testing.T) {
	tests := []struct {
		protoField   string
		expectedName string
	}{
		{"user_id", "userId"},
		{"first_name", "firstName"},
		{"is_active", "isActive"},
		{"simple", "simple"},
		{"a_b_c", "aBC"},
		{"user_profile_id", "userProfileId"},
	}

	mapper := &OperationMapper{
		logger:     zap.NewNop(),
		operations: make(map[string]*GraphQLOperation),
	}

	for _, tt := range tests {
		t.Run(tt.protoField, func(t *testing.T) {
			result := mapper.protoFieldToGraphQLField(tt.protoField)
			assert.Equal(t, tt.expectedName, result)
		})
	}
}

func TestOperationMapper_MultipleOperations(t *testing.T) {
	tmpDir := createTestProtoDir(t)

	protoContent := `
syntax = "proto3";

package test.v1;

service TestService {
  rpc Get(GetRequest) returns (GetResponse);
  rpc List(ListRequest) returns (ListResponse);
}

message GetRequest {
  int32 id = 1;
}

message GetResponse {
  string name = 1;
}

message ListRequest {}

message ListResponse {
  repeated string items = 1;
}
`

	protoFile := createTestProtoFile(t, tmpDir, "test.proto", protoContent)

	logger := zap.NewNop()
	loader, err := NewProtoLoader([]string{protoFile}, logger)
	require.NoError(t, err)

	services := loader.GetServices()
	mapper, err := NewOperationMapper(services, logger)
	require.NoError(t, err)

	// Check both operations exist
	operations := mapper.GetAllOperations()
	assert.Len(t, operations, 2)

	_, err = mapper.GetOperation("Get")
	assert.NoError(t, err)

	_, err = mapper.GetOperation("List")
	assert.NoError(t, err)
}

func TestOperationMapper_GetOperation_NotFound(t *testing.T) {
	tmpDir := createTestProtoDir(t)

	protoContent := `
syntax = "proto3";

package test.v1;

service TestService {
  rpc Test(TestRequest) returns (TestResponse);
}

message TestRequest {}
message TestResponse {}
`

	protoFile := createTestProtoFile(t, tmpDir, "test.proto", protoContent)

	logger := zap.NewNop()
	loader, err := NewProtoLoader([]string{protoFile}, logger)
	require.NoError(t, err)

	services := loader.GetServices()
	mapper, err := NewOperationMapper(services, logger)
	require.NoError(t, err)

	// Try to get non-existent operation
	_, err = mapper.GetOperation("NonExistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "operation not found")
}

func TestOperationMapper_HasOperation(t *testing.T) {
	tmpDir := createTestProtoDir(t)

	protoContent := `
syntax = "proto3";

package test.v1;

service TestService {
  rpc Test(TestRequest) returns (TestResponse);
}

message TestRequest {}
message TestResponse {}
`

	protoFile := createTestProtoFile(t, tmpDir, "test.proto", protoContent)

	logger := zap.NewNop()
	loader, err := NewProtoLoader([]string{protoFile}, logger)
	require.NoError(t, err)

	services := loader.GetServices()
	mapper, err := NewOperationMapper(services, logger)
	require.NoError(t, err)

	// Check existing operation
	assert.True(t, mapper.HasOperation("Test"))

	// Check non-existent operation
	assert.False(t, mapper.HasOperation("NonExistent"))
}

func TestOperationMapper_ListOperationNames(t *testing.T) {
	tmpDir := createTestProtoDir(t)

	protoContent := `
syntax = "proto3";

package user.v1;

service UserService {
  rpc GetUser(GetUserRequest) returns (GetUserResponse);
  rpc ListUsers(ListUsersRequest) returns (ListUsersResponse);
}

message GetUserRequest {}
message GetUserResponse {}
message ListUsersRequest {}
message ListUsersResponse {}
`

	protoFile := createTestProtoFile(t, tmpDir, "user.proto", protoContent)

	logger := zap.NewNop()
	loader, err := NewProtoLoader([]string{protoFile}, logger)
	require.NoError(t, err)

	services := loader.GetServices()
	mapper, err := NewOperationMapper(services, logger)
	require.NoError(t, err)

	// Get operation names
	names := mapper.ListOperationNames()
	assert.Len(t, names, 2)
	assert.Contains(t, names, "GetUser")
	assert.Contains(t, names, "ListUsers")
}

func TestOperationMapper_NestedMessages(t *testing.T) {
	tmpDir := createTestProtoDir(t)

	protoContent := `
syntax = "proto3";

package user.v1;

service UserService {
  rpc GetUser(GetUserRequest) returns (GetUserResponse);
}

message GetUserRequest {
  int32 id = 1;
}

message Address {
  string street = 1;
  string city = 2;
}

message GetUserResponse {
  int32 id = 1;
  string name = 2;
  Address address = 3;
}
`

	protoFile := createTestProtoFile(t, tmpDir, "user.proto", protoContent)

	logger := zap.NewNop()
	loader, err := NewProtoLoader([]string{protoFile}, logger)
	require.NoError(t, err)

	services := loader.GetServices()
	mapper, err := NewOperationMapper(services, logger)
	require.NoError(t, err)

	// Get the operation
	op, err := mapper.GetOperation("GetUser")
	require.NoError(t, err)

	// Check that nested message is included in selection set
	assert.Contains(t, op.Query, "address")
	assert.Contains(t, op.Query, "street")
	assert.Contains(t, op.Query, "city")
}

func TestOperationMapper_EmptyRequest(t *testing.T) {
	tmpDir := createTestProtoDir(t)

	protoContent := `
syntax = "proto3";

package test.v1;

service TestService {
  rpc ListAll(ListAllRequest) returns (ListAllResponse);
}

message ListAllRequest {}

message ListAllResponse {
  int32 count = 1;
}
`

	protoFile := createTestProtoFile(t, tmpDir, "test.proto", protoContent)

	logger := zap.NewNop()
	loader, err := NewProtoLoader([]string{protoFile}, logger)
	require.NoError(t, err)

	services := loader.GetServices()
	mapper, err := NewOperationMapper(services, logger)
	require.NoError(t, err)

	// Get the operation
	op, err := mapper.GetOperation("ListAll")
	require.NoError(t, err)

	// Should have no variables
	assert.Empty(t, op.Variables)
	assert.Contains(t, op.Query, "query ListAll {")
	assert.NotContains(t, op.Query, "$")
}

func TestOperationMapper_WithNilLogger(t *testing.T) {
	tmpDir := createTestProtoDir(t)

	protoContent := `
syntax = "proto3";

package test.v1;

service TestService {
  rpc Test(TestRequest) returns (TestResponse);
}

message TestRequest {}
message TestResponse {}
`

	protoFile := createTestProtoFile(t, tmpDir, "test.proto", protoContent)

	loader, err := NewProtoLoader([]string{protoFile}, zap.NewNop())
	require.NoError(t, err)

	services := loader.GetServices()

	// Create mapper with nil logger
	mapper, err := NewOperationMapper(services, nil)

	// Should not error and should use NopLogger
	require.NoError(t, err)
	require.NotNil(t, mapper)
	assert.NotNil(t, mapper.logger)
}

func TestOperationMapper_RepeatedFields(t *testing.T) {
	tmpDir := createTestProtoDir(t)

	protoContent := `
syntax = "proto3";

package test.v1;

service TestService {
  rpc GetData(GetDataRequest) returns (GetDataResponse);
}

message GetDataRequest {
  repeated int32 ids = 1;
}

message GetDataResponse {
  repeated string items = 1;
}
`

	protoFile := createTestProtoFile(t, tmpDir, "test.proto", protoContent)

	logger := zap.NewNop()
	loader, err := NewProtoLoader([]string{protoFile}, logger)
	require.NoError(t, err)

	services := loader.GetServices()
	mapper, err := NewOperationMapper(services, logger)
	require.NoError(t, err)

	// Get the operation
	op, err := mapper.GetOperation("GetData")
	require.NoError(t, err)

	// Check that repeated fields are handled correctly
	assert.Equal(t, "[Int]", op.Variables["ids"])
	assert.Contains(t, op.Query, "items")
}
