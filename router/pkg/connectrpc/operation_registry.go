package connectrpc

import (
	"github.com/wundergraph/cosmo/router/pkg/schemaloader"
)

// OperationRegistry manages pre-defined GraphQL operations for ConnectRPC.
// Operations are scoped to their service (package.service) and cached in memory
// for fast access during request handling.
//
// Thread-safety: This registry is immutable after creation, making it safe for
// concurrent reads without any locking overhead. To update operations, create a
// new registry instance with the updated data.
type OperationRegistry struct {
	// Service-scoped operations: serviceName (package.service) -> operationName -> Operation
	// This map is immutable after construction - no locks needed for reads
	operations map[string]map[string]*schemaloader.Operation
}

// NewOperationRegistry creates a new immutable operation registry with pre-built operations.
// The operations map is used as-is without copying, so callers should not modify it after passing.
func NewOperationRegistry(operations map[string]map[string]*schemaloader.Operation) *OperationRegistry {
	if operations == nil {
		operations = make(map[string]map[string]*schemaloader.Operation)
	}

	return &OperationRegistry{
		operations: operations,
	}
}

// GetOperationForService retrieves an operation for a specific service.
// Returns nil if the service or operation is not found.
// This method is safe for concurrent use (no locking needed due to immutability).
func (r *OperationRegistry) GetOperationForService(serviceName, operationName string) *schemaloader.Operation {
	serviceOps, exists := r.operations[serviceName]
	if !exists {
		return nil
	}

	return serviceOps[operationName]
}

// HasOperationForService checks if an operation exists for a specific service.
// This method is safe for concurrent use (no locking needed due to immutability).
func (r *OperationRegistry) HasOperationForService(serviceName, operationName string) bool {
	serviceOps, exists := r.operations[serviceName]
	if !exists {
		return false
	}

	_, exists = serviceOps[operationName]
	return exists
}

// GetAllOperationsForService returns all operations for a specific service.
// The returned slice is a copy to prevent external modification.
// Returns an empty slice if the service doesn't exist.
// This method is safe for concurrent use (no locking needed due to immutability).
func (r *OperationRegistry) GetAllOperationsForService(serviceName string) []schemaloader.Operation {
	serviceOps, exists := r.operations[serviceName]
	if !exists {
		return []schemaloader.Operation{}
	}

	operations := make([]schemaloader.Operation, 0, len(serviceOps))
	for _, op := range serviceOps {
		operations = append(operations, *op)
	}

	return operations
}

// GetAllOperations returns all operations across all services.
// The returned slice is a copy to prevent external modification.
// This method is safe for concurrent use (no locking needed due to immutability).
func (r *OperationRegistry) GetAllOperations() []schemaloader.Operation {
	var operations []schemaloader.Operation
	for _, serviceOps := range r.operations {
		for _, op := range serviceOps {
			operations = append(operations, *op)
		}
	}

	return operations
}

// Count returns the total number of operations across all services.
// This method is safe for concurrent use (no locking needed due to immutability).
func (r *OperationRegistry) Count() int {
	count := 0
	for _, serviceOps := range r.operations {
		count += len(serviceOps)
	}
	return count
}

// CountForService returns the number of operations for a specific service.
// This method is safe for concurrent use (no locking needed due to immutability).
func (r *OperationRegistry) CountForService(serviceName string) int {
	return len(r.operations[serviceName])
}

// GetServiceNames returns all service names that have operations registered.
// This method is safe for concurrent use (no locking needed due to immutability).
func (r *OperationRegistry) GetServiceNames() []string {
	names := make([]string, 0, len(r.operations))
	for serviceName := range r.operations {
		names = append(names, serviceName)
	}

	return names
}
