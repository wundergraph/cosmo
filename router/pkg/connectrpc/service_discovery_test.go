package connectrpc

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestDiscoverServices(t *testing.T) {
	t.Run("discovers single service with proto and operations", func(t *testing.T) {
		// Create temporary test directory structure
		tmpDir := t.TempDir()
		serviceDir := filepath.Join(tmpDir, "employee.v1")
		require.NoError(t, os.MkdirAll(serviceDir, 0755))

		// Create proto file
		protoContent := `syntax = "proto3";
package employee.v1;

service EmployeeService {
  rpc GetEmployee(GetEmployeeRequest) returns (GetEmployeeResponse);
}

message GetEmployeeRequest {
  int32 id = 1;
}

message GetEmployeeResponse {
  string name = 1;
}
`
		require.NoError(t, os.WriteFile(filepath.Join(serviceDir, "employee.proto"), []byte(protoContent), 0644))

		// Create GraphQL operation files
		require.NoError(t, os.WriteFile(filepath.Join(serviceDir, "GetEmployee.graphql"), []byte("query GetEmployee { employee { name } }"), 0644))

		// Discover services
		services, err := DiscoverServices(ServiceDiscoveryConfig{
			ServicesDir: tmpDir,
			Logger:      zap.NewNop(),
		})

		require.NoError(t, err)
		require.Len(t, services, 1)

		service := services[0]
		assert.Equal(t, "employee.v1", service.Package)
		assert.Equal(t, "EmployeeService", service.ServiceName)
		assert.Equal(t, "employee.v1.EmployeeService", service.FullName)
		assert.Equal(t, serviceDir, service.ServiceDir)
		assert.Len(t, service.ProtoFiles, 1)
	})

	t.Run("discovers multiple services at same level", func(t *testing.T) {
		tmpDir := t.TempDir()

		// Create employee service
		employeeDir := filepath.Join(tmpDir, "employee.v1")
		require.NoError(t, os.MkdirAll(employeeDir, 0755))
		employeeProto := `syntax = "proto3";
package employee.v1;
service EmployeeService {
  rpc GetEmployee(GetEmployeeRequest) returns (GetEmployeeResponse);
}
message GetEmployeeRequest { int32 id = 1; }
message GetEmployeeResponse { string name = 1; }
`
		require.NoError(t, os.WriteFile(filepath.Join(employeeDir, "employee.proto"), []byte(employeeProto), 0644))

		// Create product service
		productDir := filepath.Join(tmpDir, "product.v1")
		require.NoError(t, os.MkdirAll(productDir, 0755))
		productProto := `syntax = "proto3";
package product.v1;
service ProductService {
  rpc GetProduct(GetProductRequest) returns (GetProductResponse);
}
message GetProductRequest { int32 id = 1; }
message GetProductResponse { string name = 1; }
`
		require.NoError(t, os.WriteFile(filepath.Join(productDir, "product.proto"), []byte(productProto), 0644))

		// Discover services
		services, err := DiscoverServices(ServiceDiscoveryConfig{
			ServicesDir: tmpDir,
			Logger:      zap.NewNop(),
		})

		require.NoError(t, err)
		require.Len(t, services, 2)

		// Verify both services were discovered
		serviceNames := make(map[string]bool)
		for _, svc := range services {
			serviceNames[svc.FullName] = true
		}
		assert.True(t, serviceNames["employee.v1.EmployeeService"])
		assert.True(t, serviceNames["product.v1.ProductService"])
	})

	t.Run("discovers nested services", func(t *testing.T) {
		tmpDir := t.TempDir()

		// Create nested structure: services/company/employee.v1/
		companyDir := filepath.Join(tmpDir, "company")
		employeeDir := filepath.Join(companyDir, "employee.v1")
		require.NoError(t, os.MkdirAll(employeeDir, 0755))

		protoContent := `syntax = "proto3";
package employee.v1;
service EmployeeService {
  rpc GetEmployee(GetEmployeeRequest) returns (GetEmployeeResponse);
}
message GetEmployeeRequest { int32 id = 1; }
message GetEmployeeResponse { string name = 1; }
`
		require.NoError(t, os.WriteFile(filepath.Join(employeeDir, "employee.proto"), []byte(protoContent), 0644))

		// Discover services
		services, err := DiscoverServices(ServiceDiscoveryConfig{
			ServicesDir: tmpDir,
			Logger:      zap.NewNop(),
		})

		require.NoError(t, err)
		require.Len(t, services, 1)
		assert.Equal(t, "employee.v1.EmployeeService", services[0].FullName)
	})

	t.Run("stops at first proto and does not discover nested protos (ADR compliance)", func(t *testing.T) {
		tmpDir := t.TempDir()

		// Create parent service directory with proto
		parentDir := filepath.Join(tmpDir, "employee.v1")
		require.NoError(t, os.MkdirAll(parentDir, 0755))

		parentProto := `syntax = "proto3";
package employee.v1;
service EmployeeService {
  rpc GetEmployee(GetEmployeeRequest) returns (GetEmployeeResponse);
}
message GetEmployeeRequest { int32 id = 1; }
message GetEmployeeResponse { string name = 1; }
`
		require.NoError(t, os.WriteFile(filepath.Join(parentDir, "employee.proto"), []byte(parentProto), 0644))

		// Create nested directory with another proto (should NOT be discovered)
		nestedDir := filepath.Join(parentDir, "nested")
		require.NoError(t, os.MkdirAll(nestedDir, 0755))

		nestedProto := `syntax = "proto3";
package nested.v1;
service NestedService {
  rpc GetNested(GetNestedRequest) returns (GetNestedResponse);
}
message GetNestedRequest { int32 id = 1; }
message GetNestedResponse { string name = 1; }
`
		require.NoError(t, os.WriteFile(filepath.Join(nestedDir, "nested.proto"), []byte(nestedProto), 0644))

		// Discover services
		services, err := DiscoverServices(ServiceDiscoveryConfig{
			ServicesDir: tmpDir,
			Logger:      zap.NewNop(),
		})

		require.NoError(t, err)
		// Should only find the parent service, not the nested one
		require.Len(t, services, 1, "Should only discover parent service, not nested proto")
		assert.Equal(t, "employee.v1.EmployeeService", services[0].FullName)
		assert.Equal(t, parentDir, services[0].ServiceDir)
	})

	t.Run("discovers operations in subdirectories of service", func(t *testing.T) {
		tmpDir := t.TempDir()
		serviceDir := filepath.Join(tmpDir, "employee.v1")
		require.NoError(t, os.MkdirAll(serviceDir, 0755))

		// Create proto file
		protoContent := `syntax = "proto3";
package employee.v1;
service EmployeeService {
  rpc GetEmployee(GetEmployeeRequest) returns (GetEmployeeResponse);
}
message GetEmployeeRequest { int32 id = 1; }
message GetEmployeeResponse { string name = 1; }
`
		require.NoError(t, os.WriteFile(filepath.Join(serviceDir, "employee.proto"), []byte(protoContent), 0644))

		// Create operations in subdirectories
		queriesDir := filepath.Join(serviceDir, "operations", "queries")
		mutationsDir := filepath.Join(serviceDir, "operations", "mutations")
		require.NoError(t, os.MkdirAll(queriesDir, 0755))
		require.NoError(t, os.MkdirAll(mutationsDir, 0755))

		require.NoError(t, os.WriteFile(filepath.Join(queriesDir, "GetEmployee.graphql"), []byte("query GetEmployee { employee { name } }"), 0644))
		require.NoError(t, os.WriteFile(filepath.Join(mutationsDir, "UpdateEmployee.graphql"), []byte("mutation UpdateEmployee { updateEmployee { name } }"), 0644))

		// Discover services
		services, err := DiscoverServices(ServiceDiscoveryConfig{
			ServicesDir: tmpDir,
			Logger:      zap.NewNop(),
		})

		require.NoError(t, err)
		require.Len(t, services, 1)

		// Verify operations can be found in subdirectories
		operations, err := findOperationFiles(serviceDir)
		require.NoError(t, err)
		assert.Len(t, operations, 2, "Should find operations in subdirectories")
	})

	t.Run("enforces one proto file per directory", func(t *testing.T) {
		tmpDir := t.TempDir()
		serviceDir := filepath.Join(tmpDir, "employee.v1")
		require.NoError(t, os.MkdirAll(serviceDir, 0755))

		// Create two proto files in the same directory
		proto1 := `syntax = "proto3";
package employee.v1;
service EmployeeService {
  rpc GetEmployee(GetEmployeeRequest) returns (GetEmployeeResponse);
}
message GetEmployeeRequest { int32 id = 1; }
message GetEmployeeResponse { string name = 1; }
`
		proto2 := `syntax = "proto3";
package employee.v1;
service AnotherService {
  rpc GetAnother(GetAnotherRequest) returns (GetAnotherResponse);
}
message GetAnotherRequest { int32 id = 1; }
message GetAnotherResponse { string name = 1; }
`
		require.NoError(t, os.WriteFile(filepath.Join(serviceDir, "employee.proto"), []byte(proto1), 0644))
		require.NoError(t, os.WriteFile(filepath.Join(serviceDir, "another.proto"), []byte(proto2), 0644))

		// Discover services - should fail
		_, err := DiscoverServices(ServiceDiscoveryConfig{
			ServicesDir: tmpDir,
			Logger:      zap.NewNop(),
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "only one proto file is allowed per directory")
	})

	t.Run("validates unique package.service combinations", func(t *testing.T) {
		tmpDir := t.TempDir()

		// Create two directories with the same package.service
		dir1 := filepath.Join(tmpDir, "service1")
		dir2 := filepath.Join(tmpDir, "service2")
		require.NoError(t, os.MkdirAll(dir1, 0755))
		require.NoError(t, os.MkdirAll(dir2, 0755))

		// Same proto content in both directories
		protoContent := `syntax = "proto3";
package employee.v1;
service EmployeeService {
  rpc GetEmployee(GetEmployeeRequest) returns (GetEmployeeResponse);
}
message GetEmployeeRequest { int32 id = 1; }
message GetEmployeeResponse { string name = 1; }
`
		require.NoError(t, os.WriteFile(filepath.Join(dir1, "employee.proto"), []byte(protoContent), 0644))
		require.NoError(t, os.WriteFile(filepath.Join(dir2, "employee.proto"), []byte(protoContent), 0644))

		// Discover services - should fail due to duplicate
		_, err := DiscoverServices(ServiceDiscoveryConfig{
			ServicesDir: tmpDir,
			Logger:      zap.NewNop(),
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "duplicate service")
		assert.Contains(t, err.Error(), "employee.v1.EmployeeService")
	})

	t.Run("returns error when no services found", func(t *testing.T) {
		tmpDir := t.TempDir()

		// Create empty directory
		_, err := DiscoverServices(ServiceDiscoveryConfig{
			ServicesDir: tmpDir,
			Logger:      zap.NewNop(),
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "no services found")
	})

	t.Run("returns error when services directory does not exist", func(t *testing.T) {
		_, err := DiscoverServices(ServiceDiscoveryConfig{
			ServicesDir: "/nonexistent/directory",
			Logger:      zap.NewNop(),
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "does not exist")
	})

	t.Run("returns error when proto has no package declaration", func(t *testing.T) {
		tmpDir := t.TempDir()
		serviceDir := filepath.Join(tmpDir, "employee.v1")
		require.NoError(t, os.MkdirAll(serviceDir, 0755))

		// Proto without package declaration
		protoContent := `syntax = "proto3";
service EmployeeService {
  rpc GetEmployee(GetEmployeeRequest) returns (GetEmployeeResponse);
}
message GetEmployeeRequest { int32 id = 1; }
message GetEmployeeResponse { string name = 1; }
`
		require.NoError(t, os.WriteFile(filepath.Join(serviceDir, "employee.proto"), []byte(protoContent), 0644))

		_, err := DiscoverServices(ServiceDiscoveryConfig{
			ServicesDir: tmpDir,
			Logger:      zap.NewNop(),
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "no package declaration found")
	})

	t.Run("returns error when proto has no service declaration", func(t *testing.T) {
		tmpDir := t.TempDir()
		serviceDir := filepath.Join(tmpDir, "employee.v1")
		require.NoError(t, os.MkdirAll(serviceDir, 0755))

		// Proto without service declaration
		protoContent := `syntax = "proto3";
package employee.v1;
message GetEmployeeRequest { int32 id = 1; }
message GetEmployeeResponse { string name = 1; }
`
		require.NoError(t, os.WriteFile(filepath.Join(serviceDir, "employee.proto"), []byte(protoContent), 0644))

		_, err := DiscoverServices(ServiceDiscoveryConfig{
			ServicesDir: tmpDir,
			Logger:      zap.NewNop(),
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "no service declaration found")
	})
}
