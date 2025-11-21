package connectrpc

import (
	"fmt"
	"sync"

	"github.com/wundergraph/cosmo/router/pkg/schemaloader"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"go.uber.org/zap"
)

// OperationRegistry manages pre-defined GraphQL operations for ConnectRPC.
// It loads operations from a directory and provides lookup by operation name.
// Operations are cached in memory for fast access during request handling.
type OperationRegistry struct {
	operations map[string]*schemaloader.Operation
	mu         sync.RWMutex
	logger     *zap.Logger
}

// NewOperationRegistry creates a new operation registry.
func NewOperationRegistry(logger *zap.Logger) *OperationRegistry {
	if logger == nil {
		logger = zap.NewNop()
	}

	return &OperationRegistry{
		operations: make(map[string]*schemaloader.Operation),
		logger:     logger,
	}
}

// LoadFromDirectory loads all GraphQL operations from the specified directory.
// Operations are validated against the provided schema and cached in memory.
// This method is thread-safe and can be called multiple times to reload operations.
func (r *OperationRegistry) LoadFromDirectory(operationsDir string, schemaDoc *ast.Document) error {
	if operationsDir == "" {
		return fmt.Errorf("operations directory cannot be empty")
	}

	if schemaDoc == nil {
		return fmt.Errorf("schema document cannot be nil")
	}

	// Load operations using the schema loader
	loader := schemaloader.NewOperationLoader(r.logger, schemaDoc)
	operations, err := loader.LoadOperationsFromDirectory(operationsDir)
	if err != nil {
		return fmt.Errorf("failed to load operations from directory %s: %w", operationsDir, err)
	}

	// Build JSON schemas for operations
	builder := schemaloader.NewSchemaBuilder(schemaDoc)
	err = builder.BuildSchemasForOperations(operations)
	if err != nil {
		return fmt.Errorf("failed to build schemas for operations: %w", err)
	}

	// Update the registry with loaded operations
	r.mu.Lock()
	defer r.mu.Unlock()

	// Clear existing operations
	r.operations = make(map[string]*schemaloader.Operation)

	// Add new operations to the registry
	for i := range operations {
		op := &operations[i]
		r.operations[op.Name] = op
		r.logger.Debug("Loaded operation",
			zap.String("name", op.Name),
			zap.String("type", op.OperationType),
			zap.String("file", op.FilePath))
	}

	r.logger.Info("Loaded operations into registry",
		zap.Int("count", len(r.operations)),
		zap.String("directory", operationsDir))

	return nil
}

// GetOperation retrieves an operation by name.
// Returns nil if the operation is not found.
// This method is thread-safe.
func (r *OperationRegistry) GetOperation(name string) *schemaloader.Operation {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return r.operations[name]
}

// HasOperation checks if an operation with the given name exists in the registry.
// This method is thread-safe.
func (r *OperationRegistry) HasOperation(name string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	_, exists := r.operations[name]
	return exists
}

// GetAllOperations returns a slice of all operations in the registry.
// The returned slice is a copy to prevent external modification.
// This method is thread-safe.
func (r *OperationRegistry) GetAllOperations() []schemaloader.Operation {
	r.mu.RLock()
	defer r.mu.RUnlock()

	operations := make([]schemaloader.Operation, 0, len(r.operations))
	for _, op := range r.operations {
		operations = append(operations, *op)
	}

	return operations
}

// Count returns the number of operations in the registry.
// This method is thread-safe.
func (r *OperationRegistry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return len(r.operations)
}

// Clear removes all operations from the registry.
// This method is thread-safe.
func (r *OperationRegistry) Clear() {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.operations = make(map[string]*schemaloader.Operation)
	r.logger.Debug("Cleared operation registry")
}