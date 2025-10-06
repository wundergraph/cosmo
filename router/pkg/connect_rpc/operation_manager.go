package connect_rpc

import (
	"fmt"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"go.uber.org/zap"
)

// ConnectRPCOperationsManager handles the loading and preparation of GraphQL operations for Connect RPC
type ConnectRPCOperationsManager struct {
	schemaDoc        *ast.Document
	operations       []ConnectRPCOperation
	logger           *zap.Logger
	excludeMutations bool
}

// NewConnectRPCOperationsManager creates a new Connect RPC operations manager
func NewConnectRPCOperationsManager(schemaDoc *ast.Document, logger *zap.Logger, excludeMutations bool) *ConnectRPCOperationsManager {
	if logger == nil {
		logger = zap.NewNop()
	}

	return &ConnectRPCOperationsManager{
		schemaDoc:        schemaDoc, // Keep for potential future use, but not used for validation
		logger:           logger,
		excludeMutations: excludeMutations,
	}
}

// LoadOperationsFromDirectory loads operations from a specified directory using Connect RPC schema loader
func (om *ConnectRPCOperationsManager) LoadOperationsFromDirectory(operationsDir string) error {
	om.logger.Info("Loading Connect RPC operations from directory",
		zap.String("operations_dir", operationsDir))
	
	// Load operations using Connect RPC specific loader (no schema validation)
	loader := NewConnectRPCOperationLoader(om.logger, om.schemaDoc)
	operations, err := loader.LoadOperationsFromDirectory(operationsDir)
	if err != nil {
		om.logger.Error("Failed to load Connect RPC operations",
			zap.String("operations_dir", operationsDir),
			zap.Error(err))
		return fmt.Errorf("failed to load Connect RPC operations: %w", err)
	}

	om.operations = operations

	om.logger.Info("Connect RPC operations loaded successfully",
		zap.Int("total_operations", len(operations)),
		zap.Bool("exclude_mutations", om.excludeMutations))
	
	// Log each loaded operation for debugging
	for i, op := range operations {
		om.logger.Debug("Loaded Connect RPC operation",
			zap.Int("index", i),
			zap.String("name", op.Name),
			zap.String("type", op.OperationType),
			zap.String("file_path", op.FilePath))
	}

	return nil
}

// GetOperations returns all loaded Connect RPC operations
func (om *ConnectRPCOperationsManager) GetOperations() []ConnectRPCOperation {
	return om.operations
}

// GetFilteredOperations returns operations filtered by excludeMutations setting
func (om *ConnectRPCOperationsManager) GetFilteredOperations() []ConnectRPCOperation {
	if !om.excludeMutations {
		return om.operations
	}

	filteredOps := make([]ConnectRPCOperation, 0, len(om.operations))
	for _, op := range om.operations {
		if op.OperationType != "mutation" {
			filteredOps = append(filteredOps, op)
		}
	}
	return filteredOps
}

// GetOperation gets a specific Connect RPC operation by name
func (om *ConnectRPCOperationsManager) GetOperation(name string) *ConnectRPCOperation {
	for i := range om.operations {
		if om.operations[i].Name == name {
			if om.operations[i].OperationType == "mutation" && om.excludeMutations {
				return nil // Mutation excluded by configuration
			}
			return &om.operations[i]
		}
	}
	return nil
}

// GetSchema returns the schema document used by the operations manager
func (om *ConnectRPCOperationsManager) GetSchema() *ast.Document {
	return om.schemaDoc
}

// GetOperationCount returns the total number of loaded operations
func (om *ConnectRPCOperationsManager) GetOperationCount() int {
	return len(om.operations)
}

// GetOperationsByType returns operations filtered by operation type
func (om *ConnectRPCOperationsManager) GetOperationsByType(operationType string) []ConnectRPCOperation {
	var filteredOps []ConnectRPCOperation
	for _, op := range om.operations {
		if op.OperationType == operationType {
			filteredOps = append(filteredOps, op)
		}
	}
	return filteredOps
}
